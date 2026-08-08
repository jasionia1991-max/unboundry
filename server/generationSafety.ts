import type { IncomingMessage, ServerResponse } from "node:http";
import type { DatabaseSync } from "node:sqlite";
import { requestIdentity } from "./auth";
import { hasPermission } from "./permissions";
import {
  appDataDirectory,
  openAppDatabase,
} from "./database";
import {
  decodedRequestPath,
  HttpRequestError,
  readJsonBody,
} from "./httpRequest";
import {
  generationProviderAttemptCounts,
  type GenerationTaskKind,
} from "./generationTaskStore";

export type RunningTaskPolicy = "cancel" | "wait";

export type GenerationSafetySettings = {
  audioConcurrency: number;
  cooldownMinutes: number;
  emergencyStop: boolean;
  failureThreshold: number;
  globalEnabled: boolean;
  imageConcurrency: number;
  perUserConcurrency: number;
  requestsPerMinute: number;
  runningTaskPolicy: RunningTaskPolicy;
  textConcurrency: number;
  updatedAt: string;
  videoConcurrency: number;
};

export type GenerationAdmission =
  | { allowed: true; code: "ALLOWED" }
  | {
      allowed: false;
      code:
        | "EMERGENCY_STOP"
        | "GLOBAL_DISABLED"
        | "KIND_CONCURRENCY"
        | "PROVIDER_COOLDOWN"
        | "RATE_LIMIT"
        | "USER_CONCURRENCY";
      message: string;
    };

type SafetyRow = {
  audio_concurrency: number;
  cooldown_minutes: number;
  emergency_stop: number;
  failure_threshold: number;
  global_enabled: number;
  image_concurrency: number;
  per_user_concurrency: number;
  requests_per_minute: number;
  running_task_policy: RunningTaskPolicy;
  text_concurrency: number;
  updated_at: string;
  video_concurrency: number;
};

type SafetyInput = Omit<
  GenerationSafetySettings,
  "updatedAt"
>;

const activeStates = [
  "queued",
  "running",
  "retrying",
  "recovering",
] as const;
const kindColumns: Record<GenerationTaskKind, keyof SafetyRow> = {
  audio: "audio_concurrency",
  image: "image_concurrency",
  text: "text_concurrency",
  video: "video_concurrency",
};

function json(response: ServerResponse, status: number, body: unknown) {
  response.statusCode = status;
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

function toSettings(row: SafetyRow): GenerationSafetySettings {
  return {
    audioConcurrency: Number(row.audio_concurrency),
    cooldownMinutes: Number(row.cooldown_minutes),
    emergencyStop: Boolean(row.emergency_stop),
    failureThreshold: Number(row.failure_threshold),
    globalEnabled: Boolean(row.global_enabled),
    imageConcurrency: Number(row.image_concurrency),
    perUserConcurrency: Number(row.per_user_concurrency),
    requestsPerMinute: Number(row.requests_per_minute),
    runningTaskPolicy: row.running_task_policy,
    textConcurrency: Number(row.text_concurrency),
    updatedAt: row.updated_at,
    videoConcurrency: Number(row.video_concurrency),
  };
}

function cleanInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  label: string,
) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new Error(`${label}设置无效`);
  }
  return number;
}

function cleanSettings(input: Partial<SafetyInput>): SafetyInput {
  if (
    typeof input.globalEnabled !== "boolean" ||
    typeof input.emergencyStop !== "boolean" ||
    !["cancel", "wait"].includes(String(input.runningTaskPolicy))
  ) {
    throw new Error("安全开关设置无效");
  }
  return {
    audioConcurrency: cleanInteger(
      input.audioConcurrency,
      1,
      1_000,
      "音频并发",
    ),
    cooldownMinutes: cleanInteger(
      input.cooldownMinutes,
      1,
      1_440,
      "熔断时间",
    ),
    emergencyStop: input.emergencyStop,
    failureThreshold: cleanInteger(
      input.failureThreshold,
      1,
      20,
      "失败阈值",
    ),
    globalEnabled: input.globalEnabled,
    imageConcurrency: cleanInteger(
      input.imageConcurrency,
      1,
      1_000,
      "图片并发",
    ),
    perUserConcurrency: cleanInteger(
      input.perUserConcurrency,
      1,
      1_000,
      "用户并发",
    ),
    requestsPerMinute: cleanInteger(
      input.requestsPerMinute,
      1,
      1_000,
      "请求频率",
    ),
    runningTaskPolicy: input.runningTaskPolicy as RunningTaskPolicy,
    textConcurrency: cleanInteger(
      input.textConcurrency,
      1,
      1_000,
      "文字并发",
    ),
    videoConcurrency: cleanInteger(
      input.videoConcurrency,
      1,
      1_000,
      "视频并发",
    ),
  };
}

export function createGenerationSafetyStore(
  dataDirectory = appDataDirectory(),
) {
  const database = openAppDatabase(dataDirectory);
  const read = database.prepare(
    "SELECT * FROM generation_safety_settings WHERE id = 1",
  );

  function settings() {
    return toSettings(read.get() as SafetyRow);
  }

  function update(input: Partial<SafetyInput>) {
    // 旧客户端/旧标签可能仍提交已废弃的成本字段；cleanSettings 只读取
    // 当前仍支持的字段，多余字段会被自然忽略，不会写库。
    const clean = cleanSettings({ ...settings(), ...input });
    const timestamp = new Date().toISOString();
    database
      .prepare(`
        UPDATE generation_safety_settings
        SET
          global_enabled = ?,
          emergency_stop = ?,
          per_user_concurrency = ?,
          requests_per_minute = ?,
          text_concurrency = ?,
          image_concurrency = ?,
          video_concurrency = ?,
          audio_concurrency = ?,
          failure_threshold = ?,
          cooldown_minutes = ?,
          running_task_policy = ?,
          updated_at = ?
        WHERE id = 1
      `)
      .run(
        Number(clean.globalEnabled),
        Number(clean.emergencyStop),
        clean.perUserConcurrency,
        clean.requestsPerMinute,
        clean.textConcurrency,
        clean.imageConcurrency,
        clean.videoConcurrency,
        clean.audioConcurrency,
        clean.failureThreshold,
        clean.cooldownMinutes,
        clean.runningTaskPolicy,
        timestamp,
      );
    return settings();
  }

  function admission(input: {
    kind: GenerationTaskKind;
    now?: Date;
    ownerId: string;
    providerProfileId: string;
  }): GenerationAdmission {
    const row = read.get() as SafetyRow;
    if (row.emergency_stop) {
      return {
        allowed: false,
        code: "EMERGENCY_STOP",
        message: "管理员已紧急停止真实生成",
      };
    }
    if (!row.global_enabled) {
      return {
        allowed: false,
        code: "GLOBAL_DISABLED",
        message: "管理员已关闭真实生成",
      };
    }

    const now = input.now ?? new Date();
    const minuteStart = new Date(now.getTime() - 60_000).toISOString();
    const cooldownStart = new Date(
      now.getTime() - row.cooldown_minutes * 60_000,
    ).toISOString();
    const activePlaceholders = activeStates.map(() => "?").join(", ");

    const recentRequests = Number(
      (
        database
          .prepare(`
            SELECT COUNT(*) AS count
            FROM generation_tasks
            WHERE owner_id = ? AND created_at >= ?
          `)
          .get(input.ownerId, minuteStart) as { count: number }
      ).count,
    );
    if (recentRequests >= row.requests_per_minute) {
      return {
        allowed: false,
        code: "RATE_LIMIT",
        message: "请求过于频繁，请稍后再试",
      };
    }

    const activeForUser = Number(
      (
        database
          .prepare(`
            SELECT COUNT(*) AS count
            FROM generation_tasks
            WHERE owner_id = ? AND state IN (${activePlaceholders})
          `)
          .get(input.ownerId, ...activeStates) as { count: number }
      ).count,
    );
    if (activeForUser >= row.per_user_concurrency) {
      return {
        allowed: false,
        code: "USER_CONCURRENCY",
        message: "当前运行任务已达到用户上限",
      };
    }

    const activeForKind = Number(
      (
        database
          .prepare(`
            SELECT COUNT(*) AS count
            FROM generation_tasks
            WHERE
              owner_id = ?
              AND kind = ?
              AND state IN (${activePlaceholders})
          `)
          .get(input.ownerId, input.kind, ...activeStates) as {
          count: number;
        }
      ).count,
    );
    if (activeForKind >= Number(row[kindColumns[input.kind]])) {
      return {
        allowed: false,
        code: "KIND_CONCURRENCY",
        message: "当前类型的运行任务已达到上限",
      };
    }

    const failedRows = database
      .prepare(`
        SELECT state, updated_at
        FROM generation_tasks
        WHERE
          provider_profile_id = ?
          AND kind = ?
          AND owner_id = ?
          AND state IN ('failed', 'success')
          AND updated_at >= ?
        ORDER BY updated_at DESC
        LIMIT ?
      `)
      .all(
        input.providerProfileId,
        input.kind,
        input.ownerId,
        cooldownStart,
        row.failure_threshold,
      ) as Array<{
        state: "failed" | "success";
        updated_at: string;
      }>;
    if (
      failedRows.length === row.failure_threshold &&
      failedRows.every(({ state }) => state === "failed")
    ) {
      return {
        allowed: false,
        code: "PROVIDER_COOLDOWN",
        message: "模型服务连续失败，已暂停新任务",
      };
    }

    return { allowed: true, code: "ALLOWED" };
  }

  return {
    admission,
    close() {
      database.close();
    },
    settings,
    update,
  };
}

let defaultStore: ReturnType<typeof createGenerationSafetyStore> | undefined;

function safetyStore() {
  if (!defaultStore) defaultStore = createGenerationSafetyStore();
  return defaultStore;
}

function audit(
  database: DatabaseSync,
  actorUserId: string,
  details: Record<string, unknown>,
) {
  database
    .prepare(`
      INSERT INTO admin_audit_events (
        actor_user_id, action, target_user_id, details, created_at
      )
      VALUES (?, 'generation_safety.update', NULL, ?, ?)
    `)
    .run(actorUserId, JSON.stringify(details), new Date().toISOString());
}

function providerStatus() {
  const database = openAppDatabase();
  try {
    const configured = database.prepare(`
      SELECT COUNT(*) AS count
      FROM model_profiles
      JOIN provider_profiles
        ON provider_profiles.id = model_profiles.provider_profile_id
      JOIN node_model_bindings
        ON node_model_bindings.model_id = model_profiles.id
        AND node_model_bindings.node_type = model_profiles.capability
      WHERE
        model_profiles.status = 'published'
        AND model_profiles.capability IN ('image', 'video')
        AND provider_profiles.status = 'enabled'
        AND node_model_bindings.enabled = 1
        AND (
          (
            model_profiles.capability = 'image'
            AND provider_profiles.driver = 'openrouter'
            AND model_profiles.provider_model_id = 'openai/gpt-image-2'
          ) OR (
            model_profiles.capability = 'video'
            AND provider_profiles.driver = 'volcengine-ark'
            AND model_profiles.cost_currency = 'CNY'
            AND model_profiles.provider_model_id GLOB 'doubao-seedance-2-0-mini-*'
          )
        )
    `).get() as { count: number };
    return {
      ...generationProviderAttemptCounts(database),
      providerConfigured: Number(configured.count) > 0,
    };
  } finally {
    database.close();
  }
}

export async function adminGenerationSafetyApi(
  request: IncomingMessage,
  response: ServerResponse,
) {
  const identity = requestIdentity(request);
  if (!identity || !hasPermission(identity, "manage_generation_safety")) {
    json(response, 403, {
      error: "只有管理员可以修改生成安全保护",
    });
    return;
  }
  const path = decodedRequestPath(request).replace(
    /^\/+/,
    "",
  );
  if (request.method === "GET" && !path) {
    json(response, 200, {
      ...providerStatus(),
      settings: safetyStore().settings(),
    });
    return;
  }
  if (request.method === "PUT" && !path) {
    try {
      const before = safetyStore().settings();
      const settings = safetyStore().update(
        await readJsonBody<Partial<SafetyInput>>(request, 64 * 1_024),
      );
      const database = openAppDatabase();
      try {
        audit(database, identity.userId, {
          after: settings,
          before,
        });
      } finally {
        database.close();
      }
      json(response, 200, {
        ...providerStatus(),
        settings,
      });
    } catch (error) {
      if (error instanceof HttpRequestError) throw error;
      json(response, 400, {
        error: error instanceof Error ? error.message : "安全设置保存失败",
      });
    }
    return;
  }
  response.setHeader("Allow", "GET, PUT");
  json(response, 404, { error: "生成安全保护接口不存在" });
}

export function generationSafetyStatus() {
  return safetyStore().settings();
}

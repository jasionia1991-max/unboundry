import type { IncomingMessage, ServerResponse } from "node:http";
import type { DatabaseSync } from "node:sqlite";
import {
  AccountMutationBlockedError,
  assertAccountMutationAllowed,
} from "./accountMutationFence";
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
  type GenerationTaskKind,
} from "./generationTaskStore";
import { generationProviderAttemptCounts } from "./generationAttemptQueries";

export type RunningTaskPolicy = "cancel" | "wait";

type RunningTaskPolicySummary = {
  cancelled: number;
  error?: string;
  failed: number;
  waiting: number;
};

let applyRunningTaskPolicy: (() => Promise<RunningTaskPolicySummary>) | undefined;

export function configureEmergencyStopRunningTaskPolicy(
  apply: () => Promise<RunningTaskPolicySummary>,
) {
  if (applyRunningTaskPolicy && applyRunningTaskPolicy !== apply) {
    throw new Error("Emergency-stop running-task policy is already configured");
  }
  applyRunningTaskPolicy = apply;
}

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

function safetyRow(database: DatabaseSync) {
  return database
    .prepare("SELECT * FROM generation_safety_settings WHERE id = 1")
    .get() as SafetyRow;
}

function switchDecision(row: SafetyRow): GenerationAdmission | undefined {
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
  return undefined;
}

/**
 * Durable Provider-attempt circuit. Only definitive Provider outcomes count;
 * local validation failures, overwritten task terminal states, timeouts and
 * “no result” platform failures do not. The circuit is scoped per owner so
 * different accounts on the same connection never accumulate against each
 * other.
 */
export function generationProviderCircuitDecisionInTransaction(
  database: DatabaseSync,
  input: {
    kind: GenerationTaskKind;
    now?: Date;
    ownerId: string;
    providerProfileId: string;
  },
): GenerationAdmission {
  const row = safetyRow(database);
  const definitiveFailureCodes = [
    "AUTH",
    "PERMISSION",
    "RATE_LIMIT",
    "FORMAT",
  ];
  const cooldownStart = new Date(
    (input.now ?? new Date()).getTime() - row.cooldown_minutes * 60_000,
  ).toISOString();
  const outcomes = database
    .prepare(`
      SELECT outcome
      FROM generation_provider_attempts
      WHERE
        owner_id = ?
        AND provider_profile_id = ?
        AND kind = ?
        AND outcome IN ('provider-failed', 'completed')
        AND (
          outcome = 'completed'
          OR failure_code IN (${definitiveFailureCodes.map(() => "?").join(", ")})
        )
        AND finished_at IS NOT NULL
        AND finished_at >= ?
      ORDER BY finished_at DESC, id DESC
      LIMIT ?
    `)
    .all(
      input.ownerId,
      input.providerProfileId,
      input.kind,
      ...definitiveFailureCodes,
      cooldownStart,
      row.failure_threshold,
    ) as Array<{ outcome: "completed" | "provider-failed" }>;
  if (
    outcomes.length === row.failure_threshold &&
    outcomes.every(({ outcome }) => outcome === "provider-failed")
  ) {
    return {
      allowed: false,
      code: "PROVIDER_COOLDOWN",
      message: "模型服务连续失败，已暂停新任务",
    };
  }
  return { allowed: true, code: "ALLOWED" };
}

/**
 * Authoritative admission check. The caller must already own the surrounding
 * BEGIN IMMEDIATE transaction and must insert the task/admission before commit.
 */
export function generationAdmissionInTransaction(
  database: DatabaseSync,
  input: {
    kind: GenerationTaskKind;
    now?: Date;
    ownerId: string;
    providerProfileId: string;
  },
): GenerationAdmission {
  const row = safetyRow(database);
  const switched = switchDecision(row);
  if (switched) return switched;

  const now = input.now ?? new Date();
  const minuteStart = new Date(now.getTime() - 60_000).toISOString();
  const activePlaceholders = activeStates.map(() => "?").join(", ");

  const recentRequests = Number(
    (
      database
        .prepare(`
          SELECT COUNT(*) AS count
          FROM generation_admission_events
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

  // Per-kind limits are platform-wide. Per-account isolation is enforced by
  // the independent per_user_concurrency setting above.
  const activeForKind = Number(
    (
      database
        .prepare(`
          SELECT COUNT(*) AS count
          FROM generation_tasks
          WHERE kind = ? AND state IN (${activePlaceholders})
        `)
        .get(input.kind, ...activeStates) as { count: number }
    ).count,
  );
  if (activeForKind >= Number(row[kindColumns[input.kind]])) {
    return {
      allowed: false,
      code: "KIND_CONCURRENCY",
      message: "当前类型的运行任务已达到上限",
    };
  }

  return generationProviderCircuitDecisionInTransaction(database, input);
}

/** Last paid-boundary safety gate; rate/concurrency were consumed at admission. */
export function generationProviderBoundaryDecisionInTransaction(
  database: DatabaseSync,
  input: {
    kind: GenerationTaskKind;
    now?: Date;
    ownerId: string;
    providerProfileId: string;
  },
): GenerationAdmission {
  const switched = switchDecision(safetyRow(database));
  return switched ?? generationProviderCircuitDecisionInTransaction(database, input);
}

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

function validateSettingsPatch(input: Partial<SafetyInput>) {
  if (
    input.globalEnabled !== undefined &&
    typeof input.globalEnabled !== "boolean"
  ) {
    throw new Error("安全开关设置无效");
  }
  if (
    input.emergencyStop !== undefined &&
    typeof input.emergencyStop !== "boolean"
  ) {
    throw new Error("安全开关设置无效");
  }
  if (
    input.runningTaskPolicy !== undefined &&
    !["cancel", "wait"].includes(String(input.runningTaskPolicy))
  ) {
    throw new Error("安全开关设置无效");
  }
  const integerFields = [
    ["audioConcurrency", 1, 1_000, "音频并发"],
    ["cooldownMinutes", 1, 1_440, "熔断时间"],
    ["failureThreshold", 1, 20, "失败阈值"],
    ["imageConcurrency", 1, 1_000, "图片并发"],
    ["perUserConcurrency", 1, 1_000, "用户并发"],
    ["requestsPerMinute", 1, 1_000, "请求频率"],
    ["textConcurrency", 1, 1_000, "文字并发"],
    ["videoConcurrency", 1, 1_000, "视频并发"],
  ] as const;
  for (const [key, minimum, maximum, label] of integerFields) {
    if (input[key] !== undefined) {
      cleanInteger(input[key], minimum, maximum, label);
    }
  }
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

  function writeSettings(clean: SafetyInput) {
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
  }

  function update(input: Partial<SafetyInput>) {
    // 旧客户端/旧标签可能仍提交已废弃的成本字段；cleanSettings 只读取
    // 当前仍支持的字段，多余字段会被自然忽略，不会写库。
    validateSettingsPatch(input);
    const clean = cleanSettings({ ...settings(), ...input });
    writeSettings(clean);
    return settings();
  }

  function updateForAdmin(
    actorUserId: string,
    input: Partial<SafetyInput>,
  ) {
    // JSON parsing and field validation must finish before taking the write
    // lock. The authoritative merge and account fence stay inside it.
    validateSettingsPatch(input);
    database.exec("BEGIN IMMEDIATE");
    try {
      assertAccountMutationAllowed(database, actorUserId);
      const before = settings();
      const clean = cleanSettings({ ...before, ...input });
      writeSettings(clean);
      const after = settings();
      const applyRunningTaskPolicyAfterCommit =
        after.emergencyStop &&
        after.runningTaskPolicy === "cancel" &&
        (!before.emergencyStop || before.runningTaskPolicy !== "cancel");
      audit(database, actorUserId, {
        after,
        before,
        ...(applyRunningTaskPolicyAfterCommit
          ? {
              runningTaskPolicyEffect: {
                phase: "after-commit",
                policy: "cancel",
              },
            }
          : {}),
      });
      database.exec("COMMIT");
      return {
        applyRunningTaskPolicyAfterCommit,
        settings: after,
      };
    } catch (error) {
      if (database.isTransaction) database.exec("ROLLBACK");
      throw error;
    }
  }

  function admission(input: {
    kind: GenerationTaskKind;
    now?: Date;
    ownerId: string;
    providerProfileId: string;
  }): GenerationAdmission {
    return generationAdmissionInTransaction(database, input);
  }

  return {
    admission,
    close() {
      database.close();
    },
    settings,
    update,
    updateForAdmin,
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
      const input = await readJsonBody<Partial<SafetyInput>>(
        request,
        64 * 1_024,
      );
      const {
        applyRunningTaskPolicyAfterCommit,
        settings,
      } = safetyStore().updateForAdmin(identity.userId, input);
      let runningTaskPolicySummary: RunningTaskPolicySummary | undefined;
      // Running-task cancellation may await Provider-aware task transitions,
      // so it intentionally starts only after settings + audit have committed.
      if (applyRunningTaskPolicyAfterCommit) {
        try {
          if (!applyRunningTaskPolicy) {
            throw new Error("Generation running-task policy is not configured");
          }
          runningTaskPolicySummary = await applyRunningTaskPolicy();
        } catch (error) {
          runningTaskPolicySummary = {
            cancelled: 0,
            error: error instanceof Error
              ? error.message
              : "紧急停止后的任务取消失败",
            failed: 1,
            waiting: 0,
          };
        }
      }
      json(response, 200, {
        ...providerStatus(),
        ...(runningTaskPolicySummary ? { runningTaskPolicySummary } : {}),
        settings,
      });
    } catch (error) {
      if (error instanceof HttpRequestError) throw error;
      if (error instanceof AccountMutationBlockedError) {
        json(response, 409, {
          code: error.code,
          error: error.message,
        });
        return;
      }
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

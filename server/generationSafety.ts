import type { IncomingMessage, ServerResponse } from "node:http";
import type { DatabaseSync } from "node:sqlite";
import { requestIdentity } from "./auth";
import {
  appDataDirectory,
  openAppDatabase,
} from "./database";
import {
  generationProviderAttemptCounts,
  type GenerationTaskKind,
} from "./generationTaskStore";

export type RunningTaskPolicy = "cancel" | "wait";

export type GenerationSafetySettings = {
  audioConcurrency: number;
  cooldownMinutes: number;
  dailyCostLimitCnyMicrounits: number;
  dailyCostLimitMicrounits: number;
  emergencyStop: boolean;
  failureThreshold: number;
  globalEnabled: boolean;
  imageConcurrency: number;
  monthlyCostLimitCnyMicrounits: number;
  monthlyCostLimitMicrounits: number;
  perUserConcurrency: number;
  requestsPerMinute: number;
  runningTaskPolicy: RunningTaskPolicy;
  singleTaskDefaultCostCnyMicrounits: number;
  textConcurrency: number;
  unknownCostPolicy: "block";
  updatedAt: string;
  usdToCnyRateMicrounits: number;
  videoConcurrency: number;
};

export type GenerationAdmission =
  | { allowed: true; code: "ALLOWED" }
  | {
      allowed: false;
      code:
        | "COST_LIMIT"
        | "COST_UNKNOWN"
        | "EMERGENCY_STOP"
        | "GLOBAL_DISABLED"
        | "KIND_CONCURRENCY"
        | "PROVIDER_COOLDOWN"
        | "RATE_LIMIT"
        | "USER_CONCURRENCY";
      message: string;
    };

/**
 * A model's own per-task cap wins when set; otherwise the global default
 * applies. USD defaults are converted from the CNY default with the editable
 * exchange rate. One shared helper keeps the model catalog, the submit path
 * and the paid-model safety checks on the same value.
 */
export function effectiveSingleTaskCostMicrounits(
  model: { cost_currency: "CNY" | "USD"; max_cost_microunits: number },
  safety: GenerationSafetySettings,
) {
  if (model.max_cost_microunits > 0) return model.max_cost_microunits;
  if (model.cost_currency === "CNY") {
    return safety.singleTaskDefaultCostCnyMicrounits;
  }
  return Math.round(
    safety.singleTaskDefaultCostCnyMicrounits * 1_000_000 /
      Math.max(safety.usdToCnyRateMicrounits, 1),
  );
}

type SafetyRow = {
  audio_concurrency: number;
  cooldown_minutes: number;
  daily_cost_limit_cny_microunits: number;
  daily_cost_limit_microunits: number;
  emergency_stop: number;
  failure_threshold: number;
  global_enabled: number;
  image_concurrency: number;
  monthly_cost_limit_cny_microunits: number;
  monthly_cost_limit_microunits: number;
  per_user_concurrency: number;
  requests_per_minute: number;
  running_task_policy: RunningTaskPolicy;
  single_task_default_cost_cny_microunits: number;
  text_concurrency: number;
  unknown_cost_policy: "block";
  updated_at: string;
  usd_to_cny_rate_microunits: number;
  video_concurrency: number;
};

type SafetyInput = Omit<
  GenerationSafetySettings,
  "unknownCostPolicy" | "updatedAt"
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

async function readBody<T>(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > 64 * 1_024) throw new Error("请求内容过大");
    chunks.push(bytes);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
}

function toSettings(row: SafetyRow): GenerationSafetySettings {
  return {
    audioConcurrency: Number(row.audio_concurrency),
    cooldownMinutes: Number(row.cooldown_minutes),
    dailyCostLimitCnyMicrounits: Number(row.daily_cost_limit_cny_microunits),
    dailyCostLimitMicrounits: Number(row.daily_cost_limit_microunits),
    emergencyStop: Boolean(row.emergency_stop),
    failureThreshold: Number(row.failure_threshold),
    globalEnabled: Boolean(row.global_enabled),
    imageConcurrency: Number(row.image_concurrency),
    monthlyCostLimitCnyMicrounits: Number(row.monthly_cost_limit_cny_microunits),
    monthlyCostLimitMicrounits: Number(row.monthly_cost_limit_microunits),
    perUserConcurrency: Number(row.per_user_concurrency),
    requestsPerMinute: Number(row.requests_per_minute),
    runningTaskPolicy: row.running_task_policy,
    singleTaskDefaultCostCnyMicrounits: Number(
      row.single_task_default_cost_cny_microunits,
    ),
    textConcurrency: Number(row.text_concurrency),
    unknownCostPolicy: "block",
    updatedAt: row.updated_at,
    usdToCnyRateMicrounits: Number(row.usd_to_cny_rate_microunits),
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
      20,
      "音频并发",
    ),
    cooldownMinutes: cleanInteger(
      input.cooldownMinutes,
      1,
      1_440,
      "熔断时间",
    ),
    dailyCostLimitMicrounits: cleanInteger(
      input.dailyCostLimitMicrounits,
      0,
      1_000_000_000_000,
      "每日费用",
    ),
    dailyCostLimitCnyMicrounits: cleanInteger(
      input.dailyCostLimitCnyMicrounits ?? 0,
      0,
      1_000_000_000_000,
      "每日人民币费用",
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
      20,
      "图片并发",
    ),
    monthlyCostLimitMicrounits: cleanInteger(
      input.monthlyCostLimitMicrounits,
      0,
      10_000_000_000_000,
      "每月费用",
    ),
    monthlyCostLimitCnyMicrounits: cleanInteger(
      input.monthlyCostLimitCnyMicrounits ?? 0,
      0,
      10_000_000_000_000,
      "每月人民币费用",
    ),
    perUserConcurrency: cleanInteger(
      input.perUserConcurrency,
      1,
      20,
      "用户并发",
    ),
    requestsPerMinute: cleanInteger(
      input.requestsPerMinute,
      1,
      120,
      "请求频率",
    ),
    runningTaskPolicy: input.runningTaskPolicy as RunningTaskPolicy,
    singleTaskDefaultCostCnyMicrounits: cleanInteger(
      input.singleTaskDefaultCostCnyMicrounits ?? 0,
      0,
      1_000_000_000_000,
      "单次任务默认费用",
    ),
    textConcurrency: cleanInteger(
      input.textConcurrency,
      1,
      20,
      "文字并发",
    ),
    usdToCnyRateMicrounits: cleanInteger(
      input.usdToCnyRateMicrounits ?? 7_200_000,
      10_000,
      1_000_000_000_000,
      "美元汇率",
    ),
    videoConcurrency: cleanInteger(
      input.videoConcurrency,
      1,
      20,
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
    // Legacy clients and old tests may PUT a settings object without the
    // global-budget fields. Missing fields keep their current stored value
    // instead of being silently reset to defaults.
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
          daily_cost_limit_microunits = ?,
          monthly_cost_limit_microunits = ?,
          daily_cost_limit_cny_microunits = ?,
          monthly_cost_limit_cny_microunits = ?,
          failure_threshold = ?,
          cooldown_minutes = ?,
          running_task_policy = ?,
          single_task_default_cost_cny_microunits = ?,
          usd_to_cny_rate_microunits = ?,
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
        clean.dailyCostLimitMicrounits,
        clean.monthlyCostLimitMicrounits,
        clean.dailyCostLimitCnyMicrounits,
        clean.monthlyCostLimitCnyMicrounits,
        clean.failureThreshold,
        clean.cooldownMinutes,
        clean.runningTaskPolicy,
        clean.singleTaskDefaultCostCnyMicrounits,
        clean.usdToCnyRateMicrounits,
        timestamp,
      );
    return settings();
  }

  function admission(input: {
    costCurrency?: "CNY" | "USD";
    estimatedCostMicrounits?: number;
    kind: GenerationTaskKind;
    now?: Date;
    ownerId: string;
    providerProfileId: string;
  }): GenerationAdmission {
    const row = read.get() as SafetyRow;
    const costCurrency = input.costCurrency ?? "USD";
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
    if (
      input.estimatedCostMicrounits === undefined ||
      !Number.isSafeInteger(input.estimatedCostMicrounits) ||
      input.estimatedCostMicrounits < 0
    ) {
      return {
        allowed: false,
        code: "COST_UNKNOWN",
        message: "本次任务费用无法确认，已在调用模型前阻止",
      };
    }

    const now = input.now ?? new Date();
    const minuteStart = new Date(now.getTime() - 60_000).toISOString();
    const cooldownStart = new Date(
      now.getTime() - row.cooldown_minutes * 60_000,
    ).toISOString();
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);
    const monthStart = new Date(now);
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
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

    const costs = database
      .prepare(`
        SELECT
          COALESCE(SUM(
            CASE
              WHEN cost_currency = 'CNY' AND created_at >= ?
              THEN actual_cost_microunits ELSE 0
            END
          ), 0) AS daily,
          COALESCE(SUM(
            CASE
              WHEN cost_currency = 'USD' AND created_at >= ?
              THEN actual_cost_microunits ELSE 0
            END
          ), 0) AS usd_daily,
          COALESCE(SUM(
            CASE
              WHEN cost_currency = 'CNY' AND created_at >= ?
              THEN actual_cost_microunits ELSE 0
            END
          ), 0) AS cny_monthly,
          COALESCE(SUM(
            CASE
              WHEN cost_currency = 'USD' AND created_at >= ?
              THEN actual_cost_microunits ELSE 0
            END
          ), 0) AS monthly
        FROM generation_tasks
        WHERE actual_cost_microunits IS NOT NULL
      `)
      .get(
        dayStart.toISOString(),
        dayStart.toISOString(),
        monthStart.toISOString(),
        monthStart.toISOString(),
      ) as {
        daily: number;
        monthly: number;
        usd_daily: number;
        cny_monthly: number;
      };
    const estimated = input.estimatedCostMicrounits;
    const cnyDailyLimit = Number(row.daily_cost_limit_cny_microunits);
    const cnyMonthlyLimit = Number(row.monthly_cost_limit_cny_microunits);
    const rate = Math.max(Number(row.usd_to_cny_rate_microunits), 1);
    const usdDailyLimit = cnyDailyLimit === 0
      ? 0
      : Math.round(cnyDailyLimit * 1_000_000 / rate);
    const usdMonthlyLimit = cnyMonthlyLimit === 0
      ? 0
      : Math.round(cnyMonthlyLimit * 1_000_000 / rate);
    const estimatedCny = costCurrency === "CNY"
      ? estimated
      : Math.round(estimated * rate / 1_000_000);
    const estimatedUsd = costCurrency === "USD"
      ? estimated
      : Math.round(estimated * 1_000_000 / rate);
    const usdToCny = (usd: number) =>
      Math.round(usd * rate / 1_000_000);
    const overLimit = (spent: number, extra: number, limit: number) =>
      limit === 0 || spent + extra > limit;
    const cnyDaily = Number(costs.daily);
    const usdDaily = Number(costs.usd_daily);
    const cnyMonthly = Number(costs.cny_monthly);
    const usdMonthly = Number(costs.monthly);
    if (
      overLimit(cnyDaily, estimatedCny, cnyDailyLimit) ||
      overLimit(cnyMonthly, estimatedCny, cnyMonthlyLimit) ||
      overLimit(usdDaily, estimatedUsd, usdDailyLimit) ||
      overLimit(usdMonthly, estimatedUsd, usdMonthlyLimit) ||
      overLimit(
        cnyDaily + usdToCny(usdDaily),
        estimatedCny,
        cnyDailyLimit,
      ) ||
      overLimit(
        cnyMonthly + usdToCny(usdMonthly),
        estimatedCny,
        cnyMonthlyLimit,
      )
    ) {
      return {
        allowed: false,
        code: "COST_LIMIT",
        message: "费用保护已阻止本次任务",
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
  if (!identity || identity.role !== "admin") {
    json(response, 403, {
      error: "只有管理员可以修改生成安全保护",
    });
    return;
  }
  const path = decodeURIComponent((request.url ?? "").split("?")[0]).replace(
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
        await readBody<Partial<SafetyInput>>(request),
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

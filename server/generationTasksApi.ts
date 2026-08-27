import type { IncomingMessage, ServerResponse } from "node:http";
import { requestIdentity } from "./auth";
import {
  decodedRequestPath,
  HttpRequestError,
  readJsonBody,
} from "./httpRequest";
import { CanvasRevisionConflictError } from "./inputPreflight";
import type {
  GenerationPaidRetrySnapshot,
  GenerationTask,
  GenerationTaskCanvasRetryBinding,
  GenerationTaskInput,
} from "./generationTaskStore";
import type {
  NodeInputKind,
  NodeInputSnapshot,
} from "../types/nodeInputs";
import type { ImageGenerationToolInput } from "../types/imageTools";
import { generationTaskApplication } from "./generationTasks";
import { resolveSeedanceTrustedVideoReferences } from "./seedanceTrustedVideoReferences";
import {
  resolveSeedanceCharacterReferences,
  SeedanceCharacterReferenceError,
} from "./seedanceCharacterReferences";

const {
  GenerationProviderAttemptBlockedError,
  GenerationTaskAbandonError,
  GenerationTaskAdmissionError,
  GenerationTaskCanvasRevisionConflictError,
  GenerationTaskConflictError,
  GenerationTaskOwnerDeletingError,
  GenerationTaskProviderBoundaryError,
  GenerationTaskRetryFenceError,
  GenerationTaskTransitionError,
  ProviderProfileLockBusyError,
  acquireProviderGenerationRequestLease,
  assertPersistedCanvasRevision,
  autoMatchRelayProviderTask,
  cancelGenerationTask,
  generationAvailability,
  generationModelSchema,
  generationRequestIntent,
  generationRuntimeDecision,
  generationRuntimeProblems,
  generationSafetyStatus,
  lastReconcileAt,
  launchGenerationTask,
  missingModelMessage,
  pollReconcileProviderTask,
  preAdmissionRuntimeProblem,
  providerConfigurationVersion,
  reconcileCooldownMs,
  requireTaskProviderSnapshot,
  resolveModel,
  resumeProviderTaskSnapshotProblem,
  retrySafetyDecision,
  strictGenerationPreflight,
  taskAuditEstimatedCostMicrounits,
  taskStore,
  taskSummary,
  taskSummaryForOwner,
} = generationTaskApplication;

type NodeInputGenerationRequest =
  Omit<Partial<GenerationTaskInput>, "kind"> & {
    canvasRevision?: number;
    imageTool?: ImageGenerationToolInput;
    inputSchemaVersion?: number;
    inputs?: NodeInputSnapshot[];
    kind?: NodeInputKind;
    ownPrompt?: string;
  };

type StrictGenerationPreflight =
  ReturnType<typeof strictGenerationPreflight>;
type ReconcilePollState =
  Awaited<ReturnType<typeof pollReconcileProviderTask>>;

function json(response: ServerResponse, status: number, body: unknown) {
  response.statusCode = status;
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

function injectInitialGenerationPostCommitFailure(request: IncomingMessage) {
  if (
    process.env.UNBOUNDRY_SAFE_TEST === "1" &&
    request.headers["x-unboundry-test-generation-post-commit-failure"] ===
      "before-launch"
  ) {
    throw new Error("Controlled initial generation post-commit failure");
  }
}

function canvasRevisionConflict(response: ServerResponse, error: unknown) {
  if (
    !(error instanceof CanvasRevisionConflictError) &&
    !(error instanceof GenerationTaskCanvasRevisionConflictError)
  ) return false;
  json(response, 409, {
    code: "CANVAS_NOT_SAVED",
    error: error.message,
    revision: error.revision,
  });
  return true;
}

export async function generationTasks(
  request: IncomingMessage,
  response: ServerResponse,
) {
  const path = decodedRequestPath(request).replace(
    /^\/+/,
    "",
  );
  const identity = requestIdentity(request);
  if (!identity) {
    json(response, 401, { error: "Please sign in" });
    return;
  }

  if (request.method === "GET" && path === "status") {
    taskStore();
    const safety = generationSafetyStatus();
    const availability = await generationAvailability(
      identity.bypass ? "__test__" : identity.userId,
    );
    const { providerCurrencies, ...publicAvailability } = availability;
    json(response, 200, {
      emergencyStop: safety.emergencyStop,
      globalGenerationEnabled: safety.globalEnabled,
      ...publicAvailability,
      persistentQueueReady: true,
      protectionReady: true,
      submissionEnabled:
        availability.providerConfigured &&
        safety.globalEnabled &&
        !safety.emergencyStop,
      audioSubmissionEnabled:
        availability.audioProviderConfigured &&
        safety.globalEnabled &&
        !safety.emergencyStop,
      imageSubmissionEnabled:
        availability.imageProviderConfigured &&
        safety.globalEnabled &&
        !safety.emergencyStop,
      textSubmissionEnabled:
        availability.textProviderConfigured &&
        safety.globalEnabled &&
        !safety.emergencyStop,
      videoSubmissionEnabled:
        availability.videoProviderConfigured &&
        safety.globalEnabled &&
        !safety.emergencyStop,
    });
    return;
  }

  if (request.method === "GET" && path === "") {
    const requestUrl = new URL(request.url ?? "", "http://127.0.0.1");
    const canvasId = requestUrl.searchParams.get("canvasId") ?? "";
    try {
      const generationStore = taskStore();
      const ownerId = identity.bypass ? undefined : identity.userId;
      const tasks = identity.bypass
        ? generationStore.list(canvasId)
        : generationStore.listForOwner(canvasId, identity.userId);
      const bindings = tasks.some(({ state }) => state === "failed")
        ? generationStore.retryBindingsForCanvas(canvasId, ownerId)
        : new Map<string, GenerationTaskCanvasRetryBinding>();
      json(response, 200, {
        tasks: tasks.map((task) => taskSummary(task, bindings.get(task.id))),
      });
    } catch {
      json(response, 400, { error: "Invalid canvas ID" });
    }
    return;
  }

  if (request.method === "GET" && path === "by-idempotency") {
    const requestUrl = new URL(request.url ?? "", "http://127.0.0.1");
    const canvasId = requestUrl.searchParams.get("canvasId") ?? "";
    const idempotencyKey = requestUrl.searchParams.get("idempotencyKey") ?? "";
    try {
      const task = identity.bypass
        ? taskStore().getByIdempotency(canvasId, idempotencyKey)
        : taskStore().getByIdempotencyForOwner(
            canvasId,
            idempotencyKey,
            identity.userId,
          );
      if (!task) {
        json(response, 404, {
          code: "GENERATION_TASK_NOT_FOUND",
          error: "Generation task not found",
        });
        return;
      }
      json(response, 200, taskSummaryForOwner(
        task,
        identity.bypass ? undefined : identity.userId,
      ));
    } catch {
      json(response, 400, { error: "Invalid idempotency lookup" });
    }
    return;
  }

  if (request.method === "DELETE" && /^[a-z0-9._-]+$/i.test(path)) {
    const task = identity.bypass
      ? taskStore().get(path)
      : taskStore().getForOwner(path, identity.userId);
    if (!task) {
      json(response, 404, { error: "Generation task not found" });
      return;
    }
    if (!["queued", "running", "recovering", "retrying"].includes(task.state)) {
      json(response, 409, { error: "Generation task cannot be cancelled" });
      return;
    }
    try {
      await cancelGenerationTask(task);
      const cancelled = taskStore().get(path);
      if (!cancelled) throw new Error("Generation task not found");
      json(response, 200, taskSummaryForOwner(
        cancelled,
        identity.bypass ? undefined : identity.userId,
      ));
    } catch (error) {
      if (
        error instanceof Error &&
        (error as { code?: string }).code === "PROVIDER_CANCEL_UNAVAILABLE"
      ) {
        json(response, 409, {
          code: "PROVIDER_CANCEL_UNAVAILABLE",
          error: error.message,
        });
        return;
      }
      if (error instanceof GenerationTaskProviderBoundaryError) {
        json(response, 409, {
          code: error.code,
          error: error.message,
        });
        return;
      }
      json(response, 409, { error: "Generation task cannot be cancelled" });
    }
    return;
  }

  const abandonMatch = path.match(/^([a-z0-9._-]+)\/abandon$/i);
  if (request.method === "POST" && abandonMatch) {
    const taskId = abandonMatch[1];
    const task = identity.bypass
      ? taskStore().get(taskId)
      : taskStore().getForOwner(taskId, identity.userId);
    if (!task) {
      json(response, 404, { error: "Generation task not found" });
      return;
    }
    try {
      const body = await readJsonBody<{
        acknowledgeRemoteResultMayBeLost?: unknown;
        expectedAttempt?: unknown;
        expectedUpdatedAt?: unknown;
      }>(request, 2 * 1_024);
      if (
        body.acknowledgeRemoteResultMayBeLost !== true ||
        !Number.isSafeInteger(body.expectedAttempt) ||
        Number(body.expectedAttempt) < 1 ||
        typeof body.expectedUpdatedAt !== "string"
      ) {
        json(response, 400, {
          code: "ABANDON_ACK_REQUIRED",
          error: "必须确认将不再尝试恢复该平台结果",
        });
        return;
      }
      const abandoned = taskStore().abandonAcceptedProviderTask({
        expectedAttempt: Number(body.expectedAttempt),
        expectedUpdatedAt: body.expectedUpdatedAt,
        taskId,
      });
      if (!abandoned) throw new Error("Generation task not found");
      json(response, 200, taskSummaryForOwner(
        abandoned,
        identity.bypass ? undefined : identity.userId,
      ));
    } catch (error) {
      if (error instanceof GenerationTaskAbandonError) {
        json(response, 409, {
          code: error.code,
          error: error.message,
        });
        return;
      }
      json(response, 409, {
        code: "PROVIDER_RESULT_NOT_ABANDONABLE",
        error: "Generation task cannot be abandoned",
      });
    }
    return;
  }

  const retryMatch = path.match(/^([a-z0-9._-]+)\/retry$/i);
  if (request.method === "POST" && retryMatch) {
    const taskId = retryMatch[1];
    const body = await readJsonBody<{
      canvasId?: unknown;
      expectedAttempt?: unknown;
      expectedCanvasRevision?: unknown;
      expectedGenerationInputKey?: unknown;
      expectedUpdatedAt?: unknown;
      kind?: unknown;
      nodeId?: unknown;
    }>(request, 256 * 1_024);
    if (
      typeof body.canvasId !== "string" ||
      !/^[a-z0-9._-]{1,120}$/i.test(body.canvasId) ||
      !Number.isSafeInteger(body.expectedAttempt) ||
      Number(body.expectedAttempt) < 0 ||
      !Number.isSafeInteger(body.expectedCanvasRevision) ||
      Number(body.expectedCanvasRevision) < 0 ||
      typeof body.expectedGenerationInputKey !== "string" ||
      body.expectedGenerationInputKey.length < 1 ||
      body.expectedGenerationInputKey.length > 100_000 ||
      typeof body.expectedUpdatedAt !== "string" ||
      body.expectedUpdatedAt.length < 1 ||
      body.expectedUpdatedAt.length > 80 ||
      (body.kind !== "text" &&
        body.kind !== "image" &&
        body.kind !== "video" &&
        body.kind !== "audio") ||
      typeof body.nodeId !== "string" ||
      !/^[a-z0-9._-]{1,160}$/i.test(body.nodeId)
    ) {
      json(response, 400, {
        code: "RETRY_FENCE_REQUIRED",
        error: "重试请求缺少当前画布与任务绑定证据",
      });
      return;
    }
    const task = identity.bypass
      ? taskStore().get(taskId)
      : taskStore().getForOwner(taskId, identity.userId);
    if (!task) {
      json(response, 404, { error: "Generation task not found" });
      return;
    }
    if (
      task.canvasId !== body.canvasId ||
      task.nodeId !== body.nodeId ||
      task.kind !== body.kind
    ) {
      json(response, 409, {
        code: "RETRY_BINDING_STALE",
        error: "任务已不再绑定当前画布节点",
      });
      return;
    }
    if (
      task.attempt !== Number(body.expectedAttempt) ||
      task.updatedAt !== body.expectedUpdatedAt
    ) {
      json(response, 409, {
        code: "RETRY_TASK_CHANGED",
        error: "任务状态已变化，请刷新后再试",
      });
      return;
    }
    const retry = retrySafetyDecision(task);
    if (!retry.allowed) {
      json(response, 409, {
        code: retry.code,
        error: retry.reason,
      });
      return;
    }
    if (retry.mode === "resume-provider-task") {
      const compatibilityProblem = resumeProviderTaskSnapshotProblem(task);
      if (compatibilityProblem) {
        json(response, 409, {
          code: "RETRY_SNAPSHOT_CHANGED",
          error: compatibilityProblem,
        });
        return;
      }
      try {
        if (!task.providerProfileId) throw new Error("Provider profile missing");
        const lease = await acquireProviderGenerationRequestLease(
          task.providerProfileId,
          task.ownerId ?? "",
        );
        try {
          requireTaskProviderSnapshot(
            task,
            lease.profile,
            lease.credentialRevision,
          );
        } finally {
          lease.release();
        }
      } catch (error) {
        if (error instanceof ProviderProfileLockBusyError) {
          json(response, 409, {
            code: "PROVIDER_LOCK_BUSY",
            error: "系统正在处理，请稍后自动重试",
          });
          return;
        }
        json(response, 409, {
          code: "PROVIDER_CONFIGURATION_MISMATCH",
          error: "平台连接已变化，请在节点重新提交，不能继续旧任务",
        });
        return;
      }
    }
    let paidRetrySnapshot: GenerationPaidRetrySnapshot | undefined;
    if (retry.mode === "new-provider-attempt") {
      const runtime = await generationRuntimeDecision({
        canSubmit: true,
        kind: task.kind,
        model: retry.model,
        ownerId: identity.bypass ? "__test__" : identity.userId,
      });
      const runtimeProblem = preAdmissionRuntimeProblem(runtime);
      if (runtimeProblem) {
        json(response, 409, {
          code: runtimeProblem.code,
          error: runtimeProblem.message,
        });
        return;
      }
      if (
        !runtime.providerProfile ||
        !Number.isSafeInteger(runtime.credentialVersion) ||
        Number(runtime.credentialVersion) < 1
      ) {
        json(response, 409, {
          code: "ACCOUNT_CREDENTIAL_CHANGED",
          error: "平台密钥版本已变化，请按当前配置重试",
        });
        return;
      }
      const retryModelReleaseRevision = taskStore()
        .activeModelContractRevision(retry.model.id);
      paidRetrySnapshot = {
        credentialRevision: Number(runtime.credentialVersion),
        modelConfiguration: {
          credentialVersion: Number(runtime.credentialVersion),
          modelId: retry.model.id,
          parameterSchema: generationModelSchema(task.kind, retry.model),
          providerConfigurationVersion: providerConfigurationVersion(
            runtime.providerProfile,
          ),
          providerDriver: retry.model.provider_driver,
          providerModelId: retry.model.provider_model_id,
          providerProtocol: retry.model.provider_protocol ?? "native",
          providerProfileId: retry.model.provider_profile_id,
          ...(retryModelReleaseRevision
            ? { modelReleaseRevision: retryModelReleaseRevision }
            : {}),
        },
        providerModelId: retry.model.provider_model_id,
        providerProfileId: retry.model.provider_profile_id,
      };
    }
    let queued: GenerationTask | undefined;
    try {
      queued = retry.mode === "resume-provider-task"
        ? taskStore().admitRetry({
            canvasId: body.canvasId,
            expectedAttempt: Number(body.expectedAttempt),
            expectedCanvasRevision: Number(body.expectedCanvasRevision),
            expectedGenerationInputKey: body.expectedGenerationInputKey,
            expectedUpdatedAt: body.expectedUpdatedAt,
            kind: body.kind,
            mode: "resume-provider-task",
            nodeId: body.nodeId,
            taskId,
          })
        : taskStore().admitRetry({
            canvasId: body.canvasId,
            expectedAttempt: Number(body.expectedAttempt),
            expectedCanvasRevision: Number(body.expectedCanvasRevision),
            expectedGenerationInputKey: body.expectedGenerationInputKey,
            expectedUpdatedAt: body.expectedUpdatedAt,
            kind: body.kind,
            mode: "new-paid-attempt",
            nodeId: body.nodeId,
            snapshot: paidRetrySnapshot!,
            taskId,
          });
      if (!queued) {
        json(response, 409, {
          code: "RETRY_TASK_CHANGED",
          error: "任务状态已变化，请刷新后再试",
        });
        return;
      }
    } catch (error) {
      if (canvasRevisionConflict(response, error)) {
        // The final BEGIN IMMEDIATE fence observed a newer durable graph.
      } else if (error instanceof GenerationTaskRetryFenceError) {
        json(response, 409, { code: error.code, error: error.message });
      } else if (error instanceof GenerationTaskAdmissionError) {
        json(response, 409, { code: error.code, error: error.message });
      } else if (error instanceof GenerationProviderAttemptBlockedError) {
        json(response, 409, { code: error.code, error: error.message });
      } else if (error instanceof GenerationTaskOwnerDeletingError) {
        json(response, 409, { code: error.code, error: error.message });
      } else if (error instanceof GenerationTaskTransitionError) {
        json(response, 409, {
          code: "RETRY_TASK_CHANGED",
          error: "任务状态已变化，请刷新后再试",
        });
      } else {
        json(response, 500, {
          code: "GENERATION_RETRY_FAILED",
          error: "生成任务重试暂时无法处理，系统会继续自动跟进",
        });
      }
      return;
    }
    let summary: ReturnType<typeof taskSummaryForOwner>;
    try {
      launchGenerationTask(taskId, task.kind);
      summary = taskSummaryForOwner(
        queued,
        identity.bypass ? undefined : identity.userId,
      );
    } catch {
      // admitRetry already committed. A 5xx lets the client reconcile the exact
      // task without issuing a second retry mutation.
      json(response, 500, {
        code: "GENERATION_RETRY_ACCEPTED_RESPONSE_FAILED",
        error: "重试已提交，任务响应暂不可用；系统会自动跟进",
      });
      return;
    }
    json(response, 202, summary);
    return;
  }

  const reconcileMatch = path.match(/^([a-z0-9._-]+)\/reconcile$/i);
  if (request.method === "POST" && reconcileMatch) {
    const taskId = reconcileMatch[1];
    const body = await readJsonBody<{
      canvasId?: unknown;
      expectedAttempt?: unknown;
      expectedCanvasRevision?: unknown;
      expectedGenerationInputKey?: unknown;
      expectedUpdatedAt?: unknown;
      kind?: unknown;
      nodeId?: unknown;
      providerTaskId?: unknown;
    }>(request, 16 * 1_024);
    if (
      typeof body.canvasId !== "string" ||
      !/^[a-z0-9._-]{1,120}$/i.test(body.canvasId) ||
      !Number.isSafeInteger(body.expectedAttempt) ||
      Number(body.expectedAttempt) < 0 ||
      !Number.isSafeInteger(body.expectedCanvasRevision) ||
      Number(body.expectedCanvasRevision) < 0 ||
      typeof body.expectedGenerationInputKey !== "string" ||
      body.expectedGenerationInputKey.length < 1 ||
      body.expectedGenerationInputKey.length > 100_000 ||
      typeof body.expectedUpdatedAt !== "string" ||
      body.expectedUpdatedAt.length < 1 ||
      body.expectedUpdatedAt.length > 80 ||
      (body.kind !== "text" &&
        body.kind !== "image" &&
        body.kind !== "video" &&
        body.kind !== "audio") ||
      typeof body.nodeId !== "string" ||
      !/^[a-z0-9._-]{1,160}$/i.test(body.nodeId)
    ) {
      json(response, 400, {
        code: "RECONCILE_FENCE_REQUIRED",
        error: "核对请求缺少当前画布与任务绑定证据",
      });
      return;
    }
    const providedTaskId = typeof body.providerTaskId === "string"
      ? body.providerTaskId.trim()
      : "";
    if (
      providedTaskId &&
      (!/^[a-z0-9._:-]{1,160}$/i.test(providedTaskId))
    ) {
      json(response, 400, {
        code: "PROVIDER_TASK_ID_INVALID",
        error: "平台任务号格式不正确",
      });
      return;
    }
    if (providedTaskId) {
      json(response, 400, {
        code: "PROVIDER_TASK_ID_UNVERIFIED",
        error: "不能仅凭手工平台任务号认领结果；系统只接受Provider只读账本的唯一匹配",
      });
      return;
    }
    const task = identity.bypass
      ? taskStore().get(taskId)
      : taskStore().getForOwner(taskId, identity.userId);
    if (!task) {
      json(response, 404, { error: "Generation task not found" });
      return;
    }
    if (
      task.canvasId !== body.canvasId ||
      task.nodeId !== body.nodeId ||
      task.kind !== body.kind
    ) {
      json(response, 409, {
        code: "RETRY_BINDING_STALE",
        error: "任务已不再绑定当前画布节点",
      });
      return;
    }
    if (
      task.attempt !== Number(body.expectedAttempt) ||
      task.updatedAt !== body.expectedUpdatedAt
    ) {
      json(response, 409, {
        code: "RETRY_TASK_CHANGED",
        error: "任务状态已变化，请刷新后再试",
      });
      return;
    }
    if (task.state !== "failed") {
      json(response, 409, {
        code: "TASK_NOT_FAILED",
        error: "只有失败任务可以核对结果",
      });
      return;
    }
    if (task.errorCode === "OPERATOR_INCIDENT") {
      json(response, 409, {
        code: "OPERATOR_INCIDENT",
        error: "该任务已进入管理员事故队列，不能人工核对或重新提交",
      });
      return;
    }
    const now = Date.now();
    const previous = lastReconcileAt.get(task.id) ?? 0;
    if (now - previous < reconcileCooldownMs) {
      json(response, 429, {
        code: "RECONCILE_RATE_LIMIT",
        error: "系统正在自动找回结果，请稍后查看",
      });
      return;
    }
    lastReconcileAt.set(task.id, now);
    let current = task;
    if (!current.providerTaskId) {
      let match: Awaited<ReturnType<typeof autoMatchRelayProviderTask>>;
      try {
        match = await autoMatchRelayProviderTask(current);
      } catch {
        json(response, 200, {
          outcome: "check-failed",
          task: taskSummaryForOwner(
            current,
            identity.bypass ? undefined : identity.userId,
          ),
        });
        return;
      }
      if (match.status === "many") {
        json(response, 200, {
          outcome: "ambiguous",
          task: taskSummaryForOwner(
            current,
            identity.bypass ? undefined : identity.userId,
          ),
        });
        return;
      }
      if (match.status === "one") {
        try {
          current = taskStore().bindVerifiedProviderTaskIdOnFailedTask({
            providerTaskId: match.record.taskId,
            taskId: current.id,
          });
        } catch {
          json(response, 200, {
            outcome: "check-failed",
            task: taskSummaryForOwner(
              current,
              identity.bypass ? undefined : identity.userId,
            ),
          });
          return;
        }
      }
    }
    if (!current.providerTaskId) {
      try {
        current = taskStore().markOutcomeUnknownBillingRisk({
          expectedUpdatedAt: current.updatedAt,
          taskId: current.id,
        });
      } catch {
        json(response, 409, {
          code: "RETRY_TASK_CHANGED",
          error: "任务状态已变化，请刷新后再试",
        });
        return;
      }
      json(response, 200, {
        outcome: "outcome-unknown",
        task: taskSummaryForOwner(
          current,
          identity.bypass ? undefined : identity.userId,
        ),
      });
      return;
    }
    let pollState: ReconcilePollState;
    const pollController = new AbortController();
    const pollTimer = setTimeout(() => pollController.abort(), 20_000);
    try {
      pollState = await pollReconcileProviderTask(
        current,
        current.providerTaskId,
        pollController.signal,
      );
    } catch {
      json(response, 200, {
        outcome: "check-failed",
        task: taskSummaryForOwner(
          current,
          identity.bypass ? undefined : identity.userId,
        ),
      });
      return;
    } finally {
      clearTimeout(pollTimer);
    }
    if (pollState === "cannot-query") {
      json(response, 200, {
        outcome: "check-failed",
        task: taskSummaryForOwner(
          current,
          identity.bypass ? undefined : identity.userId,
        ),
      });
      return;
    }
    if (pollState === "running") {
      json(response, 200, {
        outcome: "still-running",
        task: taskSummaryForOwner(
          current,
          identity.bypass ? undefined : identity.userId,
        ),
      });
      return;
    }
    if (pollState === "failed") {
      try {
        current = taskStore().markOutcomeUnknownBillingRisk({
          expectedUpdatedAt: current.updatedAt,
          taskId: current.id,
        });
      } catch {
        json(response, 409, {
          code: "RETRY_TASK_CHANGED",
          error: "任务状态已变化，请刷新后再试",
        });
        return;
      }
      json(response, 200, {
        outcome: "outcome-unknown",
        task: taskSummaryForOwner(
          current,
          identity.bypass ? undefined : identity.userId,
        ),
      });
      return;
    }
    let queued: GenerationTask | undefined;
    try {
      queued = taskStore().admitRetry({
        canvasId: body.canvasId,
        expectedAttempt: current.attempt,
        expectedCanvasRevision: Number(body.expectedCanvasRevision),
        expectedGenerationInputKey: body.expectedGenerationInputKey,
        expectedUpdatedAt: current.updatedAt,
        kind: body.kind,
        mode: "resume-provider-task",
        nodeId: body.nodeId,
        taskId: current.id,
      });
    } catch (error) {
      if (canvasRevisionConflict(response, error)) return;
      json(response, 409, {
        code: "RECONCILE_RESUME_FAILED",
        error: error instanceof Error ? error.message : "无法收回平台结果",
      });
      return;
    }
    if (!queued) {
      json(response, 409, {
        code: "RETRY_TASK_CHANGED",
        error: "任务状态已变化，请刷新后再试",
      });
      return;
    }
    try {
      launchGenerationTask(queued.id, queued.kind);
    } catch {
      json(response, 500, {
        code: "GENERATION_RETRY_ACCEPTED_RESPONSE_FAILED",
        error: "结果收回已开始，系统会自动跟进",
      });
      return;
    }
    json(response, 200, {
      outcome: "recovered",
      task: taskSummaryForOwner(
        queued,
        identity.bypass ? undefined : identity.userId,
      ),
    });
    return;
  }

  if (request.method === "GET" && /^[a-z0-9._-]+$/i.test(path)) {
    const task = identity.bypass
      ? taskStore().get(path)
      : taskStore().getForOwner(path, identity.userId);
    if (!task) {
      json(response, 404, { error: "Generation task not found" });
      return;
    }
    json(response, 200, taskSummaryForOwner(
      task,
      identity.bypass ? undefined : identity.userId,
    ));
    return;
  }

  if (request.method === "POST" && path === "preflight") {
    try {
      const body = await readJsonBody<NodeInputGenerationRequest>(
        request,
        64 * 1_024,
      );
      if (
        body.kind !== "text" &&
        body.kind !== "image" &&
        body.kind !== "video" &&
        body.kind !== "audio"
      ) {
        json(response, 400, { error: "输入类型无效" });
        return;
      }
      const model = resolveModel(
        body.kind,
        body.model,
        identity.bypass ? "__test__" : identity.userId,
      );
      if (!model) {
        const message = missingModelMessage(body.kind);
        json(response, 409, {
          code: "MODEL_UNAVAILABLE",
          error: message,
          problems: generationRuntimeProblems({
            code: "MODEL_UNAVAILABLE",
            message,
          }),
        });
        return;
      }
      if (
        body.inputSchemaVersion !== undefined &&
        body.inputSchemaVersion !== 1
      ) {
        json(response, 409, {
          code: "INPUT_SCHEMA_UNSUPPORTED",
          error: "节点输入版本不受支持",
        });
        return;
      }
      const preflight = strictGenerationPreflight({
        body,
        bypass: identity.bypass,
        model,
        ownerId: identity.bypass ? "__test__" : identity.userId,
        requireFreshRevision: false,
        targetKind: body.kind,
      });
      const runtime = await generationRuntimeDecision({
        canSubmit: preflight.canSubmit,
        kind: body.kind,
        model,
        ownerId: identity.bypass ? "__test__" : identity.userId,
      });
      const { providerProfile: _providerProfile, ...availability } = runtime;
      json(response, 200, {
        ...preflight,
        ...availability,
        modelId: model.id,
        providerRequests: 0,
      });
    } catch (error) {
      if (error instanceof HttpRequestError) throw error;
      if (canvasRevisionConflict(response, error)) return;
      json(response, 400, {
        error: error instanceof Error ? error.message : "提交前检查失败",
      });
    }
    return;
  }

  if (request.method === "POST" && (path === "" || path === "/")) {
    try {
      const body = await readJsonBody<NodeInputGenerationRequest>(
        request,
        64 * 1_024,
      );
      if (
        body.kind !== "text" && body.kind !== "image" &&
        body.kind !== "video" && body.kind !== "audio"
      ) {
        json(response, 503, {
          code: "GENERATION_DISABLED",
          error: "当前节点尚未接通生成",
        });
        return;
      }
      const ownerId = identity.bypass ? "__test__" : identity.userId;
      const idempotencyKey = String(body.idempotencyKey ?? "");
      const requestIntent = generationRequestIntent(body, body.kind);
      const existing = taskStore().getIdempotentIntent({
        canvasId: String(body.canvasId ?? ""),
        idempotencyKey,
        ownerId,
        requestIntent,
      });
      if (existing) {
        json(response, 200, taskSummaryForOwner(
          existing,
          identity.bypass ? undefined : identity.userId,
        ));
        return;
      }
      const model = resolveModel(
        body.kind,
        body.model,
        ownerId,
      );
      if (!model) {
        const message = missingModelMessage(body.kind);
        json(response, 503, {
          code: "MODEL_UNAVAILABLE",
          error: message,
          problems: generationRuntimeProblems({
            code: "MODEL_UNAVAILABLE",
            message,
          }),
        });
        return;
      }
      if (
        body.inputSchemaVersion !== undefined &&
        body.inputSchemaVersion !== 1
      ) {
        json(response, 409, {
          code: "INPUT_SCHEMA_UNSUPPORTED",
          error: "节点输入版本不受支持",
        });
        return;
      }
      let strictInput: StrictGenerationPreflight;
      try {
        strictInput = strictGenerationPreflight({
          body,
          bypass: identity.bypass,
          model,
          ownerId,
          requireFreshRevision: true,
          targetKind: body.kind,
        });
      } catch (error) {
        if (canvasRevisionConflict(response, error)) return;
        json(response, 409, {
          code: "INPUT_INVALID",
          error: error instanceof Error ? error.message : "节点输入不完整",
        });
        return;
      }
      if (!strictInput.canSubmit) {
        json(response, 409, {
          code: "INPUT_INVALID",
          error: strictInput.problems[0]?.message ?? "节点输入不完整",
          problems: strictInput.problems,
        });
        return;
      }
      const runtime = await generationRuntimeDecision({
        canSubmit: strictInput.canSubmit,
        kind: body.kind,
        model,
        ownerId,
      });
      const runtimeProblem = preAdmissionRuntimeProblem(runtime);
      if (runtimeProblem || !runtime.providerProfile) {
        const problem = runtimeProblem ?? {
          code: "MODEL_UNAVAILABLE",
          message: "当前模型暂不可生成",
        };
        json(response, runtime.generationAvailable ? 409 : 503, {
          code: problem.code,
          error: problem.message,
          problems: generationRuntimeProblems(problem),
        });
        return;
      }
      const schema = generationModelSchema(body.kind, model);
      const { imageTool, parameters, references } = strictInput;
      let persistedInputs = strictInput.snapshot;
      if (body.kind === "video" && model.provider_driver === "volcengine-ark") {
        try {
          persistedInputs = await resolveSeedanceTrustedVideoReferences({
            inputs: strictInput.snapshot,
            ownerId,
            providerProfileId: model.provider_profile_id,
          });
          persistedInputs = await resolveSeedanceCharacterReferences({
            generation: {
              credentialVersion: Number(runtime.credentialVersion),
              modelId: model.id,
              providerConfigurationVersion: providerConfigurationVersion(
                runtime.providerProfile,
              ),
              providerProfileId: model.provider_profile_id,
            },
            inputs: persistedInputs,
            ownerId,
            phase: "task-create",
          });
        } catch (error) {
          if (error instanceof SeedanceCharacterReferenceError) {
            json(response, 409, { code: error.code, error: error.message });
            return;
          }
          throw error;
        }
      }
      if (body.kind === "audio" && parameters.outputCount !== 1) {
        json(response, 409, {
          code: "OUTPUT_COUNT_UNSUPPORTED",
          error: "本次真实验收仅允许生成 1 条音频",
        });
        return;
      }
      if (body.kind === "text" && parameters.outputCount !== 1) {
        json(response, 409, {
          code: "OUTPUT_COUNT_UNSUPPORTED",
          error: "当前文字任务每次只生成 1 份结果",
        });
        return;
      }
      if (body.canvasRevision !== undefined) {
        assertPersistedCanvasRevision({
          bypass: identity.bypass,
          canvasId: String(body.canvasId ?? ""),
          expectedRevision: body.canvasRevision,
          ownerId,
        });
      }
      const activeModelReleaseRevision = taskStore()
        .activeModelContractRevision(model.id);
      const created = taskStore().admitOrGet({
        canvasId: String(body.canvasId ?? ""),
        credentialRevision: runtime.credentialVersion,
        expectedCanvasRevision: body.canvasRevision,
        estimatedCostMicrounits: taskAuditEstimatedCostMicrounits[
          model.cost_currency
        ],
        costCurrency: model.cost_currency,
        idempotencyKey,
        kind: body.kind,
        model: model.id,
        modelConfiguration: {
          credentialVersion: runtime.credentialVersion,
          modelId: model.id,
          parameterSchema: schema,
          providerConfigurationVersion: providerConfigurationVersion(
            runtime.providerProfile,
          ),
          providerDriver: model.provider_driver,
          providerModelId: model.provider_model_id,
          providerProtocol: model.provider_protocol ?? "native",
          providerProfileId: model.provider_profile_id,
          ...(activeModelReleaseRevision
            ? { modelReleaseRevision: activeModelReleaseRevision }
            : {}),
        },
        nodeId: String(body.nodeId ?? ""),
        ownerId,
        parameters: body.kind === "text"
          ? {
              ...parameters,
              inputSchemaVersion: 1,
              inputs: strictInput.inputs.map((item) => ({
                assetId: item.assetId,
                kind: item.kind,
                order: item.order,
                role: item.role,
                sourceNodeId: item.sourceNodeId,
                ...(item.kind === "text" ? { text: item.text } : {}),
              })),
            }
          : body.kind === "image"
          ? {
              ...parameters,
              ...(imageTool ? { imageTool } : {}),
              references,
              inputSchemaVersion: 1,
              inputs: strictInput.snapshot,
            }
          : {
              ...parameters,
              inputSchemaVersion: 1,
              inputs: persistedInputs,
            },
        prompt: strictInput.finalPrompt,
        providerModelId: model.provider_model_id,
        providerProfileId: model.provider_profile_id,
        requestIntent,
      });
      try {
        injectInitialGenerationPostCommitFailure(request);
        if (created.created) {
          launchGenerationTask(created.task.id, body.kind);
        }
        json(
          response,
          created.created ? 202 : 200,
          taskSummaryForOwner(
            created.task,
            identity.bypass ? undefined : identity.userId,
          ),
        );
      } catch {
        // admitOrGet already committed. A 5xx makes the browser reconcile this
        // exact owner-scoped idempotency key instead of minting a second paid
        // task. If the socket itself is gone, the network failure has the same
        // reconcilable meaning and must not escape into the outer 4xx mapper.
        try {
          json(response, 500, {
            code: "GENERATION_TASK_ACCEPTED_RESPONSE_FAILED",
            error: "生成任务已提交，响应暂不可用；系统会自动跟进",
          });
        } catch {}
      }
    } catch (error) {
      if (error instanceof HttpRequestError) throw error;
      if (canvasRevisionConflict(response, error)) {
        return;
      } else if (error instanceof GenerationTaskConflictError) {
        json(response, 409, {
          code: "IDEMPOTENCY_CONFLICT",
          error: error.message,
        });
      } else if (error instanceof GenerationTaskOwnerDeletingError) {
        json(response, 409, {
          code: error.code,
          error: "账号删除正在进行，不能再创建或重试生成任务",
        });
      } else if (error instanceof GenerationTaskAdmissionError) {
        json(response, 409, {
          code: error.code,
          error: error.message,
        });
      } else if (error instanceof GenerationProviderAttemptBlockedError) {
        json(response, 409, {
          code: error.code,
          error: error.message,
        });
      } else {
        json(response, 400, { error: "生成请求无效" });
      }
    }
    return;
  }

  response.setHeader("Allow", "GET, POST, DELETE");
  json(response, 404, { error: "Generation task endpoint not found" });
}

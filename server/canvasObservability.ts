/**
 * Small in-process sink for Canvas boundary evidence.
 *
 * This module intentionally accepts only flat, bounded event contracts. It
 * does not serialize or print caller data. Production integrations can drain
 * immutable snapshots into their own logger/metric sink, while tests can use
 * the same deterministic counters without opening a database or a network
 * connection.
 */

export const canvasObservabilityMaxEvents = 512;

const commandEventKeys = [
  "commandKind",
  "operationId",
  "actor",
  "affectedNodeHash",
  "beforeDocumentRevision",
  "afterDocumentRevision",
  "beforeInputRevision",
  "afterInputRevision",
  "outcome",
  "requestId",
] as const;

const routeEventKeys = [
  "clientBuild",
  "capability",
  "route",
  "callerSymbol",
  "serverClass",
  "operation",
  "runId",
  "taskId",
  "outcome",
  "requestId",
] as const;

const generationLifecycleEventKeys = [
  "kind",
  "operation",
  "runId",
  "taskId",
  "taskState",
  "projectionState",
  "outcome",
  "requestId",
] as const;

const safeLabelPattern = /^[A-Za-z0-9][A-Za-z0-9._:/+@=-]{0,255}$/;
const obviousSensitiveValuePattern =
  /(?:\b(?:prompt|password|credential|secret|api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token)\b\s*[:=]|\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]{12,}|(?:^|[\s'"=])sk-[A-Za-z0-9_-]{12,}|^eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}$|^(?:data|blob|file):|^https?:\/\/|[?&](?:token|signature|sig|secret|key)=|\/api\/(?:assets|audio-assets|video-assets)\/)/i;
const sensitiveKeyPattern =
  /(?:prompt|password|credential|secret|token|api[-_ ]?key|signed[-_ ]?url|media(?:data|content)?)/i;

const canvasConflictOutcomeCodes = new Set([
  "CANVAS_ALREADY_EXISTS",
  "CANVAS_LEGACY_RECONCILE_REQUIRED",
  "CANVAS_LOAD_REQUIRED",
  "CANVAS_MEDIA_UNAVAILABLE",
  "CANVAS_OPERATION_REUSED",
  "CANVAS_PROJECT_DELETED",
  "CANVAS_PROJECT_NOT_OWNED",
  "CANVAS_SAVE_SUPERSEDED",
  "CANVAS_SERVER_OWNERSHIP_CONFLICT",
  "CANVAS_TOPOLOGY_CONFLICT",
  "GENERATION_TERMINAL_BINDING_CONFLICT",
  "GENERATION_TERMINAL_PROOF_CONFLICT",
  "GENERATION_TERMINAL_STATE_CONFLICT",
  "GENERATION_TERMINAL_TASK_CONFLICT",
  "WORKFLOW_GRAPH_LOCKED",
]);

const commandRejectedOutcomeCodes = new Set([
  "AUTH_REQUIRED",
  "CANVAS_COMMAND_INVALID",
  "CANVAS_COMMAND_ROUTE_NOT_FOUND",
  "CANVAS_NOT_FOUND",
  "CANVAS_WRITE_CONTRACT_UNSUPPORTED",
  "INVALID_JSON",
  "MALFORMED_URL",
  "METHOD_NOT_ALLOWED",
  "PAYLOAD_TOO_LARGE",
  "REQUEST_TIMEOUT",
  "UNSUPPORTED_MEDIA_TYPE",
]);

const commandFailedOutcomeCodes = new Set([
  "CANVAS_COMMAND_RECEIPT_UNAVAILABLE",
  "CANVAS_OPERATION_RECEIPT_CAPACITY",
]);

const legacyRejectedOutcomeCodes = new Set([
  "AUTH_REQUIRED",
  "CANVAS_DOCUMENT_INVALID",
  "CANVAS_GENERATION_PROJECTION_CONFLICT",
  "CANVAS_ID_INVALID",
  "CANVAS_LEGACY_WRITE_IDENTITY_INVALID",
  "CANVAS_LOAD_REQUIRED",
  "CANVAS_MEDIA_UNAVAILABLE",
  "CANVAS_NOT_FOUND",
  "CANVAS_PROJECT_DELETED",
  "CANVAS_PROJECT_NOT_OWNED",
  "CANVAS_RECONCILIATION_NOT_FOUND",
  "CANVAS_SAVE_SUPERSEDED",
  "CANVAS_TOPOLOGY_CONFLICT",
  "CANVAS_WORKFLOW_PROJECTION_STALE",
  "CANVAS_WRITE_CONTRACT_UNSUPPORTED",
  "GENERATION_TERMINAL_DETACH_INVALID",
  "INVALID_JSON",
  "MALFORMED_URL",
  "METHOD_NOT_ALLOWED",
  "PAYLOAD_TOO_LARGE",
  "REQUEST_TIMEOUT",
  "UNSUPPORTED_MEDIA_TYPE",
  "WORKFLOW_GRAPH_LOCKED",
]);

const legacyFailedOutcomeCodes = new Set([
  "CANVAS_COMMAND_RECEIPT_UNAVAILABLE",
  "CANVAS_OPERATION_RECEIPT_CAPACITY",
  "CANVAS_SAVE_SESSION_CAPACITY",
]);

const commandExactOutcomes = new Set([
  "command.applied",
  "command.no-op",
  "legacy.already-detached",
  "legacy.applied",
  "legacy.detached",
  "legacy.no-op",
  "legacy.reconcile-required",
  "projection.applied",
  "projection.conflict",
  "projection.failed",
  "projection.settlement-unavailable",
]);

const routeExactOutcomes = new Set([
  ...commandExactOutcomes,
  "legacy.policy-detect-only",
  "legacy.policy-write-enabled",
]);

const lifecycleExactOutcomes = new Set([
  "generation-task.cancelled",
  "generation-task.failed",
  "generation-task.queued",
  "generation-task.recovering",
  "generation-task.retrying",
  "generation-task.running",
  "generation-task.success",
  "projection.applied",
  "projection.conflict",
  "projection.failed",
  "projection.settlement-unavailable",
  "provider-attempt.accepted",
  "provider-attempt.boundary-claimed",
  "provider-attempt.completed",
  "provider-attempt.definitive-rejected",
  "provider-attempt.duplicate",
  "provider-attempt.outcome-unknown",
  "provider-attempt.provider-failed",
  "provider-attempt.response-received",
  "workflow-node.admitted",
  "workflow-node.admitting",
  "workflow-node.blocked",
  "workflow-node.cancelled",
  "workflow-node.failed",
  "workflow-node.pending",
  "workflow-node.success",
  "workflow-run.cancelled",
  "workflow-run.failed",
  "workflow-run.running",
  "workflow-run.stopping",
  "workflow-run.success",
]);

export type CanvasServerClass = "A" | "B" | "C" | "D" | "T";

export const canvasRouteCallerSymbols = [
  "client.canvasPersistenceFacade",
  "client.legacyTerminalGenerationReconciler",
  "server.canvasWorkflowProjection",
  "server.generationAdmissionApplication",
  "server.generationCanvasProjectionService",
  "server.legacyTerminalDetachSweep",
  "unknown",
] as const;

export type CanvasRouteCallerSymbol =
  typeof canvasRouteCallerSymbols[number];

export type CanvasProjectionState =
  | "pending"
  | "applied"
  | "conflict"
  | "failed"
  | "settlement-unavailable";

export type CanvasGenerationKind = "audio" | "image" | "text" | "video";

export type CanvasGenerationTaskState =
  | "queued"
  | "running"
  | "success"
  | "failed"
  | "cancelled"
  | "retrying"
  | "recovering";

export type CanvasCommandEventInput = Readonly<{
  commandKind: string;
  operationId: string;
  actor: string;
  affectedNodeHash: string;
  beforeDocumentRevision: number | null;
  afterDocumentRevision: number | null;
  beforeInputRevision: number | null;
  afterInputRevision: number | null;
  outcome: string;
  requestId: string;
}>;

export type CanvasRouteEventInput = Readonly<{
  clientBuild: string;
  capability: string;
  route: string;
  callerSymbol: CanvasRouteCallerSymbol;
  serverClass: CanvasServerClass;
  operation: string;
  runId: string | null;
  taskId: string | null;
  outcome: string;
  requestId: string;
}>;

/**
 * A task-state event keeps terminal task success independent from Canvas
 * projection state. For example, taskState="success" with
 * projectionState="pending" is valid and is intentionally not rewritten to
 * a failed task outcome.
 */
export type GenerationLifecycleEventInput = Readonly<{
  kind: CanvasGenerationKind;
  operation: string;
  runId: string | null;
  taskId: string;
  taskState: CanvasGenerationTaskState;
  projectionState: CanvasProjectionState;
  outcome: string;
  requestId: string;
}>;

export type CanvasCommandEvent = CanvasCommandEventInput & Readonly<{
  event: "command";
}>;

export type CanvasRouteEvent = CanvasRouteEventInput & Readonly<{
  event: "route";
}>;

export type GenerationLifecycleEvent = GenerationLifecycleEventInput & Readonly<{
  event: "generation-lifecycle";
}>;

export type CanvasObservabilityEvent =
  | CanvasCommandEvent
  | CanvasRouteEvent
  | GenerationLifecycleEvent;

export type CanvasCommandCounter = Readonly<{
  actor: string;
  commandKind: string;
  count: number;
  outcome: string;
}>;

export type CanvasRouteCounter = Readonly<{
  callerSymbol: CanvasRouteCallerSymbol;
  capability: string;
  clientBuild: string;
  count: number;
  operation: string;
  outcome: string;
  requestId: string;
  route: string;
  runId: string | null;
  serverClass: CanvasServerClass;
  taskId: string | null;
}>;

export type GenerationLifecycleCounter = Readonly<{
  count: number;
  kind: CanvasGenerationKind;
  operation: string;
  outcome: string;
  projectionState: CanvasProjectionState;
  taskState: CanvasGenerationTaskState;
}>;

export type CanvasObservabilitySnapshot = Readonly<{
  alerts: Readonly<{
    operationIdentityReuse: number;
    projectionBacklog: number;
    providerDuplicate: number;
    refreshDurableWrite: number;
  }>;
  counters: Readonly<{
    command: readonly CanvasCommandCounter[];
    generationLifecycle: readonly GenerationLifecycleCounter[];
    route: readonly CanvasRouteCounter[];
  }>;
  events: readonly CanvasObservabilityEvent[];
  releaseEvidence: Readonly<{
    legacyNotAllowlisted: number;
    modernDoubleWrites: number;
    modernLegacyProjectionOrDetachByBuild: readonly Readonly<{
      clientBuild: string;
      count: number;
    }>[];
    unknownCallers: number;
  }>;
}>;

export class CanvasObservabilityValidationError extends Error {
  constructor() {
    super("Invalid Canvas observability event");
    this.name = "CanvasObservabilityValidationError";
  }
}

const events: CanvasObservabilityEvent[] = [];
let deferredEvents = new WeakMap<object, CanvasObservabilityEvent[]>();
let testSink: ((event: CanvasObservabilityEvent) => void) | undefined;
let operationIdentityReuseKeys = new Set<string>();
let providerDuplicateCount = 0;
let refreshDurableWriteCount = 0;
let latestSuccessProjectionByTask = new Map<string, CanvasProjectionState>();
let legacyNotAllowlistedCount = 0;
let unknownCallerCount = 0;
let serverProjectedTasks = new Set<string>();
let browserLegacyTasks = new Set<string>();
let modernDoubleWriteTasks = new Set<string>();
let modernLegacyProjectionOrDetachByBuild = new Map<string, number>();

function invalid(): never {
  throw new CanvasObservabilityValidationError();
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(
  value: unknown,
  expected: readonly string[],
): asserts value is Record<string, unknown> {
  if (!plainRecord(value)) invalid();
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== expected.length ||
    actual.some((key) => typeof key !== "string" || !expected.includes(key)) ||
    expected.some((key) => !actual.includes(key))
  ) {
    const hasSensitiveKey = actual.some((key) =>
      typeof key === "string" && sensitiveKeyPattern.test(key),
    );
    if (hasSensitiveKey) invalid();
    invalid();
  }
  for (const key of actual) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) invalid();
  }
}

function safeLabel(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 256 ||
    !safeLabelPattern.test(value) ||
    obviousSensitiveValuePattern.test(value)
  ) invalid();
}

function safeNullableLabel(value: unknown): asserts value is string | null {
  if (value === null) return;
  safeLabel(value);
}

function safeNamespacedOutcome(value: unknown): asserts value is string {
  safeLabel(value);
  if (!/^[a-z][a-z0-9-]*(?:\.[A-Za-z0-9_-]+)+$/.test(value)) invalid();
}

function suffixIn(
  value: string,
  prefix: string,
  allowed: ReadonlySet<string>,
) {
  return value.startsWith(prefix) && allowed.has(value.slice(prefix.length));
}

function safeCommandOutcome(value: unknown): asserts value is string {
  safeNamespacedOutcome(value);
  if (
    !commandExactOutcomes.has(value) &&
    !suffixIn(value, "command.rejected-conflict.", canvasConflictOutcomeCodes)
  ) invalid();
}

function safeRouteOutcome(value: unknown): asserts value is string {
  safeNamespacedOutcome(value);
  if (
    !routeExactOutcomes.has(value) &&
    !suffixIn(value, "command.rejected-conflict.", canvasConflictOutcomeCodes) &&
    !suffixIn(value, "command.rejected.", commandRejectedOutcomeCodes) &&
    !suffixIn(value, "command.failed.", commandFailedOutcomeCodes) &&
    !suffixIn(value, "legacy.rejected.", legacyRejectedOutcomeCodes) &&
    !suffixIn(value, "legacy.failed.", legacyFailedOutcomeCodes)
  ) invalid();
}

function safeLifecycleOutcome(value: unknown): asserts value is string {
  safeNamespacedOutcome(value);
  if (!lifecycleExactOutcomes.has(value)) invalid();
}

function safeRevision(value: unknown): asserts value is number | null {
  if (value === null) return;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    invalid();
  }
}

function safeHash(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/i.test(value)) invalid();
}

function safeServerClass(value: unknown): asserts value is CanvasServerClass {
  if (
    value !== "A" && value !== "B" && value !== "C" && value !== "D" &&
    value !== "T"
  ) invalid();
}

function safeCallerSymbol(
  value: unknown,
): asserts value is CanvasRouteCallerSymbol {
  if (!(canvasRouteCallerSymbols as readonly unknown[]).includes(value)) {
    invalid();
  }
}

function safeGenerationKind(value: unknown): asserts value is CanvasGenerationKind {
  if (value !== "audio" && value !== "image" && value !== "text" && value !== "video") {
    invalid();
  }
}

function safeTaskState(value: unknown): asserts value is CanvasGenerationTaskState {
  if (
    value !== "queued" && value !== "running" && value !== "success" &&
    value !== "failed" && value !== "cancelled" && value !== "retrying" &&
    value !== "recovering"
  ) invalid();
}

function safeProjectionState(
  value: unknown,
): asserts value is CanvasProjectionState {
  if (
    value !== "pending" && value !== "applied" && value !== "conflict" &&
    value !== "failed" && value !== "settlement-unavailable"
  ) invalid();
}

function validateCommand(value: CanvasCommandEventInput) {
  exactKeys(value, commandEventKeys);
  safeLabel(value.commandKind);
  safeLabel(value.operationId);
  safeLabel(value.actor);
  safeHash(value.affectedNodeHash);
  safeRevision(value.beforeDocumentRevision);
  safeRevision(value.afterDocumentRevision);
  safeRevision(value.beforeInputRevision);
  safeRevision(value.afterInputRevision);
  safeCommandOutcome(value.outcome);
  safeLabel(value.requestId);
}

function validateRoute(value: CanvasRouteEventInput) {
  exactKeys(value, routeEventKeys);
  safeLabel(value.clientBuild);
  safeLabel(value.capability);
  safeLabel(value.route);
  safeCallerSymbol(value.callerSymbol);
  safeServerClass(value.serverClass);
  safeLabel(value.operation);
  safeNullableLabel(value.runId);
  safeNullableLabel(value.taskId);
  safeRouteOutcome(value.outcome);
  safeLabel(value.requestId);
}

function validateGenerationLifecycle(value: GenerationLifecycleEventInput) {
  exactKeys(value, generationLifecycleEventKeys);
  safeGenerationKind(value.kind);
  safeLabel(value.operation);
  safeNullableLabel(value.runId);
  safeLabel(value.taskId);
  safeTaskState(value.taskState);
  safeProjectionState(value.projectionState);
  safeLifecycleOutcome(value.outcome);
  safeLabel(value.requestId);
}

function isLegacyWriteRoute(event: CanvasRouteEvent) {
  return event.route === "canvas.legacy-terminal-detach" ||
    event.route === "canvas.legacy-put";
}

function accumulate(event: CanvasObservabilityEvent) {
  if (
    event.event === "command" &&
    event.outcome === "command.rejected-conflict.CANVAS_OPERATION_REUSED"
  ) {
    operationIdentityReuseKeys.add(counterKey([
      event.commandKind,
      event.operationId,
    ]));
  }
  if (
    event.event === "generation-lifecycle" &&
    event.outcome === "provider-attempt.duplicate"
  ) {
    providerDuplicateCount += 1;
  }
  if (event.event === "generation-lifecycle" && event.taskState === "success") {
    latestSuccessProjectionByTask.set(event.taskId, event.projectionState);
  }
  if (event.event !== "route") return;

  if (event.callerSymbol === "unknown") unknownCallerCount += 1;
  if (
    event.operation === "authoritative-refresh" &&
    (event.outcome === "command.applied" || event.outcome === "legacy.applied")
  ) {
    refreshDurableWriteCount += 1;
  }
  if (
    event.route === "canvas.legacy-terminal-detach" &&
    (event.outcome === "legacy.detached" ||
      event.outcome === "legacy.already-detached") &&
    (event.serverClass !== "C" ||
      event.capability !== "legacy-detach-allowlisted")
  ) {
    legacyNotAllowlistedCount += 1;
  }

  const browserLegacy = isLegacyWriteRoute(event) &&
    event.callerSymbol !== "server.legacyTerminalDetachSweep";
  if (browserLegacy) {
    modernLegacyProjectionOrDetachByBuild.set(
      event.clientBuild,
      (modernLegacyProjectionOrDetachByBuild.get(event.clientBuild) ?? 0) + 1,
    );
  }
  if (event.taskId && event.route === "canvas.server-projection") {
    serverProjectedTasks.add(event.taskId);
    if (browserLegacyTasks.has(event.taskId)) {
      modernDoubleWriteTasks.add(event.taskId);
    }
  }
  if (event.taskId && browserLegacy) {
    browserLegacyTasks.add(event.taskId);
    if (serverProjectedTasks.has(event.taskId)) {
      modernDoubleWriteTasks.add(event.taskId);
    }
  }
}

function append(event: CanvasObservabilityEvent) {
  accumulate(event);
  events.push(Object.freeze(event));
  if (events.length > canvasObservabilityMaxEvents) {
    events.splice(0, events.length - canvasObservabilityMaxEvents);
  }
  try {
    if (testSink) {
      testSink(event);
    } else if (process.env.UNBOUNDRY_SAFE_TEST !== "1") {
      // The validated flat contract is the production structured trace.
      // In-process counters reset on restart; operators must retain stdout in
      // the service journal to evaluate a release window across restarts.
      // Prompt/media content cannot reach this sink because validation runs first.
      console.info(JSON.stringify({
        ...event,
        event: `canvas-boundary-${event.event}`,
      }));
    }
  } catch {
    // Transaction outcomes are already committed when deferred events flush.
    // A diagnostic sink must therefore remain best-effort and can never turn
    // a committed command into an HTTP failure or discard later in-memory events.
  }
}

function counterKey(values: readonly unknown[]) {
  return JSON.stringify(values);
}

function compareCounterEntries(
  [left]: readonly [string, unknown],
  [right]: readonly [string, unknown],
) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function commandCounters() {
  const counts = new Map<string, CanvasCommandCounter>();
  for (const event of events) {
    if (event.event !== "command") continue;
    const key = counterKey([event.commandKind, event.actor, event.outcome]);
    const previous = counts.get(key);
    counts.set(key, previous
      ? { ...previous, count: previous.count + 1 }
      : {
          actor: event.actor,
          commandKind: event.commandKind,
          count: 1,
          outcome: event.outcome,
        });
  }
  return Object.freeze(
    [...counts.entries()]
      .sort(compareCounterEntries)
      .map(([, value]) => Object.freeze(value)),
  );
}

function routeCounters() {
  const counts = new Map<string, CanvasRouteCounter>();
  for (const event of events) {
    if (event.event !== "route") continue;
    const key = counterKey([
      event.clientBuild,
      event.capability,
      event.route,
      event.callerSymbol,
      event.serverClass,
      event.operation,
      event.outcome,
      event.runId,
      event.taskId,
      event.requestId,
    ]);
    const previous = counts.get(key);
    counts.set(key, previous
      ? { ...previous, count: previous.count + 1 }
      : {
          callerSymbol: event.callerSymbol,
          capability: event.capability,
          clientBuild: event.clientBuild,
          count: 1,
          operation: event.operation,
          outcome: event.outcome,
          requestId: event.requestId,
          route: event.route,
          runId: event.runId,
          serverClass: event.serverClass,
          taskId: event.taskId,
        });
  }
  return Object.freeze(
    [...counts.entries()]
      .sort(compareCounterEntries)
      .map(([, value]) => Object.freeze(value)),
  );
}

function generationLifecycleCounters() {
  const counts = new Map<string, GenerationLifecycleCounter>();
  for (const event of events) {
    if (event.event !== "generation-lifecycle") continue;
    const key = counterKey([
      event.kind,
      event.operation,
      event.taskState,
      event.projectionState,
      event.outcome,
    ]);
    const previous = counts.get(key);
    counts.set(key, previous
      ? { ...previous, count: previous.count + 1 }
      : {
          count: 1,
          kind: event.kind,
          operation: event.operation,
          outcome: event.outcome,
          projectionState: event.projectionState,
          taskState: event.taskState,
        });
  }
  return Object.freeze(
    [...counts.entries()]
      .sort(compareCounterEntries)
      .map(([, value]) => Object.freeze(value)),
  );
}

export function recordCanvasCommandEvent(value: CanvasCommandEventInput): void {
  validateCommand(value);
  append(Object.freeze({ ...value, event: "command" as const }));
}

export function recordCanvasRouteEvent(value: CanvasRouteEventInput): void {
  validateRoute(value);
  append(Object.freeze({ ...value, event: "route" as const }));
}

export function recordGenerationLifecycleEvent(
  value: GenerationLifecycleEventInput,
): void {
  validateGenerationLifecycle(value);
  append(Object.freeze({ ...value, event: "generation-lifecycle" as const }));
}

function defer(transaction: object, event: CanvasObservabilityEvent) {
  const pending = deferredEvents.get(transaction) ?? [];
  pending.push(event);
  deferredEvents.set(transaction, pending);
}

/**
 * Queue evidence while the owning SQLite transaction is still open. The
 * transaction owner must flush only after COMMIT, or discard after ROLLBACK,
 * so an injected post-mutation fault can never produce a false applied trace.
 */
export function deferCanvasCommandEvent(
  transaction: object,
  value: CanvasCommandEventInput,
): void {
  validateCommand(value);
  defer(transaction, Object.freeze({ ...value, event: "command" as const }));
}

export function deferCanvasRouteEvent(
  transaction: object,
  value: CanvasRouteEventInput,
): void {
  validateRoute(value);
  defer(transaction, Object.freeze({ ...value, event: "route" as const }));
}

export function deferGenerationLifecycleEvent(
  transaction: object,
  value: GenerationLifecycleEventInput,
): void {
  validateGenerationLifecycle(value);
  defer(
    transaction,
    Object.freeze({ ...value, event: "generation-lifecycle" as const }),
  );
}

export function flushDeferredCanvasObservability(transaction: object): void {
  const pending = deferredEvents.get(transaction) ?? [];
  deferredEvents.delete(transaction);
  for (const event of pending) append(event);
}

export function discardDeferredCanvasObservability(transaction: object): void {
  deferredEvents.delete(transaction);
}

export function canvasObservabilitySavepoint(transaction: object): number {
  return deferredEvents.get(transaction)?.length ?? 0;
}

export function rollbackDeferredCanvasObservabilityTo(
  transaction: object,
  savepoint: number,
): void {
  const pending = deferredEvents.get(transaction);
  if (!pending) return;
  if (!Number.isSafeInteger(savepoint) || savepoint < 0) {
    deferredEvents.delete(transaction);
    return;
  }
  pending.splice(savepoint);
  if (pending.length === 0) deferredEvents.delete(transaction);
}

/** Header values are dimensions only; invalid or sensitive-looking input is ignored. */
export function canvasClientBuildFromHeader(value: unknown): string {
  if (
    typeof value !== "string" || value.length < 1 || value.length > 80 ||
    !/^[A-Za-z0-9][A-Za-z0-9._+@=-]{0,79}$/.test(value) ||
    obviousSensitiveValuePattern.test(value)
  ) return "unreported";
  return value;
}

export function snapshotCanvasObservabilityForTests(): CanvasObservabilitySnapshot {
  const alerts = {
    operationIdentityReuse: operationIdentityReuseKeys.size,
    projectionBacklog: [...latestSuccessProjectionByTask.values()].filter(
      (state) => state === "pending" || state === "failed" ||
        state === "settlement-unavailable",
    ).length,
    providerDuplicate: providerDuplicateCount,
    refreshDurableWrite: refreshDurableWriteCount,
  } as const;
  const releaseEvidence = Object.freeze({
    legacyNotAllowlisted: legacyNotAllowlistedCount,
    modernDoubleWrites: modernDoubleWriteTasks.size,
    modernLegacyProjectionOrDetachByBuild: Object.freeze(
      [...modernLegacyProjectionOrDetachByBuild.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([clientBuild, count]) => Object.freeze({ clientBuild, count })),
    ),
    unknownCallers: unknownCallerCount,
  });
  const snapshot = {
    alerts: Object.freeze(alerts),
    counters: Object.freeze({
      command: commandCounters(),
      generationLifecycle: generationLifecycleCounters(),
      route: routeCounters(),
    }),
    events: Object.freeze(events.slice()),
    releaseEvidence,
  } as const;
  return Object.freeze(snapshot);
}

export function resetCanvasObservabilityForTests(): void {
  events.length = 0;
  deferredEvents = new WeakMap<object, CanvasObservabilityEvent[]>();
  testSink = undefined;
  operationIdentityReuseKeys = new Set<string>();
  providerDuplicateCount = 0;
  refreshDurableWriteCount = 0;
  latestSuccessProjectionByTask = new Map<string, CanvasProjectionState>();
  legacyNotAllowlistedCount = 0;
  unknownCallerCount = 0;
  serverProjectedTasks = new Set<string>();
  browserLegacyTasks = new Set<string>();
  modernDoubleWriteTasks = new Set<string>();
  modernLegacyProjectionOrDetachByBuild = new Map<string, number>();
}

/** Test-only capture seam; production always emits validated JSON to stdout. */
export function setCanvasObservabilitySinkForTests(
  sink?: (event: CanvasObservabilityEvent) => void,
): void {
  testSink = sink;
}

export type CanvasRouteReleaseGate = Readonly<{
  legacyNotAllowlisted: number;
  modernDoubleWrites: number;
  modernLegacyProjectionOrDetach: number;
  unknownCallers: number;
}>;

/**
 * Deterministic release-gate counters. Runtime evidence is complementary to
 * the exhaustive source manifest: caller symbols are assigned by server route
 * composition, never accepted from request bodies or headers.
 */
export function canvasRouteReleaseGate(
  snapshot: CanvasObservabilitySnapshot,
  currentBuild: string,
): CanvasRouteReleaseGate {
  safeLabel(currentBuild);
  return Object.freeze({
    legacyNotAllowlisted: snapshot.releaseEvidence.legacyNotAllowlisted,
    modernDoubleWrites: snapshot.releaseEvidence.modernDoubleWrites,
    modernLegacyProjectionOrDetach:
      snapshot.releaseEvidence.modernLegacyProjectionOrDetachByBuild.find(
        (entry) => entry.clientBuild === currentBuild,
      )?.count ?? 0,
    unknownCallers: snapshot.releaseEvidence.unknownCallers,
  });
}

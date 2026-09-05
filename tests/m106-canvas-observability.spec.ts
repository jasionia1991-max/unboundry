import { expect, test } from "./safe-test";
import {
  canvasObservabilityMaxEvents,
  canvasObservabilitySavepoint,
  canvasRouteReleaseGate,
  CanvasObservabilityValidationError,
  deferCanvasRouteEvent,
  discardDeferredCanvasObservability,
  flushDeferredCanvasObservability,
  recordCanvasCommandEvent,
  recordCanvasRouteEvent,
  recordGenerationLifecycleEvent,
  resetCanvasObservabilityForTests,
  rollbackDeferredCanvasObservabilityTo,
  setCanvasObservabilitySinkForTests,
  snapshotCanvasObservabilityForTests,
  type CanvasCommandEventInput,
  type CanvasRouteEventInput,
  type GenerationLifecycleEventInput,
} from "../server/canvasObservability";

const hash = "a".repeat(64);

function command(
  overrides: Partial<CanvasCommandEventInput> = {},
): CanvasCommandEventInput {
  return {
    actor: "user",
    affectedNodeHash: hash,
    afterDocumentRevision: 2,
    afterInputRevision: 2,
    beforeDocumentRevision: 1,
    beforeInputRevision: 1,
    commandKind: "apply-user-field-changes",
    operationId: "operation-1",
    outcome: "command.applied",
    requestId: "request-1",
    ...overrides,
  };
}

function route(
  overrides: Partial<CanvasRouteEventInput> = {},
): CanvasRouteEventInput {
  return {
    callerSymbol: "client.canvasPersistenceFacade",
    capability: "command-v1",
    clientBuild: "0.7.8",
    operation: "typed-user-command",
    outcome: "command.applied",
    requestId: "request-1",
    route: "canvas.commands",
    runId: null,
    serverClass: "T",
    taskId: null,
    ...overrides,
  };
}

function lifecycle(
  overrides: Partial<GenerationLifecycleEventInput> = {},
): GenerationLifecycleEventInput {
  return {
    kind: "text",
    operation: "generation-task-lifecycle",
    outcome: "generation-task.success",
    projectionState: "pending",
    requestId: "request-1",
    runId: "run-1",
    taskId: "task-1",
    taskState: "success",
    ...overrides,
  };
}

test.beforeEach(() => {
  resetCanvasObservabilityForTests();
});

test("accepts exact command fields and returns immutable deterministic counters", () => {
  const input = command();
  recordCanvasCommandEvent(input);
  (input as unknown as { operationId: string }).operationId =
    "mutated-after-record";

  const snapshot = snapshotCanvasObservabilityForTests();
  expect(snapshot.events).toHaveLength(1);
  expect(snapshot.events[0]).toMatchObject({
    event: "command",
    operationId: "operation-1",
  });
  expect(snapshot.counters.command).toEqual([{
    actor: "user",
    commandKind: "apply-user-field-changes",
    count: 1,
    outcome: "command.applied",
  }]);
  expect(Object.isFrozen(snapshot)).toBe(true);
  expect(Object.isFrozen(snapshot.counters)).toBe(true);
  expect(Object.isFrozen(snapshot.events)).toBe(true);
  expect(Object.isFrozen(snapshot.events[0])).toBe(true);
  expect(snapshot.alerts).toEqual({
    operationIdentityReuse: 0,
    projectionBacklog: 0,
    providerDuplicate: 0,
    refreshDurableWrite: 0,
  });
});

test("route counters aggregate stable dimensions while retaining request evidence", () => {
  recordCanvasRouteEvent(route());
  recordCanvasRouteEvent(route({
    requestId: "request-2",
    runId: "run-2",
    taskId: "task-2",
  }));

  const snapshot = snapshotCanvasObservabilityForTests();
  expect(snapshot.events.map((event) => event.event)).toEqual(["route", "route"]);
  expect(snapshot.events[1]).toMatchObject({
    requestId: "request-2",
    runId: "run-2",
    taskId: "task-2",
  });
  expect(snapshot.counters.route).toEqual([{
    callerSymbol: "client.canvasPersistenceFacade",
    capability: "command-v1",
    clientBuild: "0.7.8",
    count: 1,
    operation: "typed-user-command",
    outcome: "command.applied",
    requestId: "request-2",
    route: "canvas.commands",
    runId: "run-2",
    serverClass: "T",
    taskId: "task-2",
  }, {
    callerSymbol: "client.canvasPersistenceFacade",
    capability: "command-v1",
    clientBuild: "0.7.8",
    count: 1,
    operation: "typed-user-command",
    outcome: "command.applied",
    requestId: "request-1",
    route: "canvas.commands",
    runId: null,
    serverClass: "T",
    taskId: null,
  }]);
});

test("generation lifecycle records task success independently of pending Canvas projection", () => {
  recordGenerationLifecycleEvent(lifecycle());

  const snapshot = snapshotCanvasObservabilityForTests();
  expect(snapshot.events[0]).toMatchObject({
    event: "generation-lifecycle",
    projectionState: "pending",
    taskState: "success",
  });
  expect(snapshot.counters.generationLifecycle).toEqual([{
    count: 1,
    kind: "text",
    operation: "generation-task-lifecycle",
    outcome: "generation-task.success",
    projectionState: "pending",
    taskState: "success",
  }]);

  recordGenerationLifecycleEvent(lifecycle({
    operation: "single-node-result-projection",
    outcome: "projection.applied",
    projectionState: "applied",
    requestId: "request-projection-applied",
  }));
  expect(snapshotCanvasObservabilityForTests().alerts.projectionBacklog).toBe(0);
});

test("reset clears events and counters without changing an earlier immutable snapshot", () => {
  recordCanvasCommandEvent(command());
  recordCanvasRouteEvent(route());
  recordGenerationLifecycleEvent(lifecycle());
  const beforeReset = snapshotCanvasObservabilityForTests();

  resetCanvasObservabilityForTests();
  const afterReset = snapshotCanvasObservabilityForTests();
  expect(afterReset.events).toEqual([]);
  expect(afterReset.counters.command).toEqual([]);
  expect(afterReset.counters.route).toEqual([]);
  expect(afterReset.counters.generationLifecycle).toEqual([]);
  expect(beforeReset.events).toHaveLength(3);
});

test("emits only validated structured events through the test sink", () => {
  const emitted: unknown[] = [];
  setCanvasObservabilitySinkForTests((event) => emitted.push(event));
  recordCanvasRouteEvent(route({ requestId: "request-trace" }));
  expect(emitted).toEqual([expect.objectContaining({
    event: "route",
    requestId: "request-trace",
  })]);
});

test("isolates diagnostic sink failures from committed observability evidence", () => {
  setCanvasObservabilitySinkForTests(() => {
    throw new Error("m106 diagnostic sink unavailable");
  });
  expect(() => recordCanvasRouteEvent(route({ requestId: "sink-fault-1" })))
    .not.toThrow();
  expect(() => recordCanvasCommandEvent(command({ requestId: "sink-fault-2" })))
    .not.toThrow();
  expect(snapshotCanvasObservabilityForTests().events).toEqual([
    expect.objectContaining({ event: "route", requestId: "sink-fault-1" }),
    expect.objectContaining({ event: "command", requestId: "sink-fault-2" }),
  ]);
});

test("publishes transaction evidence only after commit flush and discards rollback/savepoint work", () => {
  const transaction = {};
  deferCanvasRouteEvent(transaction, route({ requestId: "request-deferred-1" }));
  expect(snapshotCanvasObservabilityForTests().events).toEqual([]);

  const savepoint = canvasObservabilitySavepoint(transaction);
  deferCanvasRouteEvent(transaction, route({ requestId: "request-deferred-2" }));
  rollbackDeferredCanvasObservabilityTo(transaction, savepoint);
  flushDeferredCanvasObservability(transaction);
  expect(snapshotCanvasObservabilityForTests().events).toEqual([
    expect.objectContaining({ requestId: "request-deferred-1" }),
  ]);

  deferCanvasRouteEvent(transaction, route({ requestId: "request-rolled-back" }));
  discardDeferredCanvasObservability(transaction);
  flushDeferredCanvasObservability(transaction);
  expect(snapshotCanvasObservabilityForTests().events).toHaveLength(1);
});

test("derives alert and four release-gate counters without conflating task success", () => {
  recordCanvasCommandEvent(command({
    outcome: "command.rejected-conflict.CANVAS_OPERATION_REUSED",
  }));
  recordCanvasRouteEvent(route({
    callerSymbol: "unknown",
    operation: "authoritative-refresh",
    outcome: "command.applied",
    route: "canvas.legacy-terminal-detach",
    serverClass: "T",
    taskId: "task-modern",
  }));
  recordCanvasRouteEvent(route({
    clientBuild: "server",
    operation: "server-projection",
    outcome: "projection.applied",
    route: "canvas.server-projection",
    serverClass: "A",
    taskId: "task-modern",
  }));
  recordCanvasRouteEvent(route({
    clientBuild: "0.7.7",
    operation: "legacy-terminal-detach",
    outcome: "legacy.detached",
    route: "canvas.legacy-terminal-detach",
    serverClass: "D",
    taskId: "task-legacy-invalid",
  }));
  recordGenerationLifecycleEvent(lifecycle());
  recordGenerationLifecycleEvent(lifecycle({
    outcome: "provider-attempt.duplicate",
    requestId: "request-provider-duplicate",
    taskState: "running",
  }));

  const snapshot = snapshotCanvasObservabilityForTests();
  expect(snapshot.alerts).toEqual({
    operationIdentityReuse: 1,
    projectionBacklog: 1,
    providerDuplicate: 1,
    refreshDurableWrite: 1,
  });
  expect(canvasRouteReleaseGate(snapshot, "0.7.8")).toEqual({
    legacyNotAllowlisted: 1,
    modernDoubleWrites: 1,
    modernLegacyProjectionOrDetach: 1,
    unknownCallers: 1,
  });
});

test("retains only the bounded recent event window", () => {
  for (let index = 0; index < canvasObservabilityMaxEvents + 40; index += 1) {
    recordCanvasRouteEvent(route({ requestId: `request-${index}` }));
  }

  const snapshot = snapshotCanvasObservabilityForTests();
  expect(snapshot.events).toHaveLength(canvasObservabilityMaxEvents);
  expect(snapshot.events[0]).toMatchObject({ requestId: "request-40" });
  expect(snapshot.counters.route).toHaveLength(canvasObservabilityMaxEvents);
  expect(snapshot.counters.route[0]?.count).toBe(1);
});

test("keeps release and alert evidence after the bounded event window rolls over", () => {
  recordCanvasCommandEvent(command({
    commandKind: "commit-user-layout",
    operationId: "reused-operation",
    outcome: "command.rejected-conflict.CANVAS_OPERATION_REUSED",
    requestId: "reuse-request-1",
  }));
  recordCanvasCommandEvent(command({
    commandKind: "commit-user-layout",
    operationId: "reused-operation",
    outcome: "command.rejected-conflict.CANVAS_OPERATION_REUSED",
    requestId: "reuse-request-2",
  }));
  recordCanvasRouteEvent(route({
    capability: "legacy-detach-global",
    clientBuild: "0.7.7",
    outcome: "legacy.already-detached",
    route: "canvas.legacy-terminal-detach",
    serverClass: "C",
  }));
  for (let index = 0; index < canvasObservabilityMaxEvents + 20; index += 1) {
    recordCanvasRouteEvent(route({ requestId: `rollover-${index}` }));
  }

  const snapshot = snapshotCanvasObservabilityForTests();
  expect(snapshot.events.some((event) =>
    event.requestId === "reuse-request-1"
  )).toBe(false);
  expect(snapshot.alerts.operationIdentityReuse).toBe(1);
  expect(canvasRouteReleaseGate(snapshot, "0.7.8").legacyNotAllowlisted).toBe(1);
});

test("rejects extra fields, unnamespaced outcomes, and obvious secret or media values", () => {
  expect(() => recordCanvasCommandEvent({
    ...command(),
    prompt: "do not retain this prompt",
  } as unknown as CanvasCommandEventInput)).toThrow(
    CanvasObservabilityValidationError,
  );
  expect(() => recordCanvasCommandEvent(command({ outcome: "success" })))
    .toThrow(CanvasObservabilityValidationError);
  expect(() => recordCanvasCommandEvent(command({ outcome: "command.appllied" })))
    .toThrow(CanvasObservabilityValidationError);
  expect(() => recordCanvasRouteEvent(route({ operation: "prompt=secret words" })))
    .toThrow(CanvasObservabilityValidationError);
  expect(() => recordCanvasRouteEvent(route({
    requestId: "Bearer abcdefghijklmnop",
  }))).toThrow(CanvasObservabilityValidationError);
  expect(() => recordCanvasRouteEvent(route({
    route: "https://example.test/api/assets/raw-media",
  }))).toThrow(CanvasObservabilityValidationError);
  expect(() => recordCanvasRouteEvent({
    ...route(),
    serverClass: null,
  } as unknown as CanvasRouteEventInput)).toThrow(
    CanvasObservabilityValidationError,
  );
  expect(() => recordCanvasRouteEvent({
    ...route(),
    callerSymbol: "server.unregisteredWriter",
  } as unknown as CanvasRouteEventInput)).toThrow(
    CanvasObservabilityValidationError,
  );

  recordCanvasRouteEvent(route({
    capability: "none",
    operation: "legacy-full-document-put",
    outcome: "legacy.rejected.CANVAS_TOPOLOGY_CONFLICT",
    route: "canvas.legacy-put",
  }));
  expect(snapshotCanvasObservabilityForTests().events[0]).toMatchObject({
    event: "route",
    outcome: "legacy.rejected.CANVAS_TOPOLOGY_CONFLICT",
  });
  resetCanvasObservabilityForTests();

  expect(snapshotCanvasObservabilityForTests().events).toEqual([]);
});

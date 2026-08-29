export type GroupRunNotificationIdentity = {
  accountId: string;
  canvasId: string;
  errorClass: string;
  groupId: string;
  nodeId: string;
  runId: string;
};

export type GroupRunNotificationPhase = "recovering" | "terminal";

export function groupRunNotificationKey(
  identity: GroupRunNotificationIdentity,
) {
  return JSON.stringify([
    identity.accountId,
    identity.canvasId,
    identity.groupId,
    identity.runId,
    identity.nodeId,
    identity.errorClass,
  ]);
}

/** Bounded user-facing dedupe; detailed attempts remain in durable diagnostics. */
export function publishGroupRunNotificationOnce(
  published: Map<string, Set<GroupRunNotificationPhase>>,
  identity: GroupRunNotificationIdentity,
  phase: GroupRunNotificationPhase,
) {
  const key = groupRunNotificationKey(identity);
  const phases = published.get(key) ?? new Set<GroupRunNotificationPhase>();
  if (phases.has(phase)) return false;
  phases.add(phase);
  published.set(key, phases);
  while (published.size > 500) {
    const oldest = published.keys().next().value as string | undefined;
    if (!oldest) break;
    published.delete(oldest);
  }
  return true;
}

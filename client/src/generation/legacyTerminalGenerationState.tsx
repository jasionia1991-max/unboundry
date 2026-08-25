import {
  createContext,
  useContext,
  type ReactNode,
} from "react";
import type { LegacyTerminalGenerationState } from
  "./legacyTerminalGenerationReconciler";

type LegacyStateMap = ReadonlyMap<string, LegacyTerminalGenerationState>;

const LegacyTerminalGenerationStateContext = createContext<LegacyStateMap>(
  new Map(),
);

const blockedScopes = new Map<string, Set<string>>();

function scopeKey(accountId: string, canvasId: string) {
  return JSON.stringify([accountId, canvasId]);
}

export function replaceLegacyGenerationSubmissionBlocks(input: {
  accountId: string;
  canvasId: string;
  states: LegacyStateMap;
}) {
  const blocked = new Set(
    [...input.states].flatMap(([nodeId, state]) =>
      state === "DETECTING" || state === "ACTIVE_CONFIRMED" ||
          state === "UNKNOWN_BLOCKED"
        ? [nodeId]
        : []
    ),
  );
  if (blocked.size === 0) blockedScopes.delete(scopeKey(input.accountId, input.canvasId));
  else blockedScopes.set(scopeKey(input.accountId, input.canvasId), blocked);
}

export function clearLegacyGenerationSubmissionBlocks(
  accountId: string,
  canvasId: string,
) {
  blockedScopes.delete(scopeKey(accountId, canvasId));
}

export function legacyGenerationSubmissionIsBlocked(
  accountId: string,
  canvasId: string,
  nodeId: string,
) {
  return blockedScopes.get(scopeKey(accountId, canvasId))?.has(nodeId) === true;
}

export function LegacyTerminalGenerationStateProvider({
  children,
  states,
}: {
  children: ReactNode;
  states: LegacyStateMap;
}) {
  return (
    <LegacyTerminalGenerationStateContext.Provider value={states}>
      {children}
    </LegacyTerminalGenerationStateContext.Provider>
  );
}

export function useLegacyTerminalGenerationState(nodeId: string) {
  return useContext(LegacyTerminalGenerationStateContext).get(nodeId);
}

export function legacyTerminalGenerationStatusLabel(
  state: LegacyTerminalGenerationState | undefined,
) {
  if (state === "DETECTING") return "正在核对";
  if (state === "UNKNOWN_BLOCKED") return "状态待核对";
  if (state === "CONFLICT_PRESERVED") return "原结果已保留";
  return "";
}

export function effectiveLegacyTerminalGenerationState(input: {
  bindingComplete: boolean;
  hasLegacyRun: boolean;
  locallyActive: boolean;
  persistedGenerating: boolean;
  state?: LegacyTerminalGenerationState;
}): LegacyTerminalGenerationState | undefined {
  if (input.state === "PASSTHROUGH") return input.state;
  if (!input.persistedGenerating || !input.hasLegacyRun) return undefined;
  if (input.locallyActive) return "ACTIVE_CONFIRMED";
  if (input.state) return input.state;
  return input.bindingComplete ? "DETECTING" : "UNKNOWN_BLOCKED";
}

export function LegacyTerminalGenerationNotice({
  state,
}: {
  state: LegacyTerminalGenerationState | undefined;
}) {
  const label = legacyTerminalGenerationStatusLabel(state);
  if (!label) return null;
  return (
    <div
      className="legacy-terminal-generation-notice"
      data-state={state}
      data-testid="legacy-terminal-generation-notice"
      role="status"
    >
      {label}
    </div>
  );
}

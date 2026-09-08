import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  acknowledgeGenerationRecoveryCase,
  readGenerationRecoveryCases,
  recoveryCaseHasActiveWork,
  recoveryCaseWithReplacement,
  type GenerationRecoveryRequestError,
} from "./generationRecoveryClient";
import type { RecoveryCaseSummary } from "../../../types/generationRecovery";

export type GenerationRecoveryObservationState =
  | "idle"
  | "loading"
  | "ready"
  | "disabled"
  | "unavailable"
  | "offline";

export type GenerationRecoveryContextValue = Readonly<{
  cases: readonly RecoveryCaseSummary[];
  caseByTaskId: ReadonlyMap<string, RecoveryCaseSummary>;
  error?: string;
  observationState: GenerationRecoveryObservationState;
  registerTaskIds: (taskIds: readonly string[]) => void;
  unregisterTaskIds: (taskIds: readonly string[]) => void;
  markRead: (item: RecoveryCaseSummary) => Promise<RecoveryCaseSummary | undefined>;
  refresh: () => void;
  trackedTaskCount: number;
}>;

const emptyCases = new Map<string, RecoveryCaseSummary>();
const defaultValue: GenerationRecoveryContextValue = {
  cases: [],
  caseByTaskId: emptyCases,
  observationState: "idle",
  registerTaskIds: () => undefined,
  unregisterTaskIds: () => undefined,
  markRead: async () => undefined,
  refresh: () => undefined,
  trackedTaskCount: 0,
};

export const GenerationRecoveryContext =
  createContext<GenerationRecoveryContextValue>(defaultValue);

const recoveryPollDelays = [1_000, 2_000, 5_000, 15_000, 30_000, 60_000] as const;
const maxObservedTaskIds = 50;

function mergeRecoveryCase(
  current: RecoveryCaseSummary | undefined,
  incoming: RecoveryCaseSummary,
): RecoveryCaseSummary {
  if (!current) return incoming;
  if (incoming.progressVersion < current.progressVersion) return current;
  if (incoming.caseEventId < current.caseEventId) return current;
  if (
    incoming.caseEventId === current.caseEventId &&
    incoming.progressVersion === current.progressVersion
  ) {
    // A read acknowledgement changes only the public read bit. Keep that bit
    // monotonic when an older in-flight poll returns the same version later.
    return incoming.unread === current.unread
      ? incoming
      : { ...incoming, unread: current.unread && incoming.unread };
  }
  return incoming;
}

function isOnline() {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

function isVisible() {
  return typeof document === "undefined" || document.visibilityState !== "hidden";
}

function safeErrorMessage(error: unknown) {
  if (error && typeof error === "object" && "code" in error) {
    const code = String((error as GenerationRecoveryRequestError).code ?? "");
    if (code === "RECOVERY_DISABLED" || code === "RECOVERY_FROZEN") {
      return "生成维护暂未开放，原任务记录已保留";
    }
  }
  return "恢复状态暂时无法读取，原任务记录已保留";
}

export function GenerationRecoveryProvider({
  accountId,
  canvasId,
  fixtureScopeId = "",
  children,
}: {
  accountId: string;
  canvasId: string;
  fixtureScopeId?: string;
  children: ReactNode;
}) {
  const [registeredIds, setRegisteredIds] = useState<string[]>([]);
  const registrationCounts = useRef(new Map<string, number>());
  const [cases, setCases] = useState<ReadonlyMap<string, RecoveryCaseSummary>>(
    emptyCases,
  );
  const [observationState, setObservationState] =
    useState<GenerationRecoveryObservationState>("idle");
  const [error, setError] = useState<string>();
  const [refreshEpoch, setRefreshEpoch] = useState(0);
  const [readBusy, setReadBusy] = useState<ReadonlySet<string>>(new Set());
  const casesRef = useRef<ReadonlyMap<string, RecoveryCaseSummary>>(cases);
  casesRef.current = cases;
  const scopeKeyRef = useRef("");
  const scopeKey = JSON.stringify([accountId, canvasId, fixtureScopeId]);
  scopeKeyRef.current = scopeKey;

  const registerTaskIds = useCallback((taskIds: readonly string[]) => {
    let changed = false;
    for (const taskId of new Set(taskIds)) {
      if (!taskId) continue;
      registrationCounts.current.set(
        taskId,
        (registrationCounts.current.get(taskId) ?? 0) + 1,
      );
      changed = true;
    }
    if (!changed) return;
    setRegisteredIds([...registrationCounts.current.keys()]);
  }, []);

  const unregisterTaskIds = useCallback((taskIds: readonly string[]) => {
    let changed = false;
    const removed = new Set<string>();
    for (const taskId of taskIds) {
      const count = registrationCounts.current.get(taskId);
      if (!count) continue;
      if (count <= 1) {
        registrationCounts.current.delete(taskId);
        removed.add(taskId);
      }
      else registrationCounts.current.set(taskId, count - 1);
      changed = true;
    }
    if (!changed) return;
    setRegisteredIds([...registrationCounts.current.keys()]);
    setCases((current) => {
      if (removed.size === 0) return current;
      const next = new Map(current);
      for (const taskId of removed) next.delete(taskId);
      return next;
    });
  }, []);

  const trackedIdsKey = registeredIds.join("\u0000");
  const readControllers = useRef(new Map<string, AbortController>());
  const batchStartRef = useRef(0);

  useEffect(() => () => {
    for (const controller of readControllers.current.values()) {
      controller.abort("generation-recovery-provider-unmounted");
    }
    readControllers.current.clear();
  }, [scopeKey]);

  useEffect(() => {
    let disposed = false;
    let timer: number | undefined;
    let backoffIndex = 0;
    let activeController: AbortController | undefined;
    let runInFlight = false;
    let rerunAfterInFlight = false;
    let desiredObservation = true;

    const cancelTimer = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = undefined;
    };
    const cancelRequest = () => {
      activeController?.abort("generation-recovery-observer-superseded");
      activeController = undefined;
    };
    const schedule = (delay: number) => {
      cancelTimer();
      if (disposed || !isVisible() || !isOnline()) return;
      timer = window.setTimeout(() => {
        timer = undefined;
        void run();
      }, delay);
    };
    const nextBatch = () => {
      if (registeredIds.length === 0) return [];
      const start = batchStartRef.current % registeredIds.length;
      const batch = registeredIds.slice(start, start + maxObservedTaskIds);
      if (batch.length < maxObservedTaskIds && start > 0) {
        batch.push(...registeredIds.slice(0, maxObservedTaskIds - batch.length));
      }
      batchStartRef.current = (start + maxObservedTaskIds) % registeredIds.length;
      return batch;
    };
    const run = async (force = false): Promise<void> => {
      if (disposed || registeredIds.length === 0) return;
      if (runInFlight) {
        if (desiredObservation && isVisible() && isOnline()) {
          rerunAfterInFlight = true;
        }
        return;
      }
      if (!force && (!isVisible() || !isOnline())) {
        desiredObservation = false;
        if (!disposed) setObservationState("offline");
        return;
      }
      if (!isVisible() || !isOnline()) {
        desiredObservation = false;
        if (!disposed) setObservationState("offline");
        return;
      }
      desiredObservation = true;
      const batch = nextBatch();
      if (batch.length === 0) return;
      runInFlight = true;
      cancelRequest();
      const controller = new AbortController();
      activeController = controller;
      setObservationState((current) =>
        current === "ready" ? current : "loading",
      );
      try {
        const response = await readGenerationRecoveryCases(batch, controller.signal);
        if (disposed || controller.signal.aborted) return;
        if (!response.enabled) {
          setCases(emptyCases);
          setObservationState("disabled");
          setError(undefined);
          backoffIndex = 0;
          schedule(recoveryPollDelays[recoveryPollDelays.length - 1]);
          return;
        }
        // Merge at React's update boundary so a same-tick read acknowledgement
        // cannot be overwritten by an older observation snapshot.
        const returnedIds = new Set(response.cases.map((item) => item.taskId));
        const replacements = response.cases.flatMap((item) => {
          const replacement = recoveryCaseWithReplacement(item).replacementTaskId;
          return replacement ? [replacement] : [];
        });
        const untrackedReplacements = replacements.filter(
          (taskId) => !registrationCounts.current.has(taskId),
        );
        if (untrackedReplacements.length > 0) registerTaskIds(untrackedReplacements);
        setCases((current) => {
          const next = new Map(current);
          for (const taskId of batch) {
            if (!returnedIds.has(taskId)) next.delete(taskId);
          }
          for (const item of response.cases) {
            next.set(item.taskId, mergeRecoveryCase(next.get(item.taskId), item));
          }
          return next;
        });
        setObservationState("ready");
        setError(undefined);
        backoffIndex = 0;
        const hasActiveWork = response.cases.some(recoveryCaseHasActiveWork);
        schedule(hasActiveWork ? recoveryPollDelays[2] : recoveryPollDelays[4]);
      } catch (caught) {
        if (disposed || controller.signal.aborted) return;
        setObservationState("unavailable");
        setError(safeErrorMessage(caught));
        schedule(recoveryPollDelays[Math.min(backoffIndex++, recoveryPollDelays.length - 1)]);
      } finally {
        if (activeController === controller) activeController = undefined;
        runInFlight = false;
        const rerun = rerunAfterInFlight;
        rerunAfterInFlight = false;
        if (rerun && !disposed && desiredObservation && isVisible() && isOnline()) {
          void run(true);
        }
      }
    };
    const onVisibility = () => {
      if (!isVisible()) {
        desiredObservation = false;
        rerunAfterInFlight = false;
        cancelTimer();
        cancelRequest();
        return;
      }
      desiredObservation = true;
      void run(true);
    };
    const onOnline = () => {
      desiredObservation = true;
      void run(true);
    };
    const onOffline = () => {
      desiredObservation = false;
      rerunAfterInFlight = false;
      cancelTimer();
      cancelRequest();
      if (!disposed) setObservationState("offline");
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    casesRef.current = cases;
    void run(true);
    return () => {
      disposed = true;
      rerunAfterInFlight = false;
      cancelTimer();
      cancelRequest();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
    // casesRef intentionally keeps the latest map for request responses without
    // restarting the observer on every progress update. Each request covers at
    // most 50 IDs; the start offset rotates so older cases remain observable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, canvasId, fixtureScopeId, refreshEpoch, trackedIdsKey]);

  const refresh = useCallback(() => {
    setRefreshEpoch((current) => current + 1);
  }, []);

  const markRead = useCallback(async (item: RecoveryCaseSummary) => {
    if (readBusy.has(item.taskId) || !isOnline()) return undefined;
    const startedScopeKey = scopeKeyRef.current;
    const controller = new AbortController();
    readControllers.current.get(item.taskId)?.abort(
      "generation-recovery-read-superseded",
    );
    readControllers.current.set(item.taskId, controller);
    setReadBusy((current) => new Set([...current, item.taskId]));
    try {
      const response = await acknowledgeGenerationRecoveryCase(
        item,
        controller.signal,
      );
      const next = response.case;
      if (next && scopeKeyRef.current === startedScopeKey &&
          !controller.signal.aborted) {
        setCases((current) => {
          const previous = current.get(next.taskId);
          const merged = mergeRecoveryCase(previous, next);
          if (merged === previous) return current;
          const updated = new Map(current);
          updated.set(next.taskId, merged);
          return updated;
        });
      }
      return next ?? undefined;
    } catch (caught) {
      if (!controller.signal.aborted && scopeKeyRef.current === startedScopeKey) {
        setError(
          caught && typeof caught === "object" && "status" in caught &&
            Number((caught as { status?: unknown }).status) === 409
            ? "处理进度已更新，请重新查看最新状态"
            : "暂时无法更新处理状态，原任务记录已保留",
        );
      }
      return undefined;
    } finally {
      if (readControllers.current.get(item.taskId) === controller) {
        readControllers.current.delete(item.taskId);
      }
      setReadBusy((current) => {
        const next = new Set(current);
        next.delete(item.taskId);
        return next;
      });
    }
  }, [readBusy]);

  const value = useMemo<GenerationRecoveryContextValue>(() => {
    const orderedCases = [...cases.values()].sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
    );
    return {
      cases: orderedCases,
      caseByTaskId: cases,
      ...(error ? { error } : {}),
      markRead,
      observationState,
      refresh,
      registerTaskIds,
      trackedTaskCount: registeredIds.length,
      unregisterTaskIds,
    };
  }, [cases, error, markRead, observationState, refresh, registerTaskIds, registeredIds.length, unregisterTaskIds]);

  return (
    <GenerationRecoveryContext.Provider value={value}>
      {children}
    </GenerationRecoveryContext.Provider>
  );
}

export function useGenerationRecovery() {
  return useContext(GenerationRecoveryContext);
}

export function useGenerationRecoveryTask(taskId: string | undefined) {
  const recovery = useGenerationRecovery();
  useEffect(() => {
    if (!taskId) return;
    recovery.registerTaskIds([taskId]);
    return () => recovery.unregisterTaskIds([taskId]);
  }, [recovery.registerTaskIds, recovery.unregisterTaskIds, taskId]);
  return taskId ? recovery.caseByTaskId.get(taskId) : undefined;
}

const recoveryFollowUpStatuses = new Set([
  "result_recovered",
  "result_pending",
  "ready_for_user",
]);

/**
 * Wake the node's existing authoritative task recovery once a durable case
 * reports a result or a user-ready transition.  The hook never submits a
 * generation or invents progress; it only asks the node to reuse its normal
 * task GET/projection path after the maintenance event is visible.
 */
export function useGenerationRecoveryFollowUp(
  taskId: string | undefined,
  active: boolean,
  onFollowUp: () => void,
) {
  const item = useGenerationRecoveryTask(taskId);
  const handledSignature = useRef("");
  const signature = item
    ? `${item.caseEventId}:${item.progressVersion}:${item.status}`
    : "";

  useEffect(() => {
    if (!item || !taskId || active || !recoveryFollowUpStatuses.has(item.status)) {
      return;
    }
    if (handledSignature.current === signature) return;
    handledSignature.current = signature;
    onFollowUp();
  }, [active, item, onFollowUp, signature, taskId]);

  return item;
}

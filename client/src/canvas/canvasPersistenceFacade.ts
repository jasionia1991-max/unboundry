import type { WorkflowRunSummary } from "../../../types/workflowRuns";
import type { Viewport } from "@xyflow/react";
import { useEffect } from "react";
import type { ProbeNodeType } from "./ProbeNode";
import type { CuttableEdge } from "./canvasTypes";
import {
  canvasGraphFingerprint,
  canvasUserDocumentFingerprint,
} from "./canvasDocumentFingerprint";
import {
  canvasCommandWriteContract,
  type AuthoritativeCanvasDocument,
  type CanvasCommandResponse,
  type CanvasUserCommand,
  type CreateCanvasDocumentCommand,
  type ExistingCanvasCommandBase,
} from "../../../types/canvasCommands";
import { stableSha256 } from "../../../types/canvasFingerprint";
import {
  canvasCommandIntentFromJournalEntry,
  canvasCommandJournalEntries,
  commandOperationId,
  commandSessionId,
  initialCanvasCommandDocument,
  planCanvasCommandIntents,
  mergeWorkflowResultNodes,
  type CanvasCommandIntent,
  type CanvasCommandJournalEntry,
  type CanvasCommandTargetDocument,
} from "./canvasCommandJournal";

const LOAD_TOKEN_MAX_LENGTH = 256;
const PERSIST_DEBOUNCE_MS = 500;
export const CANVAS_READ_TIMEOUT_MS = 30_000;
const PERSIST_SAVE_TIMEOUT_MS = 6_000;
const PAGEHIDE_MAX_BYTES = 60 * 1024;
const SAVE_JOURNAL_MAX_BYTES = 5_000_000;
const SAVE_SESSION_STORAGE_PREFIX = "unboundry:canvas-save-session:v2:";
const SAVE_SESSION_SCOPE_INDEX_KEY =
  "unboundry:canvas-save-session:v2:scopes";
const RETRY_MAX_MS = 30_000;
const VIEWPORT_QUIET_MS = 250;
const clientBuildVersion = typeof __UNBOUNDRY_VERSION__ === "string"
  ? __UNBOUNDRY_VERSION__
  : "test-runtime";

export type CanvasLoadState = "failed" | "loading" | "missing" | "ready";
export type CanvasLoadFailureKind =
  | "connection"
  | "invalid-response"
  | "stale-save-session"
  | "storage"
  | "unknown";
export type CanvasLoadFailure = Readonly<{
  kind: CanvasLoadFailureKind;
  message: string;
}>;

export type LoadedCanvasDocument = {
  currentWriterSequence: number;
  currentWriterSessionId: string | null;
  edges: CuttableEdge[];
  graphRevision?: number;
  loadToken: string;
  nodes: ProbeNodeType[];
  revision: number;
  saveEpoch: string;
  sessionHighWaterAttemptId: string | null;
  sessionHighWaterSequence: number;
  viewport: Viewport;
};

export type CanvasSaveFence = Pick<
  LoadedCanvasDocument,
  | "currentWriterSequence"
  | "currentWriterSessionId"
  | "saveEpoch"
  | "sessionHighWaterAttemptId"
  | "sessionHighWaterSequence"
>;

export type CanvasPersistenceSnapshot = {
  commandJournal?: readonly CanvasCommandJournalEntry[];
  edges: CuttableEdge[];
  fingerprint: string;
  graphFingerprint: string;
  nodes: ProbeNodeType[];
  viewport: Viewport;
};

export type CanvasPendingSaveAttempt = {
  attemptId: string;
  document: CanvasPersistenceSnapshot;
  payload: string;
  rejectedByServer?: boolean;
  saveSequence: number;
};

type CanvasRef<T> = { current: T };
type CanvasSentFingerprint = {
  attemptId: string;
  document: string;
  graph: string;
  liveEditors: boolean;
};

export type CanvasPendingPagehide = {
  attemptId: string;
  payload: string;
  saveSequence: number;
  serverEpoch: string;
};

export type CanvasSaveSession = {
  confirmedSequence: number;
  pendingPagehide?: CanvasPendingPagehide;
  saveSequence: number;
  saveSessionId: string;
  serverEpoch?: string;
  storageRevision: number;
};

export type CanvasSaveSuccess = {
  authoritativeDocument?: AuthoritativeCanvasDocument;
  currentGraphRevision?: number;
  currentLoadToken?: string;
  currentRevision?: number;
  graphRevision: number;
  loadToken: string;
  operationId?: string;
  originalSaveStatus?: "already-applied" | "applied";
  requiresAuthoritativeGet?: false;
  revision: number;
  saveAttemptId?: string;
  saveSequence?: number;
  saveSessionId?: string;
  saveStatus?: "already-applied" | "applied";
};

export type CanvasSaveRequestFence = {
  observedLoadToken?: string;
  revision: number;
  saveAttemptId?: string;
  saveSequence?: number;
  saveSessionId?: string;
};

export class CanvasStaleSaveSessionError extends Error {
  constructor() {
    super("Canvas pending save belongs to an old server epoch");
    this.name = "CanvasStaleSaveSessionError";
  }
}

export class CanvasSaveSessionStorageError extends Error {
  constructor(cause: unknown) {
    super("Canvas save session storage is unavailable", { cause });
    this.name = "CanvasSaveSessionStorageError";
  }
}

function isAttemptId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9-]{8,80}$/i.test(value);
}

export const isCanvasSaveAttemptId = isAttemptId;

export function isCanvasSaveEpoch(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128 &&
    value.trim() === value;
}

export function isCanvasLoadToken(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 &&
    value.length <= LOAD_TOKEN_MAX_LENGTH && value.trim() === value;
}

function isCanvasSaveSession(value: unknown): value is CanvasSaveSession {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const session = value as Partial<CanvasSaveSession>;
  const baseValid = typeof session.saveSessionId === "string" &&
    /^[a-z0-9-]{8,80}$/i.test(session.saveSessionId) &&
    Number.isSafeInteger(session.confirmedSequence) &&
    Number(session.confirmedSequence) >= 0 &&
    Number.isSafeInteger(session.saveSequence) &&
    Number(session.saveSequence) >= Number(session.confirmedSequence) &&
    Number.isSafeInteger(session.storageRevision) &&
    Number(session.storageRevision) >= 0 &&
    (session.serverEpoch === undefined || isCanvasSaveEpoch(session.serverEpoch)) &&
    (session.pendingPagehide === undefined || (
      Boolean(session.pendingPagehide) &&
      typeof session.pendingPagehide === "object" &&
      isAttemptId(session.pendingPagehide.attemptId) &&
      typeof session.pendingPagehide.payload === "string" &&
      new Blob([session.pendingPagehide.payload]).size <= SAVE_JOURNAL_MAX_BYTES &&
      Number.isSafeInteger(session.pendingPagehide.saveSequence) &&
      session.pendingPagehide.saveSequence > Number(session.confirmedSequence) &&
      session.pendingPagehide.saveSequence <= Number(session.saveSequence) &&
      isCanvasSaveEpoch(session.pendingPagehide.serverEpoch)
    ));
  if (!baseValid) return false;
  return session.pendingPagehide
    ? session.pendingPagehide.saveSequence === session.saveSequence &&
        session.pendingPagehide.saveSequence > Number(session.confirmedSequence) &&
        session.pendingPagehide.serverEpoch === session.serverEpoch
    : session.saveSequence === session.confirmedSequence;
}

function storageKey(scopeId: string) {
  return `${SAVE_SESSION_STORAGE_PREFIX}${scopeId}`;
}

export interface CanvasSaveJournalPort {
  load(scopeId: string): CanvasSaveSession;
  settleStored(input: {
    attemptId: string;
    payload: string;
    saveSequence: number;
    saveSessionId: string;
    scopeId: string;
    serverEpoch: string;
  }): { previousStorageRevision: number; settled: CanvasSaveSession } | undefined;
  store(
    scopeId: string,
    session: CanvasSaveSession,
    resolvedPendingAttemptId?: string,
  ): CanvasSaveSession;
}

/** Strict CAS journal adapter; browser and in-memory Storage share the same rules. */
export function createCanvasSaveJournalPort(input: {
  randomUUID?: () => string;
  storage: Pick<Storage, "getItem" | "setItem">;
}): CanvasSaveJournalPort {
  const randomUUID = input.randomUUID ?? (() => crypto.randomUUID());
  const load = (scopeId: string): CanvasSaveSession => {
    try {
      const stored = input.storage.getItem(storageKey(scopeId));
      const storedScopeIndex = input.storage.getItem(
        SAVE_SESSION_SCOPE_INDEX_KEY,
      );
      const knownScopes: unknown = storedScopeIndex === null
        ? []
        : JSON.parse(storedScopeIndex);
      if (!Array.isArray(knownScopes) ||
        !knownScopes.every((scope) => typeof scope === "string")) {
        throw new Error("Canvas save session scope index is invalid");
      }
      if (stored !== null) {
        const parsed: unknown = JSON.parse(stored);
        if (!isCanvasSaveSession(parsed)) {
          throw new Error("Canvas save session is invalid");
        }
        return parsed;
      }
      if (knownScopes.includes(scopeId)) {
        throw new Error("Canvas save session is missing for a known scope");
      }
      return {
        confirmedSequence: 0,
        saveSequence: 0,
        saveSessionId: randomUUID(),
        storageRevision: 0,
      };
    } catch (error) {
      throw new CanvasSaveSessionStorageError(error);
    }
  };

  const store: CanvasSaveJournalPort["store"] = (
    scopeId,
    session,
    resolvedPendingAttemptId,
  ) => {
    try {
      const key = storageKey(scopeId);
      const rawExisting = input.storage.getItem(key);
      let existing: CanvasSaveSession | undefined;
      if (rawExisting !== null) {
        const parsed: unknown = JSON.parse(rawExisting);
        if (!isCanvasSaveSession(parsed)) {
          throw new Error("Canvas save session is invalid");
        }
        existing = parsed;
        if (existing.saveSessionId !== session.saveSessionId) {
          throw new Error("Canvas save session identity changed");
        }
        if (existing.storageRevision !== session.storageRevision) {
          throw new Error("Canvas save session changed outside this page");
        }
      }
      const rawScopes = input.storage.getItem(SAVE_SESSION_SCOPE_INDEX_KEY);
      const scopes: unknown = rawScopes !== null ? JSON.parse(rawScopes) : [];
      if (!Array.isArray(scopes) ||
        !scopes.every((scope) => typeof scope === "string")) {
        throw new Error("Canvas save session scope index is invalid");
      }
      if (!existing && (session.storageRevision !== 0 || scopes.includes(scopeId))) {
        throw new Error("Canvas save session is missing for a known scope");
      }
      let pendingPagehide = session.pendingPagehide;
      if (existing?.pendingPagehide &&
        resolvedPendingAttemptId === existing.pendingPagehide.attemptId) {
        if (session.confirmedSequence < existing.pendingPagehide.saveSequence) {
          throw new Error("Canvas pending save is not confirmed");
        }
        pendingPagehide = undefined;
      }
      if (existing?.pendingPagehide && pendingPagehide === undefined &&
        resolvedPendingAttemptId !== existing.pendingPagehide.attemptId) {
        throw new Error("Canvas pending save journal changed outside this page");
      }
      const merged: CanvasSaveSession = {
        confirmedSequence: session.confirmedSequence,
        ...(pendingPagehide ? { pendingPagehide } : {}),
        saveSequence: session.saveSequence,
        saveSessionId: session.saveSessionId,
        ...(session.serverEpoch ? { serverEpoch: session.serverEpoch } : {}),
        storageRevision: session.storageRevision + 1,
      };
      if (!isCanvasSaveSession(merged)) {
        throw new Error("Canvas save session merge is invalid");
      }
      input.storage.setItem(key, JSON.stringify(merged));
      if (!scopes.includes(scopeId)) {
        input.storage.setItem(
          SAVE_SESSION_SCOPE_INDEX_KEY,
          JSON.stringify([...scopes, scopeId]),
        );
      }
      return merged;
    } catch (error) {
      throw new CanvasSaveSessionStorageError(error);
    }
  };

  const settleStored: CanvasSaveJournalPort["settleStored"] = (settlement) => {
    try {
      const key = storageKey(settlement.scopeId);
      const rawExisting = input.storage.getItem(key);
      if (rawExisting === null) return undefined;
      const parsed: unknown = JSON.parse(rawExisting);
      if (!isCanvasSaveSession(parsed)) {
        throw new Error("Canvas save session is invalid");
      }
      const existing = parsed;
      if (existing.saveSessionId !== settlement.saveSessionId) return undefined;
      if (existing.pendingPagehide?.attemptId !== settlement.attemptId ||
        existing.pendingPagehide.saveSequence !== settlement.saveSequence ||
        existing.saveSequence !== settlement.saveSequence ||
        existing.pendingPagehide.payload !== settlement.payload ||
        existing.pendingPagehide.serverEpoch !== settlement.serverEpoch) {
        return undefined;
      }
      const settled: CanvasSaveSession = {
        confirmedSequence: Math.max(
          existing.confirmedSequence,
          settlement.saveSequence,
        ),
        saveSequence: Math.max(existing.saveSequence, settlement.saveSequence),
        saveSessionId: existing.saveSessionId,
        ...(existing.serverEpoch ? { serverEpoch: existing.serverEpoch } : {}),
        storageRevision: existing.storageRevision + 1,
      };
      if (!isCanvasSaveSession(settled)) {
        throw new Error("Canvas save session settlement is invalid");
      }
      input.storage.setItem(key, JSON.stringify(settled));
      return { previousStorageRevision: existing.storageRevision, settled };
    } catch (error) {
      throw new CanvasSaveSessionStorageError(error);
    }
  };

  return { load, settleStored, store };
}

export type CanvasPersistenceHttpResult = Readonly<{
  body: unknown;
  ok: boolean;
  status: number;
}>;

export interface CanvasPersistenceTransport {
  prepareWorkflowResultAdoption?(input: {
    canvasId: string;
    current: readonly unknown[];
    document: LoadedCanvasDocument;
    run: WorkflowRunSummary;
  }): { baseline: AuthoritativeCanvasDocument; nodes: readonly unknown[];
    conflicts: string[]; received: string[]; mergeHistory: (nodes: readonly unknown[]) => readonly unknown[]; commit: () => boolean } | undefined;
  adoptAuthoritativeDocument?(input: {
    canvasId: string;
    document: unknown;
    loadToken: string;
  }): boolean;
  load(input: {
    adopt?: boolean;
    canvasId: string;
    saveSessionId: string;
    signal: AbortSignal;
  }): Promise<CanvasPersistenceHttpResult>;
  preparePayload?(input: {
    canvasId: string;
    payload: string;
  }): string;
  put(input: {
    canvasId: string;
    keepalive?: boolean;
    payload: string;
    responseMode: "lenient-text" | "strict-json";
    signal?: AbortSignal;
  }): Promise<CanvasPersistenceHttpResult>;
}

/** One bounded read, including its body; cancellation never retries a request. */
export async function loadCanvasPersistenceWithDeadline(input: {
  adopt?: boolean;
  canvasId: string;
  controller: AbortController;
  saveSessionId: string;
  timeoutMs?: number;
  timeoutReason: string;
  transport: CanvasPersistenceTransport;
}): Promise<CanvasPersistenceHttpResult> {
  const { signal } = input.controller;
  const abortError = () => new DOMException(
    signal.reason === input.timeoutReason
      ? "Canvas load response timed out"
      : "Canvas read aborted",
    "AbortError",
  );
  if (signal.aborted) throw abortError();
  let rejectAbort!: () => void;
  const cancelled = new Promise<never>((_resolve, reject) => {
    rejectAbort = () => reject(abortError());
    signal.addEventListener("abort", rejectAbort, { once: true });
  });
  const timeout = setTimeout(
    () => input.controller.abort(input.timeoutReason),
    input.timeoutMs ?? CANVAS_READ_TIMEOUT_MS,
  );
  try {
    const response = await Promise.race([
      input.transport.load({
        adopt: input.adopt,
        canvasId: input.canvasId,
        saveSessionId: input.saveSessionId,
        signal,
      }),
      cancelled,
    ]);
    if (signal.aborted) throw abortError();
    return response;
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", rejectAbort);
  }
}

type BrowserCanvasWritePayload = CanvasCommandTargetDocument & Readonly<{
  canvasCommandJournal?: readonly CanvasCommandJournalEntry[];
  canvasCommandJournalVersion?: 1;
  observedLoadToken?: string;
  observedRevision?: number;
  revision: number;
  saveAttemptId: string;
  saveSequence: number;
  saveSessionId: string;
}>;

type CachedAuthoritativeCanvas = Readonly<{
  document: AuthoritativeCanvasDocument;
  loadToken: string;
}>;

type BrowserCommandWrite = {
  command?: CanvasUserCommand;
  index: number;
  intents: readonly CanvasCommandIntent[];
  payload: string;
  target: BrowserCanvasWritePayload;
};

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function isCanvasViewport(value: unknown): value is { x: number; y: number; zoom: number } {
  const viewport = recordValue(value);
  return Boolean(viewport && [viewport.x, viewport.y, viewport.zoom].every(
    (part) => typeof part === "number" && Number.isFinite(part),
  ) && Number(viewport?.zoom) > 0);
}

function authoritativeCanvasDocument(
  value: unknown,
): AuthoritativeCanvasDocument | undefined {
  const document = recordValue(value);
  if (!document || !Array.isArray(document.nodes) || !Array.isArray(document.edges) ||
      !isCanvasViewport(document.viewport) || !Number.isSafeInteger(document.revision) ||
      Number(document.revision) < 0 || !Number.isSafeInteger(document.graphRevision) ||
      Number(document.graphRevision) < 0 ||
      Number(document.graphRevision) > Number(document.revision)) return undefined;
  return {
    edges: document.edges,
    graphRevision: Number(document.graphRevision),
    nodes: document.nodes,
    revision: Number(document.revision),
    viewport: document.viewport,
  };
}

function browserCanvasWritePayload(value: unknown): BrowserCanvasWritePayload | undefined {
  const payload = recordValue(value);
  if (!payload || !Array.isArray(payload.nodes) || !Array.isArray(payload.edges) ||
      !isCanvasViewport(payload.viewport) || !Number.isSafeInteger(payload.revision) ||
      Number(payload.revision) < 0 || !isAttemptId(payload.saveAttemptId) ||
      !isAttemptId(payload.saveSessionId) || !Number.isSafeInteger(payload.saveSequence) ||
      Number(payload.saveSequence) < 1 ||
      (payload.observedRevision !== undefined &&
        (!Number.isSafeInteger(payload.observedRevision) ||
          Number(payload.observedRevision) < 0)) ||
      (payload.observedLoadToken !== undefined &&
        !isCanvasLoadToken(payload.observedLoadToken))) return undefined;
  if (payload.canvasCommandJournal !== undefined &&
      (!Array.isArray(payload.canvasCommandJournal) ||
        payload.canvasCommandJournal.some((entry) => {
          const candidate = recordValue(entry);
          return !candidate || typeof candidate.kind !== "string" ||
            typeof candidate.lane !== "string" || candidate.lane.length < 1 ||
            candidate.lane.length > 200;
        }))) return undefined;
  return payload as BrowserCanvasWritePayload;
}

function commandResponse(value: unknown): CanvasCommandResponse | undefined {
  const response = recordValue(value);
  const document = authoritativeCanvasDocument(response?.authoritativeDocument);
  if (!response || !document ||
      response.currentDocumentRevision !== document.revision ||
      response.currentInputGraphRevision !== document.graphRevision ||
      !isCanvasLoadToken(response.currentLoadToken) ||
      typeof response.operationId !== "string" ||
      !Number.isSafeInteger(response.operationDocumentRevision) ||
      !Number.isSafeInteger(response.operationInputGraphRevision) ||
      typeof response.originalRequestId !== "string" ||
      typeof response.requestId !== "string" ||
      typeof response.replayed !== "boolean") return undefined;
  if (typeof response.code === "string" && typeof response.error === "string") {
    return response as unknown as CanvasCommandResponse;
  }
  return (response.status === "applied" || response.status === "already-applied") &&
      (response.originalStatus === "applied" ||
        response.originalStatus === "already-applied")
    ? response as unknown as CanvasCommandResponse
    : undefined;
}

function legacyCompatibleCommandResponse(
  response: CanvasCommandResponse,
  target: BrowserCanvasWritePayload,
) {
  const document = response.authoritativeDocument;
  const common = {
    authoritativeDocument: document,
    currentGraphRevision: response.currentInputGraphRevision,
    currentLoadToken: response.currentLoadToken,
    currentRevision: response.currentDocumentRevision,
    graphRevision: response.currentInputGraphRevision,
    loadToken: response.currentLoadToken,
    operationId: response.operationId,
    originalRequestId: response.originalRequestId,
    replayed: response.replayed,
    requestId: response.requestId,
    revision: response.currentDocumentRevision,
    saveAttemptId: target.saveAttemptId,
    saveSequence: target.saveSequence,
    saveSessionId: target.saveSessionId,
  };
  if ("code" in response) {
    return {
      ...common,
      code: response.code,
      error: response.error,
      rejectedAttemptId: target.saveAttemptId,
      rejectedSequence: target.saveSequence,
      rejectedSessionId: target.saveSessionId,
      requiresAuthoritativeGet: true,
    };
  }
  return {
    ...common,
    originalSaveStatus: response.originalStatus,
    requiresAuthoritativeGet: false,
    saveStatus: response.status,
  };
}

async function fetchBody(response: Response) {
  const serialized = await response.text();
  if (!serialized) return {};
  try {
    return JSON.parse(serialized) as unknown;
  } catch {
    return {};
  }
}

/**
 * Browser transport for the modern Canvas build.  The surrounding controller
 * may still hold a legacy-shaped local recovery snapshot, but this boundary
 * serializes only the closed command-v1 union onto the wire.
 */
export function createFetchCanvasPersistenceTransport(
  fetcher: typeof fetch = fetch,
  options: Readonly<{
    legacyFullDocumentWritesForSafeTests?: boolean;
    safeFixtureId?: string;
  }> = {},
): CanvasPersistenceTransport {
  const authoritative = new Map<string, CachedAuthoritativeCanvas>();
  const activeIntents = new Map<string, Readonly<{
    baseline: AuthoritativeCanvasDocument;
    entries: readonly CanvasCommandJournalEntry[];
  }>>();
  const writes = new Map<string, BrowserCommandWrite>();

  const read = async (response: Response) => ({
    body: await fetchBody(response),
    ok: response.ok,
    status: response.status,
  });
  const remember = (canvasId: string, value: unknown, loadToken?: unknown) => {
    const document = authoritativeCanvasDocument(value);
    if (!document || !isCanvasLoadToken(loadToken)) return undefined;
    const cached = { document, loadToken };
    authoritative.set(canvasId, cached);
    return cached;
  };
  const stage = (canvasId: string, payload: BrowserCanvasWritePayload) => {
    if (payload.canvasCommandJournalVersion === 1 &&
        Array.isArray(payload.canvasCommandJournal)) {
      return payload.canvasCommandJournal;
    }
    const cached = authoritative.get(canvasId);
    if (!cached || payload.observedRevision === undefined) return undefined;
    const existing = activeIntents.get(canvasId);
    const baseline = existing?.baseline ?? cached.document;
    const entries = canvasCommandJournalEntries(
      planCanvasCommandIntents(baseline, payload),
    );
    activeIntents.set(canvasId, { baseline, entries });
    return entries;
  };
  const post = async (
    canvasId: string,
    command: CanvasUserCommand,
    input: Pick<Parameters<CanvasPersistenceTransport["put"]>[0], "keepalive" | "signal">,
  ) => read(await fetcher(`/api/canvases/${canvasId}/commands`, {
    body: JSON.stringify(command),
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Unboundry-Client-Build": clientBuildVersion,
      "X-Unboundry-Canvas-Write-Contract": canvasCommandWriteContract,
    },
    ...(input.keepalive ? { keepalive: true } : {}),
    method: "POST",
    ...(input.signal ? { signal: input.signal } : {}),
  }));

  return {
    prepareWorkflowResultAdoption(input) {
      const cached = authoritative.get(input.canvasId);
      const next = authoritativeCanvasDocument(input.document);
      if (!cached || !next || input.run.canvasId !== input.canvasId ||
          next.revision < cached.document.revision ||
          !isCanvasLoadToken(input.document.loadToken)) return undefined;
      const existing = activeIntents.get(input.canvasId);
      const originalBaseline = existing?.baseline ?? cached.document;
      const merged = mergeWorkflowResultNodes({
        baseline: originalBaseline.nodes, current: input.current,
        incoming: next.nodes, run: input.run,
      });
      const baseline = { ...originalBaseline, nodes: merged.baseline };
      return { ...merged, baseline,
        mergeHistory(nodes) {
          return mergeWorkflowResultNodes({ baseline: originalBaseline.nodes,
            current: nodes, incoming: next.nodes, run: input.run }).nodes;
        }, commit() {
        if (authoritative.get(input.canvasId) !== cached ||
            activeIntents.get(input.canvasId) !== existing) return false;
        authoritative.set(input.canvasId, { document: next, loadToken: input.document.loadToken });
        activeIntents.set(input.canvasId, { baseline, entries: existing?.entries ?? [] });
        return true;
      } };
    },
    adoptAuthoritativeDocument(input) {
      return Boolean(remember(
        input.canvasId,
        input.document,
        input.loadToken,
      ));
    },
    async load(input) {
      const response = await fetcher(`/api/canvas/${input.canvasId}`, {
        headers: {
          Accept: "application/json",
          "X-Unboundry-Canvas-Save-Session": input.saveSessionId,
        },
        signal: input.signal,
      });
      const result = options.legacyFullDocumentWritesForSafeTests
        ? {
            body: await response.json(),
            ok: response.ok,
            status: response.status,
          }
        : await read(response);
      // Body readers can ignore cancellation. Never adopt their late result.
      if (input.signal.aborted) {
        throw new DOMException("Canvas read aborted", "AbortError");
      }
      if (result.ok && input.adopt !== false) {
        const body = recordValue(result.body);
        remember(input.canvasId, result.body, body?.loadToken);
      } else if (result.status === 404 && input.adopt !== false) {
        authoritative.delete(input.canvasId);
      }
      return result;
    },
    preparePayload(input) {
      try {
        const parsed = browserCanvasWritePayload(JSON.parse(input.payload));
        if (!parsed || parsed.observedRevision === undefined) return input.payload;
        const entries = stage(input.canvasId, parsed);
        if (!entries) return input.payload;
        return JSON.stringify({
          ...parsed,
          canvasCommandJournal: entries,
          canvasCommandJournalVersion: 1,
        });
      } catch {
        return input.payload;
      }
    },
    async put(input) {
      let target: BrowserCanvasWritePayload | undefined;
      try {
        target = browserCanvasWritePayload(JSON.parse(input.payload));
      } catch {
        target = undefined;
      }
      if (!target) {
        return {
          body: {
            code: "CANVAS_COMMAND_JOURNAL_INVALID",
            error: "Canvas command journal is invalid",
          },
          ok: false,
          status: 400,
        };
      }
      if (options.legacyFullDocumentWritesForSafeTests) {
        const response = await fetcher(`/api/canvas/${input.canvasId}`, {
          body: input.payload,
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "X-Unboundry-Canvas-Write-Contract": "legacy-put-v1",
          },
          ...(input.keepalive ? { keepalive: true } : {}),
          method: "PUT",
          ...(input.signal ? { signal: input.signal } : {}),
        });
        if (input.responseMode === "strict-json") {
          return {
            body: await response.json(),
            ok: response.ok,
            status: response.status,
          };
        }
        return read(response);
      }
      if (
        options.safeFixtureId === input.canvasId &&
        target.revision === 0 && target.observedRevision === undefined
      ) {
        return read(await fetcher(`/api/canvas/${input.canvasId}`, {
          body: input.payload,
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "X-Unboundry-Safe-Fixture-Seed": options.safeFixtureId,
          },
          ...(input.keepalive ? { keepalive: true } : {}),
          method: "PUT",
          ...(input.signal ? { signal: input.signal } : {}),
        }));
      }
      const writeKey = `${input.canvasId}\u0000${target.saveAttemptId}`;
      let write = writes.get(writeKey);
      if (write && write.payload !== input.payload) {
        return {
          body: {
            code: "CANVAS_OPERATION_REUSED",
            error: "Canvas save attempt was reused with another payload",
          },
          ok: false,
          status: 409,
        };
      }

      if (!write && target.revision === 0 && target.observedRevision === undefined) {
        const createBase: CreateCanvasDocumentCommand = {
          baseDocumentRevision: null,
          baseInputGraphRevision: null,
          initialDocument: initialCanvasCommandDocument(target),
          kind: "create-canvas-document",
          observedLoadToken: null,
          operationId: `save-marker:${target.saveAttemptId}`,
          saveSequence: target.saveSequence,
          saveSessionId: target.saveSessionId,
        };
        write = {
          command: createBase,
          index: 0,
          intents: [],
          payload: input.payload,
          target,
        };
        writes.set(writeKey, write);
      }

      if (!write) {
        let cached = authoritative.get(input.canvasId);
        if (!cached) {
          const loaded = await fetcher(`/api/canvas/${input.canvasId}`, {
            headers: {
              Accept: "application/json",
              "X-Unboundry-Canvas-Save-Session": target.saveSessionId,
            },
            ...(input.signal ? { signal: input.signal } : {}),
          });
          const loadedResult = await read(loaded);
          const body = recordValue(loadedResult.body);
          cached = loadedResult.ok
            ? remember(input.canvasId, loadedResult.body, body?.loadToken)
            : undefined;
          if (!cached) return loadedResult;
        }
        const entries = stage(input.canvasId, target) ?? [];
        let intents: readonly CanvasCommandIntent[];
        try {
          intents = entries.map(canvasCommandIntentFromJournalEntry);
        } catch {
          return {
            body: {
              code: "CANVAS_COMMAND_JOURNAL_INVALID",
              error: "Canvas command journal is invalid",
            },
            ok: false,
            status: 400,
          };
        }
        write = { index: 0, intents, payload: input.payload, target };
        writes.set(writeKey, write);
        if (intents.length === 0) {
          writes.delete(writeKey);
          activeIntents.delete(input.canvasId);
          return {
            body: {
              authoritativeDocument: cached.document,
              currentGraphRevision: cached.document.graphRevision,
              currentLoadToken: cached.loadToken,
              currentRevision: cached.document.revision,
              graphRevision: cached.document.graphRevision,
              loadToken: cached.loadToken,
              requiresAuthoritativeGet: false,
              revision: cached.document.revision,
              saveAttemptId: target.saveAttemptId,
              saveSequence: target.saveSequence,
              saveSessionId: target.saveSessionId,
              saveStatus: "already-applied",
            },
            ok: true,
            status: 200,
          };
        }
      }

      while (true) {
        let cached = authoritative.get(input.canvasId);
        if (!cached && write.command?.kind !== "create-canvas-document") {
          writes.delete(writeKey);
          return {
            body: { code: "CANVAS_LOAD_REQUIRED", error: "Canvas must be loaded" },
            ok: false,
            status: 409,
          };
        }
        if (!write.command && write.index < write.intents.length) {
          const intent = write.intents[write.index]!;
          const finalJournalIntent = write.index === write.intents.length - 1;
          const base: ExistingCanvasCommandBase = {
            baseDocumentRevision: cached!.document.revision,
            baseInputGraphRevision: cached!.document.graphRevision,
            observedLoadToken: cached!.loadToken,
            operationId: "pending-operation",
            saveSequence: finalJournalIntent ? target.saveSequence : 1,
            saveSessionId: finalJournalIntent
              ? target.saveSessionId
              : commandSessionId(
                  target.saveSessionId,
                  `${target.saveAttemptId}:${intent.lane}`,
                ),
          };
          const materialized = intent.materialize(base, cached!.document);
          if (!materialized) {
            write.index += 1;
            continue;
          }
          write.command = {
            ...materialized,
            operationId: commandOperationId({
              attemptId: target.saveAttemptId,
              command: materialized,
              lane: intent.lane,
            }),
          };
        }
        if (!write.command) {
          const markerBase: ExistingCanvasCommandBase = {
            baseDocumentRevision: cached!.document.revision,
            baseInputGraphRevision: cached!.document.graphRevision,
            observedLoadToken: cached!.loadToken,
            operationId: `save-marker:${target.saveAttemptId}`,
            saveSequence: target.saveSequence,
            saveSessionId: target.saveSessionId,
          };
          write.command = {
            ...markerBase,
            kind: "commit-user-layout",
            viewport: cached!.document.viewport,
          };
        }
        const sentCommand = write.command;
        const posted = await post(input.canvasId, sentCommand, input);
        const parsed = commandResponse(posted.body);
        if (parsed) {
          cached = remember(
            input.canvasId,
            parsed.authoritativeDocument,
            parsed.currentLoadToken,
          );
        }
        if (!posted.ok || !parsed) {
          if (parsed && "code" in parsed) {
            writes.delete(writeKey);
            return {
              body: legacyCompatibleCommandResponse(parsed, target),
              ok: false,
              status: posted.status,
            };
          }
          return posted;
        }
        if (parsed.operationId !== sentCommand.operationId) {
          return {
            body: {
              code: "CANVAS_COMMAND_RESPONSE_INVALID",
              error: "Canvas command response identity is invalid",
            },
            ok: false,
            status: 502,
          };
        }
        const completedWithFinalJournalIntent =
          write.intents.length > 0 &&
          write.index === write.intents.length - 1;
        write.command = undefined;
        if (completedWithFinalJournalIntent) {
          writes.delete(writeKey);
          activeIntents.delete(input.canvasId);
          return {
            body: legacyCompatibleCommandResponse(parsed, target),
            ok: true,
            status: 200,
          };
        }
        if (write.index < write.intents.length) {
          write.index += 1;
          continue;
        }
        writes.delete(writeKey);
        activeIntents.delete(input.canvasId);
        return {
          body: legacyCompatibleCommandResponse(parsed, target),
          ok: true,
          status: 200,
        };
      }
    },
  };
}

export function canvasSaveRequestFence(
  payload: string,
): CanvasSaveRequestFence | undefined {
  try {
    const value: unknown = JSON.parse(payload);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return undefined;
    }
    const request = value as {
      observedLoadToken?: unknown;
      observedRevision?: unknown;
      revision?: unknown;
      saveAttemptId?: unknown;
      saveSequence?: unknown;
      saveSessionId?: unknown;
    };
    if (!Number.isSafeInteger(request.revision) || Number(request.revision) < 0) {
      return undefined;
    }
    const tuplePresent = request.saveAttemptId !== undefined ||
      request.saveSequence !== undefined || request.saveSessionId !== undefined;
    if (tuplePresent && (!isAttemptId(request.saveAttemptId) ||
        !Number.isSafeInteger(request.saveSequence) ||
        Number(request.saveSequence) < 1 ||
        !isAttemptId(request.saveSessionId))) return undefined;
    const tuple = tuplePresent
      ? {
          saveAttemptId: String(request.saveAttemptId),
          saveSequence: Number(request.saveSequence),
          saveSessionId: String(request.saveSessionId),
        }
      : {};
    if (request.observedLoadToken === undefined) {
      return { revision: Number(request.revision), ...tuple };
    }
    if (!isCanvasLoadToken(request.observedLoadToken) ||
      request.observedRevision !== request.revision) {
      return undefined;
    }
    return {
      observedLoadToken: request.observedLoadToken,
      revision: Number(request.revision),
      ...tuple,
    };
  } catch {
    return undefined;
  }
}

export function isCanvasSaveSuccess(
  value: unknown,
  requestFence: CanvasSaveRequestFence | undefined,
): value is CanvasSaveSuccess {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const result = value as Partial<CanvasSaveSuccess>;
  const common = Boolean(requestFence) && Number.isSafeInteger(result.revision) &&
    Number(result.revision) >= 0 &&
    Number(result.revision) > Number(requestFence?.revision) &&
    Number.isSafeInteger(result.graphRevision) &&
    Number(result.graphRevision) >= 0 &&
    Number(result.graphRevision) <= Number(result.revision) &&
    isCanvasLoadToken(result.loadToken) &&
    (requestFence?.observedLoadToken === undefined ||
      result.loadToken !== requestFence.observedLoadToken);
  if (common) return true;
  const authoritative = authoritativeCanvasDocument(result.authoritativeDocument);
  return Boolean(requestFence && authoritative) &&
    result.saveStatus === "already-applied" &&
    result.requiresAuthoritativeGet === false &&
    result.saveAttemptId === requestFence?.saveAttemptId &&
    result.saveSequence === requestFence?.saveSequence &&
    result.saveSessionId === requestFence?.saveSessionId &&
    Number(result.revision) === requestFence?.revision &&
    result.currentRevision === result.revision &&
    result.currentGraphRevision === result.graphRevision &&
    result.currentLoadToken === result.loadToken &&
    authoritative?.revision === result.revision &&
    authoritative?.graphRevision === result.graphRevision &&
    isCanvasLoadToken(result.loadToken);
}

export function isCanvasSaveFence(value: unknown): value is CanvasSaveFence {
  if (!value || typeof value !== "object") return false;
  const document = value as Partial<CanvasSaveFence>;
  return isCanvasSaveEpoch(document.saveEpoch) &&
    Number.isSafeInteger(document.sessionHighWaterSequence) &&
    Number(document.sessionHighWaterSequence) >= 0 &&
    (document.sessionHighWaterAttemptId === null ||
      isAttemptId(document.sessionHighWaterAttemptId)) &&
    Number.isSafeInteger(document.currentWriterSequence) &&
    Number(document.currentWriterSequence) >= 0 &&
    (document.currentWriterSessionId === null ||
      isAttemptId(document.currentWriterSessionId));
}

export function isLoadedCanvasDocument(
  value: unknown,
): value is LoadedCanvasDocument {
  if (!value || typeof value !== "object" || !isCanvasSaveFence(value)) {
    return false;
  }
  const document = value as Partial<LoadedCanvasDocument>;
  return Array.isArray(document.edges) && Array.isArray(document.nodes) &&
    isCanvasLoadToken(document.loadToken) &&
    Number.isSafeInteger(document.revision) && Number(document.revision) >= 0 &&
    (document.graphRevision === undefined ||
      (Number.isSafeInteger(document.graphRevision) &&
        Number(document.graphRevision) >= 0 &&
        Number(document.graphRevision) <= Number(document.revision))) &&
    Boolean(document.viewport) &&
    [document.viewport?.x, document.viewport?.y, document.viewport?.zoom].every(
      (coordinate) => typeof coordinate === "number" && Number.isFinite(coordinate),
    ) && Number(document.viewport?.zoom) > 0;
}

export function canvasLoadFailure(error: unknown): CanvasLoadFailure {
  if (error instanceof CanvasStaleSaveSessionError) {
    return {
      kind: "stale-save-session",
      message: "检测到服务器重启前仍有一份未确认的本地保存，且内容与服务器版本不同。当前页会保留这份本地恢复副本；请打开服务器版本继续使用，系统不会覆盖任何一份内容。",
    };
  }
  if (error instanceof CanvasSaveSessionStorageError) {
    return {
      kind: "storage",
      message: "浏览器会话存储不可用，已停止画布保存和生成以保护数据。请恢复浏览器存储后重试。",
    };
  }
  const message = error instanceof Error ? error.message : "";
  if (message.includes("timed out") || message.startsWith("Canvas load failed:") ||
    error instanceof TypeError) {
    return {
      kind: "connection",
      message: "暂时无法从服务器读取画布。没有打开空白画布，也没有保存或生成；请检查连接后重试。",
    };
  }
  if (message.includes("invalid") || message.includes("stale document") ||
    message.includes("save fence")) {
    return {
      kind: "invalid-response",
      message: "服务器返回的画布数据不完整。为保护原内容，当前页没有保存或生成，请稍后重试。",
    };
  }
  return {
    kind: "unknown",
    message: "画布暂时无法安全打开。没有打开空白画布，也没有保存或生成，请重试。",
  };
}

export function pendingPagehideSnapshot(input: {
  normalizeNodes: (nodes: ProbeNodeType[]) => ProbeNodeType[];
  pending: CanvasPendingPagehide;
  saveSessionId: string;
}): CanvasPersistenceSnapshot | undefined {
  try {
    const parsed: unknown = JSON.parse(input.pending.payload);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined;
    }
    const document = parsed as {
      canvasCommandJournal?: unknown;
      canvasCommandJournalVersion?: unknown;
      edges?: unknown;
      nodes?: unknown;
      saveAttemptId?: unknown;
      saveSequence?: unknown;
      saveSessionId?: unknown;
      viewport?: { x?: unknown; y?: unknown; zoom?: unknown };
    };
    if (!Array.isArray(document.edges) || !Array.isArray(document.nodes) ||
      document.saveAttemptId !== input.pending.attemptId ||
      document.saveSequence !== input.pending.saveSequence ||
      document.saveSessionId !== input.saveSessionId || !document.viewport ||
      ![document.viewport.x, document.viewport.y, document.viewport.zoom].every(
        (coordinate) => typeof coordinate === "number" && Number.isFinite(coordinate),
      ) || Number(document.viewport.zoom) <= 0) {
      return undefined;
    }
    const snapshot = {
      edges: document.edges as CuttableEdge[],
      nodes: input.normalizeNodes(document.nodes as ProbeNodeType[]),
      viewport: document.viewport as Viewport,
    };
    return {
      ...snapshot,
      ...(document.canvasCommandJournalVersion === 1 &&
          Array.isArray(document.canvasCommandJournal)
        ? {
            commandJournal: document.canvasCommandJournal as
              readonly CanvasCommandJournalEntry[],
          }
        : {}),
      fingerprint: canvasUserDocumentFingerprint(snapshot),
      graphFingerprint: canvasGraphFingerprint(snapshot),
    };
  } catch {
    return undefined;
  }
}

export function nextCanvasPersistenceRetryDelay(current: number) {
  return Math.min(current * 2, RETRY_MAX_MS);
}

export function canSendCanvasPagehidePayload(payload: string) {
  return new Blob([payload]).size <= PAGEHIDE_MAX_BYTES;
}

function syncChannel(accountId: string, canvasId: string) {
  const scope = accountId ? `${accountId}:${canvasId}` : canvasId;
  return typeof BroadcastChannel === "undefined"
    ? null
    : new BroadcastChannel(`unboundry-canvas-sync:${scope}`);
}

export interface CanvasPersistenceFacade {
  bindBeforeUnload(hasPendingChanges: () => boolean): () => void;
  bindPagehide(flush: () => void): () => void;
  bindPersistedPageRestore(shouldReload: () => boolean): () => void;
  broadcastSaved(
    accountId: string,
    canvasId: string,
    revision: number,
    instanceId: string,
  ): void;
  canSendPagehide(payload: string): boolean;
  classifyLoadFailure(error: unknown): CanvasLoadFailure;
  createSyncChannel(accountId: string, canvasId: string): BroadcastChannel | null;
  isLoadedDocument(value: unknown): value is LoadedCanvasDocument;
  isSaveFence(value: unknown): value is CanvasSaveFence;
  isSaveSuccess(
    value: unknown,
    requestFence: CanvasSaveRequestFence | undefined,
  ): value is CanvasSaveSuccess;
  journal: CanvasSaveJournalPort;
  nextRetryDelay(current: number): number;
  pendingSnapshot: typeof pendingPagehideSnapshot;
  requestFence(payload: string): CanvasSaveRequestFence | undefined;
  subscribeSaved(input: {
    accountId: string;
    canvasId: string;
    instanceId: string;
    onRevision(revision: number): void;
  }): () => void;
  transport: CanvasPersistenceTransport;
}

export type CanvasHydrationFingerprint = Readonly<{
  attemptId: string;
  document: string;
  graph: string;
  liveEditors: boolean;
}>;

export type CanvasHydrationResult =
  | Readonly<{ kind: "cancelled" }>
  | Readonly<{ kind: "missing" }>
  | Readonly<{
      document: LoadedCanvasDocument;
      fingerprint: string;
      graphFingerprint: string;
      graphRevision: number;
      kind: "ready";
    }>;

export interface CanvasHydrationRuntime {
  clearPendingPagehide(): void;
  confirmedSaveSequence(): number;
  createInitialDocument?: () => Readonly<{
    edges: CuttableEdge[];
    nodes: ProbeNodeType[];
    viewport: Viewport;
  }>;
  externalRevision(): number | undefined;
  isCurrent(): boolean;
  normalizeDocument(document: LoadedCanvasDocument): LoadedCanvasDocument;
  normalizeNodes(nodes: ProbeNodeType[]): ProbeNodeType[];
  pendingPagehide(): CanvasPendingPagehide | undefined;
  persistSaveSession(resolvedPendingAttemptId?: string): void;
  randomUUID(): string;
  rememberSentFingerprint(
    saveSequence: number,
    fingerprint: CanvasHydrationFingerprint,
  ): void;
  reserveSaveAttempt(
    attemptId: string,
    payloadFactory: (saveSequence: number) => string,
    minimumSequence?: number,
  ): Readonly<{ payload: string; saveSequence: number }>;
  saveSequence(): number;
  saveSessionId(): string;
  setConfirmedSaveSequence(saveSequence: number): void;
  setServerFence(fence: CanvasSaveFence): void;
  settleSentFingerprint(saveSequence: number, confirmed: boolean): void;
}

/**
 * Owns the load/create/pagehide-replay protocol. React only supplies graph
 * normalization, snapshot creation, and the mutable save-session boundary.
 */
export async function hydrateCanvasPersistence(input: {
  canvasId: string;
  controller: AbortController;
  facade: CanvasPersistenceFacade;
  loadTimeoutMs: number;
  runtime: CanvasHydrationRuntime;
  saveTimeoutMs: number;
}): Promise<CanvasHydrationResult> {
  const { controller, facade, runtime } = input;
  const putHydrationDocument = async (payload: string, timeoutReason: string) => {
    let mutationTimeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        facade.transport.put({
          canvasId: input.canvasId,
          payload,
          responseMode: "strict-json",
          signal: controller.signal,
        }),
        new Promise<never>((_resolve, reject) => {
          mutationTimeout = setTimeout(() => {
            reject(new Error(timeoutReason));
            controller.abort(timeoutReason);
          }, input.saveTimeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(mutationTimeout);
    }
  };

  {
    const response = await loadCanvasPersistenceWithDeadline({
      canvasId: input.canvasId,
      controller,
      saveSessionId: runtime.saveSessionId(),
      timeoutMs: input.loadTimeoutMs,
      timeoutReason: "canvas-load-timeout",
      transport: facade.transport,
    });
    if (!runtime.isCurrent()) return { kind: "cancelled" };
    const missing = response.status === 404;
    if (!missing && !response.ok) {
      throw new Error(`Canvas load failed: ${response.status}`);
    }
    if ((missing && !facade.isSaveFence(response.body)) ||
      (!missing && !facade.isLoadedDocument(response.body))) {
      throw new Error("Canvas load returned an invalid save fence");
    }

    const fence = response.body as CanvasSaveFence;
    let document = missing ? undefined : response.body as LoadedCanvasDocument;
    const pending = runtime.pendingPagehide();
    const pendingSnapshot = pending
      ? facade.pendingSnapshot({
          normalizeNodes: runtime.normalizeNodes,
          pending,
          saveSessionId: runtime.saveSessionId(),
        })
      : undefined;
    if (pending && !pendingSnapshot) {
      throw new Error("Canvas pending pagehide journal is invalid");
    }
    const normalizedLoadedDocument = document
      ? runtime.normalizeDocument(document)
      : undefined;
    const highWaterProvesPending = Boolean(pending &&
      fence.sessionHighWaterSequence >= pending.saveSequence &&
      fence.sessionHighWaterAttemptId === pending.attemptId);
    const currentWriterProvesPending = Boolean(
      pending && pendingSnapshot && normalizedLoadedDocument &&
      fence.currentWriterSessionId === runtime.saveSessionId() &&
      fence.currentWriterSequence >= pending.saveSequence &&
      canvasUserDocumentFingerprint(normalizedLoadedDocument) ===
        pendingSnapshot.fingerprint,
    );
    const oldEpochDocumentProvesPending = Boolean(
      pending && pendingSnapshot && normalizedLoadedDocument &&
      pending.serverEpoch !== fence.saveEpoch &&
      canvasUserDocumentFingerprint(normalizedLoadedDocument) ===
        pendingSnapshot.fingerprint,
    );
    runtime.setServerFence(fence);

    if (pending && (highWaterProvesPending || currentWriterProvesPending ||
      oldEpochDocumentProvesPending)) {
      if (runtime.saveSequence() !== pending.saveSequence) {
        throw new Error("Canvas has an unconfirmed save after its journal");
      }
      runtime.setConfirmedSaveSequence(Math.max(
        runtime.confirmedSaveSequence(),
        pending.saveSequence,
      ));
      runtime.clearPendingPagehide();
      runtime.persistSaveSession(pending.attemptId);
    } else if (pending) {
      if (!pendingSnapshot) {
        throw new Error("Canvas pending pagehide journal is invalid");
      }
      if (pending.serverEpoch !== fence.saveEpoch) {
        throw new CanvasStaleSaveSessionError();
      }
      const replaySequence = Math.max(
        runtime.saveSequence(),
        fence.sessionHighWaterSequence,
        pending.saveSequence,
      ) + 1;
      const replayAttemptId = runtime.randomUUID();
      const { payload: replayPayload } = runtime.reserveSaveAttempt(
        replayAttemptId,
        (candidateSequence) => JSON.stringify({
          ...(pendingSnapshot.commandJournal
            ? {
                canvasCommandJournal: pendingSnapshot.commandJournal,
                canvasCommandJournalVersion: 1,
              }
            : {}),
          edges: pendingSnapshot.edges,
          nodes: pendingSnapshot.nodes,
          ...(document ? {
            observedLoadToken: document.loadToken,
            observedRevision: document.revision,
          } : {}),
          revision: document?.revision ?? 0,
          saveAttemptId: replayAttemptId,
          saveSequence: candidateSequence,
          saveSessionId: runtime.saveSessionId(),
          viewport: pendingSnapshot.viewport,
        }),
        replaySequence,
      );
      runtime.rememberSentFingerprint(replaySequence, {
        attemptId: replayAttemptId,
        document: pendingSnapshot.fingerprint,
        graph: pendingSnapshot.graphFingerprint,
        liveEditors: true,
      });
      const replayed = await putHydrationDocument(
        replayPayload,
        "Canvas pending replay response timed out",
      );
      if (!runtime.isCurrent()) return { kind: "cancelled" };
      if (!replayed.ok) {
        throw new Error(`Canvas pending replay failed: ${replayed.status}`);
      }
      if (!facade.isSaveSuccess(
        replayed.body,
        facade.requestFence(replayPayload),
      )) {
        throw new Error("Canvas pending replay returned invalid data");
      }
      const authoritativeReplay = authoritativeCanvasDocument(
        replayed.body.authoritativeDocument,
      );
      if (replayed.body.authoritativeDocument !== undefined &&
          (!authoritativeReplay ||
            authoritativeReplay.revision !== replayed.body.revision ||
            authoritativeReplay.graphRevision !== replayed.body.graphRevision)) {
        throw new Error("Canvas pending replay returned an invalid authoritative document");
      }
      const replayedDocument = {
        currentWriterSequence: replaySequence,
        currentWriterSessionId: runtime.saveSessionId(),
        // Command replay applies only the recorded user intent. Its response
        // can also contain results published while the old page was closing.
        // Hydrating the old whole snapshot would turn those newer results into
        // apparent user deletions on the next save.
        edges: authoritativeReplay?.edges ?? pendingSnapshot.edges,
        graphRevision: replayed.body.graphRevision,
        loadToken: replayed.body.loadToken,
        nodes: authoritativeReplay?.nodes ?? pendingSnapshot.nodes,
        revision: replayed.body.revision,
        saveEpoch: fence.saveEpoch,
        sessionHighWaterAttemptId: replayAttemptId,
        sessionHighWaterSequence: replaySequence,
        viewport: authoritativeReplay?.viewport ?? pendingSnapshot.viewport,
      };
      if (!facade.isLoadedDocument(replayedDocument)) {
        throw new Error("Canvas pending replay returned invalid data");
      }
      runtime.setConfirmedSaveSequence(replaySequence);
      runtime.clearPendingPagehide();
      runtime.persistSaveSession(replayAttemptId);
      runtime.settleSentFingerprint(replaySequence, true);
      document = replayedDocument;
    } else if (runtime.saveSequence() > runtime.confirmedSaveSequence()) {
      throw new Error("Canvas has an unconfirmed save without a journal");
    } else {
      runtime.persistSaveSession();
    }

    if (!document) {
      const initialDocument = runtime.createInitialDocument?.();
      if (!initialDocument) return { kind: "missing" };
      const attemptId = runtime.randomUUID();
      const { payload, saveSequence } = runtime.reserveSaveAttempt(
        attemptId,
        (candidateSequence) => JSON.stringify({
          ...initialDocument,
          revision: 0,
          saveAttemptId: attemptId,
          saveSequence: candidateSequence,
          saveSessionId: runtime.saveSessionId(),
        }),
      );
      const initial = {
        currentWriterSequence: saveSequence,
        currentWriterSessionId: runtime.saveSessionId(),
        ...initialDocument,
        graphRevision: 0,
        loadToken: "",
        revision: 0,
        saveEpoch: fence.saveEpoch,
        sessionHighWaterAttemptId: attemptId,
        sessionHighWaterSequence: saveSequence,
      };
      runtime.rememberSentFingerprint(saveSequence, {
        attemptId,
        document: canvasUserDocumentFingerprint(initial),
        graph: canvasGraphFingerprint(initial),
        liveEditors: false,
      });
      const created = await putHydrationDocument(
        payload,
        "Canvas create response timed out",
      );
      if (!runtime.isCurrent()) return { kind: "cancelled" };
      if (!created.ok) {
        throw new Error(`Canvas create failed: ${created.status}`);
      }
      if (!facade.isSaveSuccess(created.body, facade.requestFence(payload))) {
        throw new Error("Canvas create returned invalid data");
      }
      const createdDocument = { ...initial, ...created.body };
      if (!facade.isLoadedDocument(createdDocument)) {
        throw new Error("Canvas create returned invalid data");
      }
      document = createdDocument;
      runtime.setConfirmedSaveSequence(saveSequence);
      runtime.persistSaveSession(attemptId);
      runtime.settleSentFingerprint(saveSequence, true);
    }

    if (!facade.isLoadedDocument(document)) {
      throw new Error("Canvas load returned an invalid document");
    }
    const externalRevision = runtime.externalRevision();
    if (externalRevision !== undefined && document.revision < externalRevision) {
      throw new Error("Canvas load returned a stale document");
    }
    const hydratedDocument = runtime.normalizeDocument(document);
    return {
      document: hydratedDocument,
      fingerprint: canvasUserDocumentFingerprint(hydratedDocument),
      graphFingerprint: canvasGraphFingerprint(hydratedDocument),
      graphRevision: document.graphRevision ?? document.revision,
      kind: "ready",
    };
  }
}

export interface CanvasPersistenceSaveCoordinatorInput {
  accountId?: string;
  canvasSnapshot(): CanvasPersistenceSnapshot;
  canvasSnapshotWithLiveEditors(): CanvasPersistenceSnapshot;
  drainPersistenceQueueRef: CanvasRef<() => void>;
  edges: CuttableEdge[];
  lastViewportInteractionAt: CanvasRef<number>;
  nodes: ProbeNodeType[];
  normalizeDocument(document: LoadedCanvasDocument): LoadedCanvasDocument;
  onProjectMissing?: () => void;
  onSaveConflict(message: string): void;
  onSaveFailure(message?: string): void;
  onSaveStart(): void;
  onSaveSuccess(): void;
  persistCanvasSaveSession(resolvedPendingAttemptId?: string): void;
  persistedDocumentFingerprint: CanvasRef<string>;
  persistedGraphFingerprint: CanvasRef<string>;
  persistenceBroadcastInstanceId: CanvasRef<string>;
  persistenceConfirmedSaveSequence: CanvasRef<number>;
  persistenceConflict: CanvasRef<boolean>;
  persistenceDirty: CanvasRef<boolean>;
  persistenceExternalRevision: CanvasRef<number | undefined>;
  persistenceFacade: CanvasPersistenceFacade;
  persistenceFixture: boolean;
  persistenceGraphRevision: CanvasRef<number>;
  persistenceId: string;
  persistenceInFlightFingerprint: CanvasRef<string | undefined>;
  persistenceLoadIdentity: CanvasRef<{ epoch: number; scopeId: string }>;
  persistenceObservedLoadToken: CanvasRef<string | undefined>;
  persistenceObservedRevision: CanvasRef<number | undefined>;
  persistencePendingAttempt: CanvasRef<CanvasPendingSaveAttempt | undefined>;
  persistencePendingPagehide: CanvasRef<CanvasPendingPagehide | undefined>;
  persistenceQueued: CanvasRef<CanvasPersistenceSnapshot | undefined>;
  persistenceReady: boolean;
  persistenceReadyRef: CanvasRef<boolean>;
  persistenceRecheckTick: number;
  persistenceRetryDelay: CanvasRef<number>;
  persistenceRevision: CanvasRef<number>;
  persistenceSaveController: CanvasRef<AbortController | undefined>;
  persistenceSaveRun: CanvasRef<number>;
  persistenceScheduledDocument: CanvasRef<CanvasPersistenceSnapshot | undefined>;
  persistenceSaveTimer: CanvasRef<number | undefined>;
  persistenceSaving: CanvasRef<boolean>;
  persistenceScopeId: string;
  persistenceSentFingerprints: CanvasRef<Map<number, CanvasSentFingerprint>>;
  persistenceServerEpoch: CanvasRef<string | undefined>;
  persistenceSessionId: CanvasRef<string>;
  raiseCanvasSaveSequenceFloor(candidate: number): void;
  rememberSentFingerprint(
    sequence: number,
    fingerprint: CanvasSentFingerprint,
  ): void;
  reserveCanvasSaveAttempt(
    attemptId: string,
    createPayload: (saveSequence: number) => string,
    requestedSequence?: number,
  ): { payload: string; saveSequence: number };
  setConfirmedGraphRevision(revision: number | undefined): void;
  setConfirmedPersistenceRevision(revision: number | undefined): void;
  setPersistenceLoadState(state: CanvasLoadState): void;
  settleCanvasSaveSequence(candidate: number, resolvedAttemptId?: string): void;
  settleSentFingerprint(sequence: number, confirmed: boolean): void;
  stopForCanvasSaveSessionStorage(): void;
  templateFitBlocksPersistence(): boolean;
  templateFitHardStop: CanvasRef<number | undefined>;
  templateViewportAnimating: CanvasRef<boolean>;
  viewport: Viewport;
}

export interface CanvasPersistenceLifecycleCoordinatorInput {
  accountId?: string;
  applyCanvasSaveSession(session: CanvasSaveSession): void;
  canvasSnapshotRef: CanvasRef<() => CanvasPersistenceSnapshot>;
  canvasSnapshotWithLiveEditors(): CanvasPersistenceSnapshot;
  drainPersistenceQueueRef: CanvasRef<() => void>;
  normalizeNodes(nodes: ProbeNodeType[]): ProbeNodeType[];
  onSaveSuccess(): void;
  pendingGuardedEdges: CanvasRef<CuttableEdge[] | undefined>;
  pendingGuardedNodes: CanvasRef<ProbeNodeType[] | undefined>;
  persistedDocumentFingerprint: CanvasRef<string>;
  persistedGraphFingerprint: CanvasRef<string>;
  persistenceBfCacheReloadSafe: CanvasRef<boolean>;
  persistenceBroadcastInstanceId: CanvasRef<string>;
  persistenceConfirmedSaveSequence: CanvasRef<number>;
  persistenceConflict: CanvasRef<boolean>;
  persistenceDirty: CanvasRef<boolean>;
  persistenceExternalRevision: CanvasRef<number | undefined>;
  persistenceFacade: CanvasPersistenceFacade;
  persistenceFixture: boolean;
  persistenceGraphRevision: CanvasRef<number>;
  persistenceId: string;
  persistenceLoadIdentity: CanvasRef<{ epoch: number; scopeId: string }>;
  persistenceObservedLoadToken: CanvasRef<string | undefined>;
  persistenceObservedRevision: CanvasRef<number | undefined>;
  persistencePendingAttempt: CanvasRef<CanvasPendingSaveAttempt | undefined>;
  persistencePendingPagehide: CanvasRef<CanvasPendingPagehide | undefined>;
  persistenceQueued: CanvasRef<CanvasPersistenceSnapshot | undefined>;
  persistenceReady: boolean;
  persistenceReadyRef: CanvasRef<boolean>;
  persistenceRetryDelay: CanvasRef<number>;
  persistenceRevision: CanvasRef<number>;
  persistenceScheduledDocument: CanvasRef<CanvasPersistenceSnapshot | undefined>;
  persistenceSaveTimer: CanvasRef<number | undefined>;
  persistenceSaving: CanvasRef<boolean>;
  persistenceScopeId: string;
  persistenceSessionId: CanvasRef<string>;
  persistenceStorageRevision: CanvasRef<number>;
  pruneSentFingerprints(): void;
  rememberSentFingerprint(
    sequence: number,
    fingerprint: CanvasSentFingerprint,
  ): void;
  reserveCanvasSaveAttempt(
    attemptId: string,
    createPayload: (saveSequence: number) => string,
  ): { payload: string; saveSequence: number };
  setConfirmedGraphRevision(revision: number | undefined): void;
  setConfirmedPersistenceRevision(revision: number | undefined): void;
  setPersistenceLoadState(state: CanvasLoadState): void;
  settleSentFingerprint(sequence: number, confirmed: boolean): void;
  stopForCanvasSaveSessionStorage(): void;
}

export function createCanvasPersistenceFacade(input: {
  journal: CanvasSaveJournalPort;
  transport: CanvasPersistenceTransport;
}): CanvasPersistenceFacade {
  return {
    bindBeforeUnload(hasPendingChanges) {
      const warn = (event: BeforeUnloadEvent) => {
        if (!hasPendingChanges()) return;
        event.preventDefault();
        event.returnValue = "";
      };
      window.addEventListener("beforeunload", warn);
      return () => window.removeEventListener("beforeunload", warn);
    },
    bindPagehide(flush) {
      window.addEventListener("pagehide", flush);
      return () => window.removeEventListener("pagehide", flush);
    },
    bindPersistedPageRestore(shouldReload) {
      const restore = (event: PageTransitionEvent) => {
        if (event.persisted && shouldReload()) window.location.reload();
      };
      window.addEventListener("pageshow", restore);
      return () => window.removeEventListener("pageshow", restore);
    },
    broadcastSaved(accountId, canvasId, revision, instanceId) {
      const channel = syncChannel(accountId, canvasId);
      if (!channel) return;
      channel.postMessage({ canvasId, instanceId, revision, type: "saved" });
      channel.close();
    },
    canSendPagehide: canSendCanvasPagehidePayload,
    classifyLoadFailure: canvasLoadFailure,
    createSyncChannel: syncChannel,
    isLoadedDocument: isLoadedCanvasDocument,
    isSaveFence: isCanvasSaveFence,
    isSaveSuccess: isCanvasSaveSuccess,
    journal: input.journal,
    nextRetryDelay: nextCanvasPersistenceRetryDelay,
    pendingSnapshot: pendingPagehideSnapshot,
    requestFence: canvasSaveRequestFence,
    subscribeSaved({ accountId, canvasId, instanceId, onRevision }) {
      const channel = syncChannel(accountId, canvasId);
      if (!channel) return () => undefined;
      const receive = (event: MessageEvent) => {
        const data = event.data as {
          canvasId?: unknown;
          instanceId?: unknown;
          revision?: unknown;
          type?: unknown;
        } | undefined;
        if (!data || data.type !== "saved" || data.canvasId !== canvasId ||
          data.instanceId === instanceId ||
          !Number.isSafeInteger(data.revision) || Number(data.revision) < 0) {
          return;
        }
        onRevision(Number(data.revision));
      };
      channel.addEventListener("message", receive);
      return () => {
        channel.removeEventListener("message", receive);
        channel.close();
      };
    },
    transport: input.transport,
  };
}

export function useCanvasPersistenceSaveCoordinator(
  input: CanvasPersistenceSaveCoordinatorInput,
) {
  const {
    accountId,
    canvasSnapshot,
    canvasSnapshotWithLiveEditors,
    drainPersistenceQueueRef,
    edges,
    lastViewportInteractionAt,
    nodes,
    normalizeDocument,
    onProjectMissing,
    onSaveConflict,
    onSaveFailure,
    onSaveStart,
    onSaveSuccess,
    persistCanvasSaveSession,
    persistedDocumentFingerprint,
    persistedGraphFingerprint,
    persistenceBroadcastInstanceId,
    persistenceConfirmedSaveSequence,
    persistenceConflict,
    persistenceDirty,
    persistenceExternalRevision,
    persistenceFacade,
    persistenceFixture,
    persistenceGraphRevision,
    persistenceId,
    persistenceInFlightFingerprint,
    persistenceLoadIdentity,
    persistenceObservedLoadToken,
    persistenceObservedRevision,
    persistencePendingAttempt,
    persistencePendingPagehide,
    persistenceQueued,
    persistenceReady,
    persistenceReadyRef,
    persistenceRecheckTick,
    persistenceRetryDelay,
    persistenceRevision,
    persistenceSaveController,
    persistenceSaveRun,
    persistenceScheduledDocument,
    persistenceSaveTimer,
    persistenceSaving,
    persistenceScopeId,
    persistenceSentFingerprints,
    persistenceServerEpoch,
    persistenceSessionId,
    raiseCanvasSaveSequenceFloor,
    rememberSentFingerprint,
    reserveCanvasSaveAttempt,
    setConfirmedGraphRevision,
    setConfirmedPersistenceRevision,
    setPersistenceLoadState,
    settleCanvasSaveSequence,
    settleSentFingerprint,
    stopForCanvasSaveSessionStorage,
    templateFitBlocksPersistence,
    templateFitHardStop,
    templateViewportAnimating,
    viewport,
  } = input;
  useEffect(() => {
    if (!persistenceFixture || !persistenceReady) {
      return;
    }
    const saveEpoch = persistenceLoadIdentity.current.epoch;
    const isCurrentCanvas = () =>
      persistenceLoadIdentity.current.scopeId === persistenceScopeId &&
      persistenceLoadIdentity.current.epoch === saveEpoch;
    const canvasMatchesPersistedDocument = (useLiveEditors = false) => {
      const latest = useLiveEditors
        ? canvasSnapshotWithLiveEditors()
        : canvasSnapshot();
      return latest.fingerprint === persistedDocumentFingerprint.current &&
        latest.graphFingerprint === persistedGraphFingerprint.current;
    };
    if (persistenceConflict.current) {
      const latest = canvasSnapshot();
      if (
        latest.fingerprint !== persistedDocumentFingerprint.current ||
        latest.graphFingerprint !== persistedGraphFingerprint.current
      ) {
        persistenceQueued.current = latest;
        persistenceDirty.current = true;
      }
      return;
    }
    if (templateFitBlocksPersistence()) {
      // 镜头动画期间不触发保存调度，动画结束提交最终镜头时只保存一次；
      // 若 rAF 被节流/暂停导致动画迟迟不结束，超过硬性期限后放行保存，避免“保存中”卡死。
      return;
    }
    if (templateViewportAnimating.current) {
      templateViewportAnimating.current = false;
      templateFitHardStop.current = undefined;
    }

    // 交互安静期：拖动/缩放/平移期间跳过指纹与保存调度，
    // 停手 ≥250ms 后由 persistenceRecheckTick 重新触发本 effect。
    if (
      lastViewportInteractionAt.current > 0 &&
      performance.now() - lastViewportInteractionAt.current < VIEWPORT_QUIET_MS
    ) {
      window.clearTimeout(persistenceSaveTimer.current);
      persistenceSaveTimer.current = undefined;
      persistenceScheduledDocument.current = undefined;
      return;
    }
    const liveDocument = canvasSnapshot();
    const confirmed =
      liveDocument.fingerprint === persistedDocumentFingerprint.current &&
      liveDocument.graphFingerprint === persistedGraphFingerprint.current;
    const inFlightAttempt = persistencePendingAttempt.current;
    const coveredByInFlightSave =
      persistenceSaving.current &&
      liveDocument.fingerprint === persistenceInFlightFingerprint.current &&
      inFlightAttempt?.document.graphFingerprint === liveDocument.graphFingerprint;

    const scheduledDocument = persistenceScheduledDocument.current;
    const durableScheduleUnchanged =
      !persistenceSaving.current &&
      persistenceSaveTimer.current !== undefined &&
      scheduledDocument?.fingerprint === liveDocument.fingerprint &&
      scheduledDocument.graphFingerprint === liveDocument.graphFingerprint;
    if (durableScheduleUnchanged) {
      // React Flow may keep publishing passive measurements while media nodes
      // mount. Those view-only updates must not postpone an already scheduled
      // durable save forever.
      return;
    }

    window.clearTimeout(persistenceSaveTimer.current);
    persistenceSaveTimer.current = undefined;
    persistenceScheduledDocument.current = undefined;
    if (coveredByInFlightSave) {
      persistenceQueued.current = undefined;
      persistenceDirty.current = true;
      return;
    }
    if (confirmed && !persistenceSaving.current) {
      persistenceQueued.current = undefined;
      if (persistenceDirty.current) onSaveSuccess();
      persistenceDirty.current = false;
      return;
    }

    if (!persistenceDirty.current) onSaveStart();
    persistenceDirty.current = true;

    const drainPersistenceQueue = async () => {
      if (templateFitBlocksPersistence()) {
        persistenceDirty.current = true;
        return;
      }
      if (persistenceSaving.current || persistenceConflict.current) return;
      if (
        persistenceObservedRevision.current === undefined ||
        !isCanvasLoadToken(persistenceObservedLoadToken.current)
      ) {
        persistenceQueued.current = canvasSnapshot();
        persistenceDirty.current = true;
        persistenceConflict.current = true;
        setConfirmedPersistenceRevision(undefined);
        setConfirmedGraphRevision(undefined);
        onSaveConflict("画布加载基线无效，已保留当前草稿，请刷新后重试");
        return;
      }
      const saveRun = ++persistenceSaveRun.current;
      persistenceSaving.current = true;
      let failed = false;
      let failureNotified = false;
      let externalReloadRequired = false;
      let successfulSnapshotUsesLiveEditors = false;
      const reserveExternalDraft = (
        document: CanvasPersistenceSnapshot,
        liveEditors: boolean,
        readyToSend: boolean,
      ) => {
        const observedRevision = persistenceObservedRevision.current;
        const observedLoadToken = persistenceObservedLoadToken.current;
        if (
          observedRevision === undefined ||
          observedRevision !== persistenceRevision.current ||
          !isCanvasLoadToken(observedLoadToken)
        ) {
          throw new CanvasSaveSessionStorageError(
            new Error("Canvas external draft has no valid load fence"),
          );
        }
        const previousAttempt = persistencePendingAttempt.current;
        const attemptId = crypto.randomUUID();
        const { payload, saveSequence } = reserveCanvasSaveAttempt(
          attemptId,
          (candidateSequence) => JSON.stringify({
            edges: document.edges,
            nodes: document.nodes,
            observedLoadToken,
            observedRevision,
            revision: observedRevision,
            saveAttemptId: attemptId,
            saveSequence: candidateSequence,
            saveSessionId: persistenceSessionId.current,
            viewport: document.viewport,
          }),
        );
        const attempt = { attemptId, document, payload, saveSequence };
        persistencePendingAttempt.current = attempt;
        persistenceQueued.current = undefined;
        persistenceDirty.current = true;
        if (readyToSend) {
          rememberSentFingerprint(saveSequence, {
            attemptId,
            document: document.fingerprint,
            graph: document.graphFingerprint,
            liveEditors,
          });
        }
        if (
          previousAttempt &&
          previousAttempt.saveSequence !== saveSequence
        ) {
          settleSentFingerprint(previousAttempt.saveSequence, false);
        }
        return attempt;
      };
      const loadExternalBaseline = async (
        draft?: CanvasPersistenceSnapshot,
        draftUsesLiveEditors = false,
      ) => {
        if (draft) {
          try {
            // The old fence is still authoritative at this point. Reserve the
            // complete local draft before making it temporarily inaccessible
            // during the external GET. A failed GET can then be recovered by
            // the normal hydration journal replay after retry/refresh.
            reserveExternalDraft(draft, draftUsesLiveEditors, false);
          } catch (error) {
            if (!(error instanceof CanvasSaveSessionStorageError)) throw error;
            failed = true;
            persistenceReadyRef.current = false;
            setPersistenceLoadState("failed");
            stopForCanvasSaveSessionStorage();
            return false;
          }
        }
        persistenceReadyRef.current = false;
        setConfirmedPersistenceRevision(undefined);
        setConfirmedGraphRevision(undefined);
        setPersistenceLoadState("loading");
        const baselineController = new AbortController();
        persistenceSaveController.current = baselineController;
        try {
          const response = await loadCanvasPersistenceWithDeadline({
            canvasId: persistenceId,
            controller: baselineController,
            saveSessionId: persistenceSessionId.current,
            timeoutReason: "canvas-external-baseline-timeout",
            transport: persistenceFacade.transport,
          });
          const baseline = response.body;
          if (
            !isCurrentCanvas() ||
            persistenceSaveRun.current !== saveRun
          ) return false;
          if (!response.ok) {
            throw new Error(`Canvas external baseline failed: ${response.status}`);
          }
          if (!persistenceFacade.isLoadedDocument(baseline)) {
            throw new Error("Canvas external baseline is invalid");
          }
          if (
            persistenceExternalRevision.current !== undefined &&
            baseline.revision < persistenceExternalRevision.current
          ) {
            throw new Error("Canvas external baseline is stale");
          }
          const hydratedBaseline = normalizeDocument(baseline);
          const graphRevision = baseline.graphRevision ?? baseline.revision;
          persistenceRevision.current = baseline.revision;
          persistenceGraphRevision.current = graphRevision;
          persistenceObservedRevision.current = baseline.revision;
          persistenceObservedLoadToken.current = baseline.loadToken;
          persistenceServerEpoch.current = baseline.saveEpoch;
          raiseCanvasSaveSequenceFloor(baseline.sessionHighWaterSequence);
          if (draft) {
            // Replace the pre-GET journal in one strict-CAS write. The new
            // attempt carries the freshly observed revision/token, so the
            // queued local draft can never be sent against the stale fence.
            reserveExternalDraft(draft, draftUsesLiveEditors, true);
          } else {
            persistCanvasSaveSession();
          }
          persistedDocumentFingerprint.current =
            canvasUserDocumentFingerprint(hydratedBaseline);
          persistedGraphFingerprint.current =
            canvasGraphFingerprint(hydratedBaseline);
          setConfirmedPersistenceRevision(baseline.revision);
          setConfirmedGraphRevision(graphRevision);
          if (
            persistenceExternalRevision.current !== undefined &&
            persistenceExternalRevision.current <= baseline.revision
          ) {
            persistenceExternalRevision.current = undefined;
          }
          persistenceReadyRef.current = true;
          setPersistenceLoadState("ready");
          return true;
        } catch (error) {
          if (
            !isCurrentCanvas() ||
            persistenceSaveRun.current !== saveRun
          ) return false;
          failed = true;
          persistenceConflict.current = true;
          persistenceObservedRevision.current = undefined;
          persistenceObservedLoadToken.current = undefined;
          setConfirmedPersistenceRevision(undefined);
          setConfirmedGraphRevision(undefined);
          persistenceReadyRef.current = false;
          setPersistenceLoadState("failed");
          if (error instanceof CanvasSaveSessionStorageError) {
            stopForCanvasSaveSessionStorage();
          } else {
            onSaveConflict(
              "检测到其他页面的新版本，但无法安全读取；已保留当前草稿，请刷新后重试",
            );
          }
          return false;
        } finally {
          if (persistenceSaveController.current === baselineController) {
            persistenceSaveController.current = undefined;
          }
        }
      };
      const reconcileExternalBaseline = async () => {
        const externalRevision = persistenceExternalRevision.current;
        if (
          externalRevision === undefined ||
          externalRevision <= (persistenceObservedRevision.current ?? -1)
        ) {
          return true;
        }

        const latestDraft = canvasSnapshot();
        const pendingAttempt = persistencePendingAttempt.current;
        const comparisonFingerprint = pendingAttempt
          ? pendingAttempt.document.fingerprint
          : persistedDocumentFingerprint.current;
        const comparisonGraphFingerprint = pendingAttempt
          ? pendingAttempt.document.graphFingerprint
          : persistedGraphFingerprint.current;
        if (
          latestDraft.fingerprint === comparisonFingerprint &&
          latestDraft.graphFingerprint === comparisonGraphFingerprint
        ) {
          if (pendingAttempt && !pendingAttempt.rejectedByServer) {
            failed = true;
            persistenceConflict.current = true;
            persistenceQueued.current = latestDraft;
            persistenceDirty.current = true;
            onSaveConflict(
              "保存结果尚未确认，已保留当前草稿，请刷新后重试",
            );
            return false;
          }
          if (pendingAttempt) {
            try {
              settleCanvasSaveSequence(
                pendingAttempt.saveSequence,
                pendingAttempt.attemptId,
              );
            } catch (error) {
              if (!(error instanceof CanvasSaveSessionStorageError)) {
                throw error;
              }
              failed = true;
              stopForCanvasSaveSessionStorage();
              return false;
            }
          }
          persistencePendingAttempt.current = undefined;
          persistenceQueued.current = undefined;
          persistenceDirty.current = false;
          externalReloadRequired = true;
          return false;
        }

        persistencePendingAttempt.current = undefined;
        persistenceQueued.current = latestDraft;
        persistenceDirty.current = true;
        return loadExternalBaseline(latestDraft);
      };
      try {
        while (
          (persistencePendingAttempt.current || persistenceQueued.current) &&
          !persistenceConflict.current
        ) {
          if (!isCurrentCanvas()) break;
          if (
            persistenceExternalRevision.current !== undefined &&
            persistenceExternalRevision.current >
              (persistenceObservedRevision.current ?? -1) &&
            !(await reconcileExternalBaseline())
          ) {
            break;
          }
          if (templateFitBlocksPersistence()) {
            persistenceDirty.current = true;
            break;
          }
          let attempt = persistencePendingAttempt.current;
          if (!attempt) {
            const document = persistenceQueued.current;
            if (!document) break;
            persistenceQueued.current = undefined;
            const attemptId = crypto.randomUUID();
            let reserved: { payload: string; saveSequence: number };
            try {
              reserved = reserveCanvasSaveAttempt(
                attemptId,
                (saveSequence) => JSON.stringify({
                  edges: document.edges,
                  nodes: document.nodes,
                  observedRevision: persistenceObservedRevision.current,
                  observedLoadToken: persistenceObservedLoadToken.current,
                  revision: persistenceRevision.current,
                  saveAttemptId: attemptId,
                  saveSequence,
                  saveSessionId: persistenceSessionId.current,
                  viewport: document.viewport,
                }),
              );
            } catch (error) {
              if (!(error instanceof CanvasSaveSessionStorageError)) throw error;
              failed = true;
              stopForCanvasSaveSessionStorage();
              break;
            }
            const { payload, saveSequence } = reserved;
            attempt = { attemptId, document, payload, saveSequence };
            persistencePendingAttempt.current = attempt;
            rememberSentFingerprint(saveSequence, {
              attemptId,
              document: document.fingerprint,
              graph: document.graphFingerprint,
              liveEditors: false,
            });
          }
          const { attemptId, document, payload, saveSequence } = attempt;
          persistenceInFlightFingerprint.current = document.fingerprint;
          const saveController = new AbortController();
          persistenceSaveController.current = saveController;
          let saveTimeout: number | undefined;
          let response: { ok: boolean; status: number };
          let responseBody: unknown = {};
          try {
            const result = await Promise.race([
              (async () => {
                const fetched = await persistenceFacade.transport.put({
                  canvasId: persistenceId,
                  payload,
                  responseMode: "lenient-text",
                  signal: saveController.signal,
                });
                return { body: fetched.body, response: fetched };
              })(),
              new Promise<never>((_resolve, reject) => {
                saveTimeout = window.setTimeout(() => {
                  saveController.abort("canvas-save-timeout");
                  reject(new Error("Canvas save response timed out"));
                }, PERSIST_SAVE_TIMEOUT_MS);
              }),
            ]);
            response = result.response;
            responseBody = result.body;
          } finally {
            window.clearTimeout(saveTimeout);
            if (persistenceSaveController.current === saveController) {
              persistenceSaveController.current = undefined;
            }
          }
          if (!isCurrentCanvas()) return;
          const sentFingerprint =
            persistenceSentFingerprints.current.get(saveSequence);
          const attemptUsesLiveEditors =
            sentFingerprint?.attemptId === attemptId &&
            sentFingerprint.liveEditors;
          if (!response.ok) attempt.rejectedByServer = true;
          if (response.status === 409) {
            persistencePendingAttempt.current = undefined;
            const parsedConflict = responseBody;
            const conflict: {
              code?: string;
              currentGraphRevision?: number;
              currentRevision?: number;
              currentWriterSequence?: number;
              currentWriterSessionId?: string | null;
              error?: string;
              rejectedAttemptId?: string | null;
              rejectedSequence?: number;
              rejectedSessionId?: string;
              sessionHighWaterAttemptId?: string | null;
              sessionHighWaterSequence?: number;
            } = parsedConflict && typeof parsedConflict === "object"
              ? parsedConflict as {
                  code?: string;
                  currentGraphRevision?: number;
                  currentRevision?: number;
                  currentWriterSequence?: number;
                  currentWriterSessionId?: string | null;
                  error?: string;
                  rejectedAttemptId?: string | null;
                  rejectedSequence?: number;
                  rejectedSessionId?: string;
                  sessionHighWaterAttemptId?: string | null;
                  sessionHighWaterSequence?: number;
                }
              : {};
            const validSupersededEnvelope =
              conflict.code === "CANVAS_SAVE_SUPERSEDED" &&
              conflict.rejectedSessionId === persistenceSessionId.current &&
              conflict.rejectedSequence === saveSequence &&
              conflict.rejectedAttemptId === attemptId &&
              Number.isSafeInteger(conflict.sessionHighWaterSequence) &&
              Number(conflict.sessionHighWaterSequence) >= saveSequence &&
              (conflict.sessionHighWaterAttemptId === null ||
                isCanvasSaveAttemptId(conflict.sessionHighWaterAttemptId)) &&
              (conflict.currentWriterSessionId === null ||
                typeof conflict.currentWriterSessionId === "string") &&
              Number.isSafeInteger(conflict.currentWriterSequence) &&
              Number(conflict.currentWriterSequence) >= 0 &&
              Number.isSafeInteger(conflict.currentRevision) &&
              Number(conflict.currentRevision) >= 0 &&
              Number.isSafeInteger(conflict.currentGraphRevision) &&
              Number(conflict.currentGraphRevision) >= 0 &&
              Number(conflict.currentGraphRevision) <=
                Number(conflict.currentRevision);
            const highWaterSequence = Number(
              conflict.sessionHighWaterSequence,
            );
            const mappedHighWaterFingerprint = validSupersededEnvelope
              ? persistenceSentFingerprints.current.get(highWaterSequence)
              : undefined;
            const highWaterFingerprint =
              mappedHighWaterFingerprint?.attemptId ===
                  conflict.sessionHighWaterAttemptId
                ? mappedHighWaterFingerprint
                : undefined;
            const currentWriterIsThisTab =
              validSupersededEnvelope &&
              conflict.currentWriterSessionId === persistenceSessionId.current;
            const canBindThisTabWriter =
              currentWriterIsThisTab &&
              conflict.currentWriterSequence === highWaterSequence &&
              Boolean(highWaterFingerprint);

            if (validSupersededEnvelope && highWaterFingerprint) {
              try {
                const durableAttemptId =
                  persistencePendingPagehide.current?.attemptId;
                const resolvedAttemptId =
                  durableAttemptId === conflict.sessionHighWaterAttemptId
                    ? conflict.sessionHighWaterAttemptId ?? undefined
                    : durableAttemptId === attemptId
                      ? attemptId
                      : undefined;
                settleCanvasSaveSequence(
                  highWaterSequence,
                  resolvedAttemptId,
                );
              } catch (error) {
                if (!(error instanceof CanvasSaveSessionStorageError)) {
                  throw error;
                }
                failed = true;
                stopForCanvasSaveSessionStorage();
                break;
              }
              settleSentFingerprint(highWaterSequence, true);
              if (saveSequence !== highWaterSequence) {
                settleSentFingerprint(saveSequence, false);
              }
            } else {
              settleSentFingerprint(saveSequence, false);
            }

            if (canBindThisTabWriter && highWaterFingerprint) {
              const latest = highWaterFingerprint.liveEditors
                ? canvasSnapshotWithLiveEditors()
                : canvasSnapshot();
              persistenceExternalRevision.current = Math.max(
                persistenceExternalRevision.current ?? 0,
                Number(conflict.currentRevision),
              );
              const localDraft =
                latest.fingerprint === highWaterFingerprint.document &&
                  latest.graphFingerprint === highWaterFingerprint.graph
                  ? undefined
                  : latest;
              if (!(await loadExternalBaseline(
                localDraft,
                highWaterFingerprint.liveEditors,
              ))) break;
              const serverMatchesHighWater =
                persistedDocumentFingerprint.current ===
                  highWaterFingerprint.document &&
                persistedGraphFingerprint.current === highWaterFingerprint.graph;
              if (
                serverMatchesHighWater &&
                latest.fingerprint === highWaterFingerprint.document &&
                latest.graphFingerprint === highWaterFingerprint.graph
              ) {
                persistenceQueued.current = undefined;
                persistenceDirty.current = false;
              } else {
                persistenceQueued.current = latest;
                persistenceDirty.current = true;
              }
            } else if (
              validSupersededEnvelope &&
              !currentWriterIsThisTab &&
              highWaterFingerprint
            ) {
              const latest = highWaterFingerprint.liveEditors
                ? canvasSnapshotWithLiveEditors()
                : canvasSnapshot();
              persistenceExternalRevision.current = Math.max(
                persistenceExternalRevision.current ?? 0,
                Number(conflict.currentRevision),
              );
              if (
                latest.fingerprint === highWaterFingerprint.document &&
                latest.graphFingerprint === highWaterFingerprint.graph
              ) {
                persistenceRevision.current = Number(conflict.currentRevision);
                persistenceGraphRevision.current = Number(
                  conflict.currentGraphRevision,
                );
                persistenceObservedRevision.current = undefined;
                persistenceObservedLoadToken.current = undefined;
                setConfirmedPersistenceRevision(undefined);
                setConfirmedGraphRevision(undefined);
                persistenceQueued.current = undefined;
                persistenceDirty.current = false;
                externalReloadRequired = true;
              } else {
                // Keep the still-valid old fence long enough to durably reserve
                // the newer local draft. loadExternalBaseline atomically rebases
                // that journal onto the foreign writer's authoritative GET.
                if (!(await loadExternalBaseline(
                  latest,
                  highWaterFingerprint.liveEditors,
                ))) break;
                persistenceQueued.current = latest;
                persistenceDirty.current = true;
              }
            } else if (
              validSupersededEnvelope &&
              isCanvasSaveAttemptId(conflict.sessionHighWaterAttemptId)
            ) {
              try {
                raiseCanvasSaveSequenceFloor(highWaterSequence);
              } catch (error) {
                if (!(error instanceof CanvasSaveSessionStorageError)) {
                  throw error;
                }
                failed = true;
                stopForCanvasSaveSessionStorage();
                break;
              }
              const latest = canvasSnapshot();
              persistenceExternalRevision.current = Math.max(
                persistenceExternalRevision.current ?? 0,
                Number(conflict.currentRevision),
              );
              if (!(await loadExternalBaseline(latest))) break;
              persistenceQueued.current = latest;
              persistenceDirty.current = true;
            } else {
              failed = true;
              persistenceConflict.current = true;
              setConfirmedPersistenceRevision(undefined);
              setConfirmedGraphRevision(undefined);
              persistenceQueued.current = canvasSnapshot();
              persistenceDirty.current = true;
              const projectUnavailable =
                conflict.code === "CANVAS_PROJECT_DELETED" ||
                conflict.code === "CANVAS_PROJECT_NOT_OWNED";
              if (projectUnavailable) {
                persistenceReadyRef.current = false;
                persistenceObservedRevision.current = undefined;
                persistenceObservedLoadToken.current = undefined;
                setPersistenceLoadState("missing");
                onProjectMissing?.();
              }
              const fallback = conflict.code === "CANVAS_LOAD_REQUIRED"
                ? "画布加载基线已失效，已保留当前草稿，请刷新后重试"
                : projectUnavailable
                  ? "项目已不存在或不属于当前账号，当前草稿未被覆盖"
                  : "保存响应无法安全确认，已保留当前草稿，请刷新后重试";
              onSaveConflict(conflict.error?.trim() || fallback);
              break;
            }
          } else if (response.status === 503) {
            const parsedUnavailable = responseBody;
            const unavailable: { code?: string; error?: string } =
              parsedUnavailable && typeof parsedUnavailable === "object"
              ? parsedUnavailable as { code?: string; error?: string }
              : {};
            if (unavailable.code === "CANVAS_SAVE_SESSION_CAPACITY") {
              persistencePendingAttempt.current = undefined;
              settleSentFingerprint(saveSequence, false);
              failed = true;
              persistenceConflict.current = true;
              setConfirmedPersistenceRevision(undefined);
              setConfirmedGraphRevision(undefined);
              persistenceQueued.current = canvasSnapshot();
              persistenceDirty.current = true;
              onSaveConflict(
                unavailable.error?.trim() ||
                  "当前画布保存会话过多，已保留草稿，请刷新后重试",
              );
              break;
            }
            failed = true;
            if (!failureNotified) {
              failureNotified = true;
              onSaveConflict("保存失败，请检查网络，正在自动重试");
            }
            persistenceQueued.current = canvasSnapshot();
            break;
          } else if (
            response.status === 408 ||
            response.status === 425 ||
            response.status === 429 ||
            response.status >= 500
          ) {
            failed = true;
            if (!failureNotified) {
              failureNotified = true;
              onSaveConflict("保存失败，请检查网络，正在自动重试");
            }
            persistenceQueued.current = canvasSnapshot();
            break;
          } else if (!response.ok) {
            const parsedRejection = responseBody;
            const rejected: { error?: string } =
              parsedRejection && typeof parsedRejection === "object"
              ? parsedRejection as { error?: string }
              : {};
            persistencePendingAttempt.current = undefined;
            settleSentFingerprint(saveSequence, false);
            failed = true;
            persistenceConflict.current = true;
            setConfirmedPersistenceRevision(undefined);
            setConfirmedGraphRevision(undefined);
            persistenceQueued.current = canvasSnapshot();
            persistenceDirty.current = true;
            onSaveConflict(
              rejected.error?.trim() ||
                `保存请求被拒绝（${response.status}），已保留当前草稿，请刷新后重试`,
            );
            break;
          } else {
            const requestFence = persistenceFacade.requestFence(payload);
            const saveResult = responseBody;
            if (
              !persistenceFacade.isSaveSuccess(saveResult, requestFence)
            ) {
              throw new Error("Canvas save returned an invalid revision");
            }
            const { graphRevision, loadToken, revision } = saveResult;
            if (
              saveSequence <= persistenceConfirmedSaveSequence.current
            ) {
              settleSentFingerprint(saveSequence, false);
              if (
                revision > persistenceRevision.current ||
                (revision === persistenceRevision.current &&
                  (graphRevision !== persistenceGraphRevision.current ||
                    loadToken !== persistenceObservedLoadToken.current))
              ) {
                failed = true;
                persistenceConflict.current = true;
                persistenceQueued.current = canvasSnapshot();
                persistenceDirty.current = true;
                setConfirmedPersistenceRevision(undefined);
                setConfirmedGraphRevision(undefined);
                onSaveConflict(
                  "保存响应顺序异常，已保留当前草稿，请刷新后重试",
                );
                break;
              }
              persistencePendingAttempt.current = undefined;
            } else {
              persistencePendingAttempt.current = undefined;
              persistenceRevision.current = revision;
              persistenceGraphRevision.current = graphRevision;
              persistenceObservedRevision.current = revision;
              persistenceObservedLoadToken.current = loadToken;
              persistenceConfirmedSaveSequence.current = Math.max(
                persistenceConfirmedSaveSequence.current,
                saveSequence,
              );
              const pendingPagehide = persistencePendingPagehide.current;
              if (pendingPagehide?.attemptId === attemptId &&
                pendingPagehide.saveSequence <= saveSequence) {
                persistencePendingPagehide.current = undefined;
              }
              persistCanvasSaveSession(attemptId);
              settleSentFingerprint(saveSequence, true);
              if (
                persistenceExternalRevision.current !== undefined &&
                persistenceExternalRevision.current <= revision
              ) {
                persistenceExternalRevision.current = undefined;
              }
              persistenceRetryDelay.current = 1_000;
              setConfirmedPersistenceRevision(revision);
              setConfirmedGraphRevision(graphRevision);
              persistenceFacade.broadcastSaved(
                accountId ?? "",
                persistenceId,
                revision,
                persistenceBroadcastInstanceId.current,
              );
              persistedDocumentFingerprint.current = document.fingerprint;
              persistedGraphFingerprint.current = document.graphFingerprint;
              successfulSnapshotUsesLiveEditors = attemptUsesLiveEditors;
            }
          }

          if (externalReloadRequired) break;
          const latest = attemptUsesLiveEditors
            ? canvasSnapshotWithLiveEditors()
            : canvasSnapshot();
          if (
            persistenceExternalRevision.current !== undefined &&
            persistenceExternalRevision.current > persistenceRevision.current &&
            latest.fingerprint === persistedDocumentFingerprint.current &&
            latest.graphFingerprint === persistedGraphFingerprint.current
          ) {
            persistenceQueued.current = undefined;
            persistenceDirty.current = false;
            externalReloadRequired = true;
            break;
          }
          if (
            latest.fingerprint !== persistedDocumentFingerprint.current ||
            latest.graphFingerprint !== persistedGraphFingerprint.current
          ) {
            persistenceQueued.current = latest;
            persistenceDirty.current = true;
          } else {
            persistenceQueued.current = undefined;
            persistenceDirty.current = false;
          }
        }
      } catch (error) {
        if (!isCurrentCanvas()) return;
        if (error instanceof CanvasSaveSessionStorageError) {
          failed = true;
          stopForCanvasSaveSessionStorage();
          return;
        }
        failed = true;
        persistenceQueued.current = canvasSnapshot();
        if (!failureNotified) {
          failureNotified = true;
          onSaveConflict("保存失败，请检查网络，正在自动重试");
        }
      } finally {
        if (persistenceSaveRun.current !== saveRun) return;
        persistenceInFlightFingerprint.current = undefined;
        persistenceSaving.current = false;
        if (!isCurrentCanvas()) {
          if (
            persistenceReadyRef.current &&
            !persistenceConflict.current &&
            persistenceQueued.current
          ) {
            queueMicrotask(() => drainPersistenceQueueRef.current());
          }
          return;
        }
        drainPersistenceQueueRef.current = drainPersistenceQueue;
        if (
          !failed &&
          !persistenceConflict.current &&
          externalReloadRequired &&
          !persistenceQueued.current
        ) {
          persistenceDirty.current = false;
          persistenceReadyRef.current = false;
          setPersistenceLoadState("loading");
          window.location.reload();
        } else if (
          !failed &&
          !persistenceConflict.current &&
          persistenceQueued.current
        ) {
          void drainPersistenceQueue();
        } else if (
          !failed &&
          !persistenceConflict.current &&
          canvasMatchesPersistedDocument(successfulSnapshotUsesLiveEditors)
        ) {
          // A local commit can render while the same document is already in
          // flight (notably a live drag rebased after a superseded save). Its
          // render effect may have installed a debounce timer before the
          // response advanced the persisted fingerprint. Once convergence is
          // proven that timer is stale and must not emit a duplicate command.
          window.clearTimeout(persistenceSaveTimer.current);
          persistenceSaveTimer.current = undefined;
          persistenceScheduledDocument.current = undefined;
          persistenceDirty.current = false;
          onSaveSuccess();
        } else if (failed && !persistenceConflict.current) {
          persistenceDirty.current = true;
          onSaveFailure("保存失败，请检查网络，正在自动重试");
          window.clearTimeout(persistenceSaveTimer.current);
          persistenceSaveTimer.current = undefined;
          persistenceScheduledDocument.current = undefined;
          if (
            persistenceExternalRevision.current !== undefined &&
            persistenceExternalRevision.current >
              (persistenceObservedRevision.current ?? -1)
          ) {
            queueMicrotask(() => void drainPersistenceQueue());
          } else {
            const retryDelay = persistenceRetryDelay.current;
            persistenceRetryDelay.current =
              persistenceFacade.nextRetryDelay(persistenceRetryDelay.current);
            persistenceSaveTimer.current = window.setTimeout(
              () => void drainPersistenceQueue(),
              retryDelay,
            );
          }
        }
      }
    };

    // 硬性截止兜底必须始终指向当前保存器；首次定时保存若被动画闸门挡住，
    // 1600ms 后仍能把最终文档写入，而不是调用初始化时的空函数。
    drainPersistenceQueueRef.current = drainPersistenceQueue;
    persistenceScheduledDocument.current = liveDocument;
    persistenceSaveTimer.current = window.setTimeout(() => {
      persistenceSaveTimer.current = undefined;
      persistenceScheduledDocument.current = undefined;
      // 节点/边变化会在动画真正启动前预约此 timer；执行时必须再次检查，
      // 否则会在 800ms 镜头动画中连续保存每一个中间 viewport。
      if (templateFitBlocksPersistence()) {
        persistenceDirty.current = true;
        return;
      }
      persistenceQueued.current = canvasSnapshot();
      void drainPersistenceQueue();
    }, PERSIST_DEBOUNCE_MS);
  }, [
    canvasSnapshot,
    canvasSnapshotWithLiveEditors,
    edges,
    nodes,
    onProjectMissing,
    onSaveConflict,
    onSaveFailure,
    onSaveSuccess,
    onSaveStart,
    persistenceFacade,
    persistenceFixture,
    persistenceId,
    persistenceReady,
    persistenceRecheckTick,
    persistenceScopeId,
    persistCanvasSaveSession,
    reserveCanvasSaveAttempt,
    raiseCanvasSaveSequenceFloor,
    rememberSentFingerprint,
    settleCanvasSaveSequence,
    settleSentFingerprint,
    stopForCanvasSaveSessionStorage,
    templateFitBlocksPersistence,
    viewport,
  ]);
}
export function useCanvasPersistenceLifecycleCoordinator(
  input: CanvasPersistenceLifecycleCoordinatorInput,
) {
  const {
    accountId,
    applyCanvasSaveSession,
    canvasSnapshotRef,
    canvasSnapshotWithLiveEditors,
    drainPersistenceQueueRef,
    normalizeNodes,
    onSaveSuccess,
    pendingGuardedEdges,
    pendingGuardedNodes,
    persistedDocumentFingerprint,
    persistedGraphFingerprint,
    persistenceBfCacheReloadSafe,
    persistenceBroadcastInstanceId,
    persistenceConfirmedSaveSequence,
    persistenceConflict,
    persistenceDirty,
    persistenceExternalRevision,
    persistenceFacade,
    persistenceFixture,
    persistenceGraphRevision,
    persistenceId,
    persistenceLoadIdentity,
    persistenceObservedLoadToken,
    persistenceObservedRevision,
    persistencePendingAttempt,
    persistencePendingPagehide,
    persistenceQueued,
    persistenceReady,
    persistenceReadyRef,
    persistenceRetryDelay,
    persistenceRevision,
    persistenceScheduledDocument,
    persistenceSaveTimer,
    persistenceSaving,
    persistenceScopeId,
    persistenceSessionId,
    persistenceStorageRevision,
    pruneSentFingerprints,
    rememberSentFingerprint,
    reserveCanvasSaveAttempt,
    setConfirmedGraphRevision,
    setConfirmedPersistenceRevision,
    setPersistenceLoadState,
    settleSentFingerprint,
    stopForCanvasSaveSessionStorage,
  } = input;
  useEffect(() => {
    const hasPendingChanges = () =>
      persistenceDirty.current ||
      persistenceSaving.current ||
      pendingGuardedNodes.current !== undefined ||
      pendingGuardedEdges.current !== undefined ||
      Boolean(persistencePendingAttempt.current) ||
      Boolean(persistenceQueued.current);
    return persistenceFacade.bindBeforeUnload(hasPendingChanges);
  }, [persistenceFacade]);

  useEffect(() => {
    if (!persistenceFixture) return;
    return persistenceFacade.subscribeSaved({
      accountId: accountId ?? "",
      canvasId: persistenceId,
      instanceId: persistenceBroadcastInstanceId.current,
      onRevision(revision) {
      persistenceExternalRevision.current = Math.max(
        persistenceExternalRevision.current ?? 0,
        revision,
      );
      if (!persistenceReadyRef.current) return;
      const latest = canvasSnapshotRef.current();
      if (
        persistenceDirty.current ||
        persistenceSaving.current ||
        persistenceQueued.current ||
        latest.fingerprint !== persistedDocumentFingerprint.current ||
        latest.graphFingerprint !== persistedGraphFingerprint.current
      ) {
        if (
          latest.fingerprint !== persistedDocumentFingerprint.current ||
          latest.graphFingerprint !== persistedGraphFingerprint.current
        ) {
          persistenceQueued.current = latest;
          persistenceDirty.current = true;
        }
        if (!persistenceSaving.current && !persistenceConflict.current) {
          window.clearTimeout(persistenceSaveTimer.current);
          persistenceSaveTimer.current = undefined;
          persistenceScheduledDocument.current = undefined;
          queueMicrotask(() => drainPersistenceQueueRef.current());
        }
        return;
      }
      persistenceReadyRef.current = false;
      setPersistenceLoadState("loading");
      window.location.reload();
      },
    });
  }, [accountId, persistenceFacade, persistenceFixture, persistenceId]);

  useEffect(() => {
    if (!persistenceFixture || !persistenceReady) return;
    const flushBeforeReload = () => {
      persistenceBfCacheReloadSafe.current = false;
      if (
        !persistenceReadyRef.current ||
        persistenceObservedRevision.current === undefined ||
        !isCanvasLoadToken(persistenceObservedLoadToken.current) ||
        (persistenceExternalRevision.current !== undefined &&
          persistenceExternalRevision.current >
            persistenceObservedRevision.current)
      ) {
        return;
      }
      const latest = canvasSnapshotWithLiveEditors();
      const inFlightAttempt = persistencePendingAttempt.current;
      const unresolvedInFlightSave =
        persistenceSaving.current &&
        (!inFlightAttempt ||
          inFlightAttempt.saveSequence >
            persistenceConfirmedSaveSequence.current);
      if (
        persistenceConflict.current ||
        (latest.fingerprint === persistedDocumentFingerprint.current &&
          latest.graphFingerprint === persistedGraphFingerprint.current &&
          !unresolvedInFlightSave)
      ) {
        if (!persistenceConflict.current) {
          persistenceBfCacheReloadSafe.current = true;
        }
        return;
      }
      window.clearTimeout(persistenceSaveTimer.current);
      persistenceSaveTimer.current = undefined;
      persistenceScheduledDocument.current = undefined;
      // keepalive 有约 64KB 的浏览器硬上限，超限会直接失败；
      // 页面卸载时的兜底保存只在小负载下尽力而为，大负载依赖常规防抖保存。
      const pendingAttempt = persistencePendingAttempt.current;
      let attemptId: string;
      let payload: string;
      let saveSequence: number;
      if (
        pendingAttempt &&
        latest.fingerprint === pendingAttempt.document.fingerprint &&
        latest.graphFingerprint === pendingAttempt.document.graphFingerprint
      ) {
        attemptId = pendingAttempt.attemptId;
        payload = pendingAttempt.payload;
        saveSequence = pendingAttempt.saveSequence;
      } else {
        attemptId = crypto.randomUUID();
        let reserved: { payload: string; saveSequence: number };
        try {
          reserved = reserveCanvasSaveAttempt(
            attemptId,
            (candidateSequence) => JSON.stringify({
              edges: latest.edges,
              nodes: latest.nodes,
              observedRevision: persistenceObservedRevision.current,
              observedLoadToken: persistenceObservedLoadToken.current,
              revision: persistenceRevision.current,
              saveAttemptId: attemptId,
              saveSequence: candidateSequence,
              saveSessionId: persistenceSessionId.current,
              viewport: latest.viewport,
            }),
          );
        } catch (error) {
          if (error instanceof CanvasSaveSessionStorageError) {
            stopForCanvasSaveSessionStorage();
            return;
          }
          throw error;
        }
        ({ payload, saveSequence } = reserved);
        rememberSentFingerprint(saveSequence, {
          attemptId,
          document: latest.fingerprint,
          graph: latest.graphFingerprint,
          liveEditors: true,
        });
      }
      const journal = persistencePendingPagehide.current;
      if (
        journal?.attemptId !== attemptId ||
        journal.payload !== payload ||
        journal.saveSequence !== saveSequence
      ) {
        stopForCanvasSaveSessionStorage();
        return;
      }
      persistenceBfCacheReloadSafe.current = true;
      if (persistenceFacade.canSendPagehide(payload)) {
        const saveSessionId = persistenceSessionId.current;
        const expectedStorageRevision = persistenceStorageRevision.current;
        const savedSnapshot = persistenceFacade.pendingSnapshot({
          normalizeNodes,
          pending: journal,
          saveSessionId,
        });
        if (!savedSnapshot) {
          persistenceBfCacheReloadSafe.current = false;
          stopForCanvasSaveSessionStorage();
          return;
        }
        void persistenceFacade.transport.put({
          canvasId: persistenceId,
          keepalive: true,
          payload,
          responseMode: "strict-json",
        }).then(async (response) => {
          if (!response.ok) {
            settleSentFingerprint(saveSequence, false);
            return;
          }
          const result = response.body;
          const requestFence = persistenceFacade.requestFence(payload);
          if (
            !persistenceFacade.isSaveSuccess(result, requestFence)
          ) {
            settleSentFingerprint(saveSequence, false);
            return;
          }
          settleSentFingerprint(saveSequence, true);
          try {
            const settlement = persistenceFacade.journal.settleStored({
              attemptId,
              payload,
              saveSequence,
              saveSessionId,
              scopeId: persistenceScopeId,
              serverEpoch: journal.serverEpoch,
            });
            if (
              settlement &&
              persistenceLoadIdentity.current.scopeId === persistenceScopeId &&
              persistenceSessionId.current === saveSessionId &&
              persistenceStorageRevision.current === expectedStorageRevision &&
              settlement.previousStorageRevision === expectedStorageRevision
            ) {
              applyCanvasSaveSession(settlement.settled);
              persistenceRevision.current = result.revision;
              persistenceGraphRevision.current = result.graphRevision;
              persistenceObservedRevision.current = result.revision;
              persistenceObservedLoadToken.current = result.loadToken;
              persistenceRetryDelay.current = 1_000;
              persistedDocumentFingerprint.current = savedSnapshot.fingerprint;
              persistedGraphFingerprint.current = savedSnapshot.graphFingerprint;
              setConfirmedPersistenceRevision(result.revision);
              setConfirmedGraphRevision(result.graphRevision);
              if (
                persistenceExternalRevision.current !== undefined &&
                persistenceExternalRevision.current <= result.revision
              ) {
                persistenceExternalRevision.current = undefined;
              }
              persistenceFacade.broadcastSaved(
                accountId ?? "",
                persistenceId,
                result.revision,
                persistenceBroadcastInstanceId.current,
              );
              const currentSnapshot = canvasSnapshotWithLiveEditors();
              if (
                currentSnapshot.fingerprint === savedSnapshot.fingerprint &&
                currentSnapshot.graphFingerprint === savedSnapshot.graphFingerprint
              ) {
                persistenceQueued.current = undefined;
                persistenceDirty.current = false;
                onSaveSuccess();
              } else {
                persistenceBfCacheReloadSafe.current = false;
                persistenceQueued.current = currentSnapshot;
                persistenceDirty.current = true;
              }
            }
          } catch {
            // A later page will fail closed on the still-persisted pending
            // journal and reconcile it against the server fence.
          }
        }).catch(() => {
          pruneSentFingerprints();
        });
      }
    };
    return persistenceFacade.bindPagehide(flushBeforeReload);
  }, [
    accountId,
    applyCanvasSaveSession,
    canvasSnapshotWithLiveEditors,
    onSaveSuccess,
    persistenceFacade,
    persistenceFixture,
    persistenceId,
    persistenceReady,
    persistenceScopeId,
    rememberSentFingerprint,
    reserveCanvasSaveAttempt,
    pruneSentFingerprints,
    settleSentFingerprint,
    stopForCanvasSaveSessionStorage,
  ]);

  useEffect(() => {
    return persistenceFacade.bindPersistedPageRestore(() =>
      persistenceBfCacheReloadSafe.current &&
        persistenceReadyRef.current &&
        !persistenceConflict.current,
    );
  }, [persistenceFacade]);
}
export function createBrowserCanvasPersistenceFacade(safeFixtureId?: string) {
  const legacyFullDocumentWritesForSafeTests = import.meta.env.DEV &&
    (window as Window & {
      __UNBOUNDRY_M86_LEGACY_CANVAS_PUTS__?: boolean;
    }).__UNBOUNDRY_M86_LEGACY_CANVAS_PUTS__ === true;
  return createCanvasPersistenceFacade({
    journal: createCanvasSaveJournalPort({ storage: window.sessionStorage }),
    transport: createFetchCanvasPersistenceTransport(fetch, {
      legacyFullDocumentWritesForSafeTests,
      safeFixtureId,
    }),
  });
}

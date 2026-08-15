const projectIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;

export const RETURN_PROJECT_LOOKUP_DEADLINE_MS = 10_000;

type ProjectIdStorage = Pick<Storage, "getItem" | "removeItem" | "setItem">;

function browserSessionStorage(): ProjectIdStorage | undefined {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

export function safeProjectId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const candidate = value.trim();
  if (
    candidate === "default" ||
    !projectIdPattern.test(candidate)
  ) {
    return undefined;
  }
  return candidate;
}

export function lastProjectStorageKey(userId: string) {
  return `unboundry:last-project:${userId}`;
}

export function parseSourceProjectId(search: string): string | undefined {
  try {
    return safeProjectId(new URLSearchParams(search).get("from"));
  } catch {
    return undefined;
  }
}

export function readLastProjectId(
  userId: string,
  storage = browserSessionStorage(),
): string | undefined {
  if (!userId || !storage) return undefined;
  try {
    return safeProjectId(storage.getItem(lastProjectStorageKey(userId)));
  } catch {
    return undefined;
  }
}

export function rememberLastProjectId(
  userId: string,
  projectId: string,
  storage = browserSessionStorage(),
) {
  const safeId = safeProjectId(projectId);
  if (!userId || !safeId || !storage) return;
  try {
    storage.setItem(lastProjectStorageKey(userId), safeId);
  } catch {
    // Privacy mode and denied storage keep URL propagation as the primary path.
  }
}

export function forgetLastProjectId(
  userId: string,
  storage = browserSessionStorage(),
) {
  if (!userId || !storage) return;
  try {
    storage.removeItem(lastProjectStorageKey(userId));
  } catch {
    // Nothing else is required when storage is unavailable.
  }
}

export function preferredSourceProjectId(
  userId: string,
  search: string,
): string | undefined {
  return parseSourceProjectId(search) ?? readLastProjectId(userId);
}

function sourceCandidates(userId: string, search: string) {
  const candidates: string[] = [];
  const source = parseSourceProjectId(search);
  const last = readLastProjectId(userId);
  if (source) candidates.push(source);
  if (last && !candidates.includes(last)) candidates.push(last);
  return candidates;
}

export function projectCanvasPath(projectId: string) {
  const safeId = safeProjectId(projectId);
  if (!safeId) throw new Error("Invalid project id");
  return `/canvas/${encodeURIComponent(safeId)}`;
}

export function withCanvasSource(path: string, projectId?: string) {
  const safeId = safeProjectId(projectId);
  if (!safeId) return path;
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw new Error("Canvas source can only be added to an internal path");
  }
  const url = new URL(path, "https://unboundry.invalid");
  url.searchParams.set("from", safeId);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function projectWorkspacePath(projectId?: string) {
  return withCanvasSource("/canvas/projects", projectId);
}

export function pathWithCurrentCanvasSource(
  path: string,
  userId: string,
  search: string,
  explicitProjectId?: string,
) {
  return withCanvasSource(
    path,
    safeProjectId(explicitProjectId) ??
      preferredSourceProjectId(userId, search),
  );
}

export async function resolveReturnProject({
  fetcher = window.fetch.bind(window),
  search,
  signal,
  userId,
}: {
  fetcher?: typeof fetch;
  search: string;
  signal?: AbortSignal;
  userId: string;
}): Promise<string | undefined> {
  const candidates = sourceCandidates(userId, search);
  if (candidates.length === 0) return undefined;

  const response = await fetcher("/api/projects", {
    headers: { Accept: "application/json" },
    signal,
  });
  if (!response.ok) {
    throw new Error(`项目列表读取失败：${response.status}`);
  }
  const body = await response.json() as { projects?: unknown };
  if (!Array.isArray(body.projects)) {
    throw new Error("项目列表返回无效");
  }

  const alive = new Set<string>();
  for (const item of body.projects) {
    if (!item || typeof item !== "object") {
      throw new Error("项目列表返回无效");
    }
    const rawId = (item as { id?: unknown }).id;
    if (rawId === "default") continue;
    const id = safeProjectId(rawId);
    if (!id) throw new Error("项目列表返回无效");
    alive.add(id);
  }

  const resolved = candidates.find((candidate) => alive.has(candidate));
  const remembered = readLastProjectId(userId);
  if (remembered && !alive.has(remembered)) forgetLastProjectId(userId);
  if (resolved) rememberLastProjectId(userId, resolved);
  return resolved;
}

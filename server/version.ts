import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  RuntimeControlEvent,
  RuntimeLifecycle,
} from "./runtimeLifecycle";

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };

export const currentVersion = packageJson.version;

const sseClients = new Set<ServerResponse>();
let heartbeat: NodeJS.Timeout | undefined;
type VersionLifecycle = Pick<
  RuntimeLifecycle,
  | "getMode"
  | "getRetryAfterSeconds"
  | "registerStreamCloser"
  | "requestId"
>;
let lifecycle: VersionLifecycle | undefined;
let unregisterStreamCloser: (() => void) | undefined;

function stopHeartbeatIfIdle() {
  if (sseClients.size === 0 && heartbeat) {
    clearInterval(heartbeat);
    heartbeat = undefined;
  }
}

function removeSseClient(response: ServerResponse) {
  sseClients.delete(response);
  stopHeartbeatIfIdle();
}

function writeSse(response: ServerResponse, payload: string) {
  if (response.destroyed || response.writableEnded) {
    removeSseClient(response);
    return false;
  }
  try {
    response.write(payload);
    return true;
  } catch {
    removeSseClient(response);
    return false;
  }
}

export function closeVersionStreams(event: RuntimeControlEvent) {
  const retryMilliseconds = event.retryAfterSeconds * 1_000;
  const payload = [
    `retry: ${retryMilliseconds}`,
    `event: ${event.type}`,
    `data: ${JSON.stringify({
      retryAfterSeconds: event.retryAfterSeconds,
      version: currentVersion,
    })}`,
    "",
    "",
  ].join("\n");
  for (const client of [...sseClients]) {
    if (writeSse(client, payload)) {
      try {
        client.end();
      } catch {
        // The stream has already been removed below; no request data is logged.
      }
    }
    removeSseClient(client);
  }
  stopHeartbeatIfIdle();
}

export function registerVersionLifecycle(nextLifecycle: VersionLifecycle) {
  unregisterStreamCloser?.();
  lifecycle = nextLifecycle;
  unregisterStreamCloser = nextLifecycle.registerStreamCloser(
    closeVersionStreams,
  );
  return () => {
    if (lifecycle !== nextLifecycle) return;
    unregisterStreamCloser?.();
    unregisterStreamCloser = undefined;
    lifecycle = undefined;
  };
}

function json(response: ServerResponse, status: number, body: unknown) {
  response.statusCode = status;
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

export function versionApi(
  request: IncomingMessage,
  response: ServerResponse,
  kind: "updates" | "version",
) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    json(response, 405, {
      error: "Method not allowed",
      code: "METHOD_NOT_ALLOWED",
      requestId: lifecycle?.requestId(request),
    });
    return;
  }

  if (kind === "version") {
    json(response, 200, { version: currentVersion });
    return;
  }

  if (kind === "updates") {
    const lifecycleMode = lifecycle?.getMode() ?? "active";
    if (lifecycleMode !== "active") {
      const retryAfterSeconds = lifecycle?.getRetryAfterSeconds() ?? 5;
      const code = lifecycleMode === "shutting-down"
        ? "SERVICE_SHUTTING_DOWN"
        : "SERVICE_MAINTENANCE";
      response.setHeader("Retry-After", String(retryAfterSeconds));
      json(response, 503, {
        error: "Update stream is temporarily unavailable",
        code,
        requestId: lifecycle?.requestId(request),
      });
      return;
    }
    response.writeHead(200, {
      "Cache-Control": "no-store",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no",
    });
    response.write(
      `data: ${JSON.stringify({ version: currentVersion })}\n\n`,
    );
    sseClients.add(response);
    if (!heartbeat) {
      heartbeat = setInterval(() => {
        for (const client of sseClients) writeSse(client, ": ping\n\n");
      }, 25_000);
      heartbeat.unref?.();
    }
    response.once("close", () => removeSseClient(response));
    response.once("error", () => removeSseClient(response));
    return;
  }

  json(response, 404, {
    error: "Update endpoint not found",
    code: "NOT_FOUND",
    requestId: lifecycle?.requestId(request),
  });
}

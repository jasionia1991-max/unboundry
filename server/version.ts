import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  RuntimeControlEvent,
  RuntimeLifecycle,
} from "./runtimeLifecycle";
import {
  admitVersionStream,
  RequestAdmissionError,
} from "./requestAdmission";
import { rejectUnreadRequestBody } from "./boundedBody";

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };

export const currentVersion = packageJson.version;

type SseClient = {
  backpressured: boolean;
  cleanup: () => void;
  onDrain: () => void;
  release: () => void;
  request: IncomingMessage;
  response: ServerResponse;
  slowTimer?: NodeJS.Timeout;
};

const sseClients = new Map<ServerResponse, SseClient>();
const maximumSseBufferedBytes = 64 * 1_024;
const slowClientTimeoutMs = 10_000;
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
  const client = sseClients.get(response);
  if (!client) return;
  sseClients.delete(response);
  if (client.slowTimer) clearTimeout(client.slowTimer);
  response.off("drain", client.onDrain);
  response.off("close", client.cleanup);
  response.off("error", client.cleanup);
  response.off("finish", client.cleanup);
  client.request.off("aborted", client.cleanup);
  client.release();
  stopHeartbeatIfIdle();
}

function destroySseClient(client: SseClient) {
  removeSseClient(client.response);
  if (!client.response.destroyed) client.response.destroy();
}

function writeSse(client: SseClient, payload: string) {
  const { response } = client;
  if (response.destroyed || response.writableEnded) {
    removeSseClient(response);
    return "closed" as const;
  }
  if (client.backpressured) {
    if (response.writableLength > maximumSseBufferedBytes) {
      destroySseClient(client);
      return "closed" as const;
    }
    return "blocked" as const;
  }
  try {
    if (response.write(payload)) return "written" as const;
    client.backpressured = true;
    response.once("drain", client.onDrain);
    client.slowTimer = setTimeout(
      () => destroySseClient(client),
      slowClientTimeoutMs,
    );
    client.slowTimer.unref?.();
    if (response.writableLength > maximumSseBufferedBytes) {
      destroySseClient(client);
      return "closed" as const;
    }
    return "blocked" as const;
  } catch {
    destroySseClient(client);
    return "closed" as const;
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
  for (const client of [...sseClients.values()]) {
    if (!client.backpressured && writeSse(client, payload) === "written") {
      try {
        client.response.end();
      } catch {
        // The stream has already been removed below; no request data is logged.
      }
    } else if (!client.response.destroyed) {
      client.response.destroy();
    }
    removeSseClient(client.response);
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
    rejectUnreadRequestBody(request, response);
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
    let release: () => void;
    try {
      release = admitVersionStream(request);
    } catch (error) {
      if (!(error instanceof RequestAdmissionError)) throw error;
      response.setHeader("Retry-After", String(error.retryAfterSeconds));
      json(response, error.statusCode, {
        error: "Update stream capacity is busy",
        code: error.code,
        requestId: lifecycle?.requestId(request),
      });
      return;
    }
    let client: SseClient;
    const cleanup = () => removeSseClient(response);
    const onDrain = () => {
      if (!client || !sseClients.has(response)) return;
      client.backpressured = false;
      if (client.slowTimer) clearTimeout(client.slowTimer);
      client.slowTimer = undefined;
    };
    client = {
      backpressured: false,
      cleanup,
      onDrain,
      release,
      request,
      response,
    };
    sseClients.set(response, client);
    request.once("aborted", cleanup);
    response.once("close", cleanup);
    response.once("error", cleanup);
    response.once("finish", cleanup);
    response.writeHead(200, {
      "Cache-Control": "no-store",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no",
    });
    if (writeSse(
      client,
      `data: ${JSON.stringify({ version: currentVersion })}\n\n`,
    ) === "closed") return;
    if (!heartbeat) {
      heartbeat = setInterval(() => {
        for (const client of sseClients.values()) {
          writeSse(client, ": ping\n\n");
        }
      }, 25_000);
      heartbeat.unref?.();
    }
    return;
  }

  json(response, 404, {
    error: "Update endpoint not found",
    code: "NOT_FOUND",
    requestId: lifecycle?.requestId(request),
  });
}

import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };

export const currentVersion = packageJson.version;

const sseClients = new Set<ServerResponse>();
let heartbeat: NodeJS.Timeout | undefined;

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
    json(response, 405, { error: "Method not allowed" });
    return;
  }

  if (kind === "version") {
    json(response, 200, { version: currentVersion });
    return;
  }

  if (kind === "updates") {
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
        for (const client of sseClients) client.write(": ping\n\n");
      }, 25_000);
      heartbeat.unref?.();
    }
    request.on("close", () => {
      sseClients.delete(response);
      if (sseClients.size === 0 && heartbeat) {
        clearInterval(heartbeat);
        heartbeat = undefined;
      }
    });
    return;
  }

  json(response, 404, { error: "Update endpoint not found" });
}

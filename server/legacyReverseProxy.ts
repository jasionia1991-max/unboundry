import { request as httpRequest } from "node:http";
import type {
  IncomingHttpHeaders,
  IncomingMessage,
  OutgoingHttpHeaders,
  ServerResponse,
} from "node:http";
import { pipeline } from "node:stream";
import { discardUnreadRequestBody } from "./httpRequest.ts";
import type { RuntimeLifecycle } from "./runtimeLifecycle.ts";
import type { LegacyRuntimeSupervisor } from "./legacyRuntimeSupervisor.ts";
import {
  isParentAuthoritativeLegacyPath,
  LegacyBridgeRequestError,
  legacyProxyRequestHeaders,
  parseLegacyBridgeRequestTarget,
  type LegacyBridgeRequestTarget,
} from "./legacyBridgeRequest.ts";

const hopByHopHeaders = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function connectionTokens(headers: IncomingHttpHeaders) {
  return new Set(
    String(headers.connection ?? "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
}

function copyResponseHeaders(
  upstream: IncomingMessage,
  response: ServerResponse,
) {
  const namedByConnection = connectionTokens(upstream.headers);
  for (const [name, value] of Object.entries(upstream.headers)) {
    const normalized = name.toLowerCase();
    if (
      value === undefined || hopByHopHeaders.has(normalized) ||
      namedByConnection.has(normalized)
    ) continue;
    response.setHeader(name, value);
  }
}

function invalidBridgeRequest(
  request: IncomingMessage,
  response: ServerResponse,
  lifecycle: RuntimeLifecycle,
  error: LegacyBridgeRequestError,
) {
  lifecycle.setRouteId(request, "legacy.request-invalid");
  lifecycle.setResponseCode(request, error.code);
  discardUnreadRequestBody(request);
  response.statusCode = 400;
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Connection", "close");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.once("finish", () => {
    if (!request.readableEnded && !request.destroyed) request.destroy();
  });
  response.end(JSON.stringify({
    code: error.code,
    error: "Bridge request is not canonical",
    requestId: lifecycle.requestId(request),
  }));
}

function unavailable(
  request: IncomingMessage,
  response: ServerResponse,
  lifecycle: RuntimeLifecycle,
) {
  lifecycle.setResponseCode(request, "SERVICE_LEGACY_RUNTIME_UNAVAILABLE");
  if (response.destroyed || response.writableEnded) return;
  if (response.headersSent) {
    response.destroy();
    return;
  }
  response.statusCode = 503;
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Connection", "close");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Retry-After", String(lifecycle.getRetryAfterSeconds()));
  response.end(JSON.stringify({
    code: "SERVICE_LEGACY_RUNTIME_UNAVAILABLE",
    error: "Legacy bridge runtime is unavailable",
    requestId: lifecycle.requestId(request),
  }));
}

export function legacyBridgeMutationBlockCode(
  request: IncomingMessage,
  target = parseLegacyBridgeRequestTarget(request.url),
) {
  const method = String(request.method ?? "").toUpperCase();
  const path = target.lowerPath;
  // v0.5.1 initializes crash recovery from its first task-store read. A GET is
  // therefore not observational: it can resume an old Provider task. Keep the
  // entire endpoint on the safe side of the bridge boundary.
  if (/^\/api\/generation-tasks(?:[/.]|$)/.test(path)) {
    return "BRIDGE_LEGACY_GENERATION_MUTATION_DISABLED" as const;
  }
  if (/^\/api\/workflow-runs(?:[/.]|$)/.test(path)) {
    return "BRIDGE_LEGACY_GENERATION_MUTATION_DISABLED" as const;
  }
  if (/^\/api\/playlist\/export(?:[/.]|$)/.test(path)) {
    return "BRIDGE_LEGACY_MEDIA_MUTATION_DISABLED" as const;
  }
  if (/^\/api\/playlist\/thumbnails(?:[/.]|$)/.test(path)) {
    return "BRIDGE_LEGACY_MEDIA_MUTATION_DISABLED" as const;
  }
  // Method-aware destructive matrix. Schema-37 business/configuration writes
  // remain available only when they are fully local and do not delete media,
  // accounts, durable Provider work, or secret/profile provenance.
  if (method === "DELETE" && (
    /^\/api\/admin\/users(?:[/.]|$)/.test(path)
  )) return "BRIDGE_LEGACY_ACCOUNT_DELETION_DISABLED" as const;
  if (method === "DELETE" && (
    /^\/api\/account-credentials(?:[/.]|$)/.test(path) ||
    /^\/api\/admin\/(?:models|templates|storage)(?:[/.]|$)/.test(path) ||
    /^\/api\/templates(?:[/.]|$)/.test(path)
  )) return "BRIDGE_LEGACY_CONFIGURATION_DELETION_DISABLED" as const;
  if (
    (method === "POST" && (
      /^\/api\/account-credentials\/[^/]+\/verify$/.test(path) ||
      /^\/api\/admin\/providers\/[^/]+\/test$/.test(path) ||
      /^\/api\/admin\/provider-catalog\/[^/]+\/sync$/.test(path) ||
      /^\/api\/admin\/storage\/profiles\/[^/]+\/test$/.test(path)
    )) ||
    (method === "GET" &&
      /^\/api\/admin\/provider-catalog\/[^/]+\/readonly\/(?:balance|usage|pricing|task-status|model-detail)$/.test(
        path,
      ))
  ) return "BRIDGE_LEGACY_EXTERNAL_REQUEST_DISABLED" as const;
  if (
    /^\/api\/(?:assets|audio-assets|video-assets|media-metadata)(?:[/.]|$)/
      .test(path)
  ) {
    return method === "GET" || method === "HEAD"
      ? undefined
      : "BRIDGE_LEGACY_MEDIA_MUTATION_DISABLED" as const;
  }
  if (!/^\/api(?:[/.]|$)/i.test(path)) {
    return method === "GET" || method === "HEAD"
      ? undefined
      : "BRIDGE_LEGACY_ROUTE_METHOD_DISABLED" as const;
  }
  if (!legacyBridgeAllowsLocalMethod(path, method)) {
    return "BRIDGE_LEGACY_ROUTE_METHOD_DISABLED" as const;
  }
  return undefined;
}

function legacyBridgeAllowsLocalMethod(path: string, method: string) {
  const uuid = "[a-f0-9-]{36}";
  const id = "[a-z0-9._-]+";
  const exactRules: ReadonlyArray<readonly [RegExp, string]> = [
    [/^\/api\/auth\/(?:status)$/, "GET"],
    [/^\/api\/auth\/(?:bootstrap|login|logout|password)$/, "POST"],
    [/^\/api\/admin\/users$/, "GET|POST"],
    [new RegExp(`^/api/admin/users/${id}$`), "PATCH"],
    [new RegExp(`^/api/admin/users/${id}/password$`), "POST"],
    [new RegExp(`^/api/admin/users/${id}/permissions$`), "GET|PUT"],
    [/^\/api\/account-context$/, "GET"],
    [/^\/api\/account-credentials$/, "GET"],
    [new RegExp(`^/api/account-credentials/${uuid}$`), "PUT"],
    [/^\/api\/(?:models|openapi\.json)$/, "GET"],
    [/^\/api\/admin\/models$/, "GET|POST"],
    [new RegExp(`^/api/admin/models/[a-z0-9-]{3,80}$`), "PATCH"],
    [new RegExp(`^/api/admin/models/[a-z0-9-]{3,80}/(?:archive|restore)$`), "POST"],
    [new RegExp(`^/api/admin/models/[a-z0-9-]{3,80}/contract$`), "GET"],
    [new RegExp(`^/api/admin/models/[a-z0-9-]{3,80}/contract/(?:draft|validate|publish|rollback|revoke|restore)$`), "POST"],
    [/^\/api\/templates$/, "GET|POST"],
    [/^\/api\/admin\/templates$/, "GET|POST"],
    [new RegExp(`^/api/admin/templates/${uuid}$`), "PATCH"],
    [/^\/api\/(?:agent-config|characters|library)$/, "GET"],
    [/^\/api\/admin\/providers$/, "GET|POST"],
    [new RegExp(`^/api/admin/providers/${uuid}$`), "PATCH"],
    [new RegExp(`^/api/admin/provider-catalog/${uuid}$`), "GET"],
    [new RegExp(`^/api/admin/provider-catalog/${uuid}/credentials$`), "PATCH"],
    [new RegExp(`^/api/admin/provider-catalog/${uuid}/import$`), "POST"],
    [/^\/api\/admin\/storage$/, "GET"],
    [/^\/api\/admin\/storage\/(?:profiles|media-routing)$/, "POST"],
    [new RegExp(`^/api/admin/storage/profiles/${uuid}$`), "PATCH"],
    [new RegExp(`^/api/admin/storage/profiles/${uuid}/activate$`), "POST"],
    // Even PUT can invoke Provider-aware running-task cancellation. Keep this
    // administration endpoint observational in schema-37 bridge mode.
    [/^\/api\/admin\/generation-safety$/, "GET"],
    [new RegExp(`^/api/canvas/${id}$`), "GET|PUT|DELETE"],
    [new RegExp(`^/api/history/${id}$`), "GET|POST|DELETE"],
    [new RegExp(`^/api/project-title/${id}$`), "GET|PUT|DELETE"],
    [/^\/api\/projects$/, "GET|POST"],
    [new RegExp(`^/api/projects/${id}/clone$`), "POST"],
  ];
  return exactRules.some(([route, methods]) =>
    route.test(path) && methods.split("|").includes(method));
}

function rejectUnsafeLegacyMutation(
  request: IncomingMessage,
  response: ServerResponse,
  lifecycle: RuntimeLifecycle,
  code: NonNullable<ReturnType<typeof legacyBridgeMutationBlockCode>>,
) {
  lifecycle.setRouteId(request, "legacy.mutation-blocked");
  lifecycle.setResponseCode(request, code);
  discardUnreadRequestBody(request);
  response.statusCode = 503;
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Connection", "close");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Retry-After", String(lifecycle.getRetryAfterSeconds()));
  response.once("finish", () => {
    if (!request.readableEnded && !request.destroyed) request.destroy();
  });
  response.end(JSON.stringify({
    code,
    error: code === "BRIDGE_LEGACY_GENERATION_MUTATION_DISABLED"
      ? "Generation task access is disabled while the bridge serves schema 37"
      : code === "BRIDGE_LEGACY_MEDIA_MUTATION_DISABLED"
        ? "Media mutations are disabled while the bridge serves schema 37"
        : code === "BRIDGE_LEGACY_ACCOUNT_DELETION_DISABLED"
          ? "Account deletion is disabled while the bridge serves schema 37"
          : code === "BRIDGE_LEGACY_CONFIGURATION_DELETION_DISABLED"
            ? "Configuration deletion is disabled while the bridge serves schema 37"
            : code === "BRIDGE_LEGACY_ROUTE_METHOD_DISABLED"
              ? "This route and method are disabled while the bridge serves schema 37"
        : "External Provider and storage checks are disabled while the bridge serves schema 37",
    requestId: lifecycle.requestId(request),
  }));
}

export function createLegacyReverseProxy(options: Readonly<{
  lifecycle: RuntimeLifecycle;
  supervisor: LegacyRuntimeSupervisor;
}>) {
  function forward(
    request: IncomingMessage,
    response: ServerResponse,
    parsedTarget?: LegacyBridgeRequestTarget,
  ) {
    return new Promise<void>((resolve) => {
      let settled = false;
      let upstreamResponse: IncomingMessage | undefined;
      let unregisterStream: (() => void) | undefined;
      const settle = () => {
        if (settled) return;
        settled = true;
        unregisterStream?.();
        resolve();
      };
      let target;
      let requestTarget: LegacyBridgeRequestTarget;
      let requestHeaders: OutgoingHttpHeaders;
      try {
        requestTarget = parsedTarget ?? parseLegacyBridgeRequestTarget(request.url);
        target = options.supervisor.target();
        requestHeaders = legacyProxyRequestHeaders(request, target).headers;
      } catch (error) {
        if (error instanceof LegacyBridgeRequestError) {
          invalidBridgeRequest(request, response, options.lifecycle, error);
          settle();
          return;
        }
        unavailable(request, response, options.lifecycle);
        settle();
        return;
      }
      const upstreamRequest = httpRequest({
        agent: false,
        headers: requestHeaders,
        host: target.host,
        method: request.method,
        path: requestTarget.canonicalOriginForm,
        port: target.port,
      });
      const fail = () => {
        try {
          upstreamRequest.destroy();
          upstreamResponse?.destroy();
        } catch {}
        unavailable(request, response, options.lifecycle);
        settle();
      };
      upstreamRequest.once("error", fail);
      request.once("aborted", fail);
      response.once("close", () => {
        if (!response.writableFinished) {
          try {
            upstreamRequest.destroy();
            upstreamResponse?.destroy();
          } catch {}
        }
        settle();
      });
      upstreamRequest.once("response", (upstream) => {
        upstreamResponse = upstream;
        response.statusCode = upstream.statusCode ?? 502;
        if (upstream.statusMessage) response.statusMessage = upstream.statusMessage;
        copyResponseHeaders(upstream, response);
        if (
          String(upstream.headers["content-type"] ?? "")
            .toLowerCase().startsWith("text/event-stream")
        ) {
          unregisterStream = options.lifecycle.registerStreamCloser(() => {
            try {
              upstream.destroy();
              if (!response.writableEnded) response.end();
            } catch {
              response.destroy();
            }
          });
        }
        pipeline(upstream, response, (error) => {
          if (error && !response.headersSent) unavailable(
            request,
            response,
            options.lifecycle,
          );
          else if (error && !response.destroyed) response.destroy();
          settle();
        });
      });
      // Node streams preserve backpressure in both directions. There is a
      // single upstream attempt for every method; POST/PUT/PATCH are never
      // replayed, even when the child exits before sending a response.
      pipeline(request, upstreamRequest, (error) => {
        if (error && !upstreamResponse) fail();
      });
    });
  }

  function middleware(request: IncomingMessage, response: ServerResponse) {
    let parsedTarget: LegacyBridgeRequestTarget;
    try {
      parsedTarget = parseLegacyBridgeRequestTarget(request.url);
    } catch (error) {
      invalidBridgeRequest(
        request,
        response,
        options.lifecycle,
        error instanceof LegacyBridgeRequestError
          ? error
          : new LegacyBridgeRequestError(
            "BRIDGE_REQUEST_TARGET_INVALID",
            "request target could not be classified",
          ),
      );
      return;
    }
    const blocked = legacyBridgeMutationBlockCode(request, parsedTarget);
    if (blocked) {
      rejectUnsafeLegacyMutation(
        request,
        response,
        options.lifecycle,
        blocked,
      );
      return;
    }
    options.lifecycle.setRouteId(request, "legacy.proxy");
    void options.lifecycle.trackHandler(() =>
      forward(request, response, parsedTarget)).catch(
      () => unavailable(request, response, options.lifecycle),
    );
  }

  function dispatch(
    request: IncomingMessage,
    response: ServerResponse,
    parent: () => void,
  ) {
    let parsedTarget: LegacyBridgeRequestTarget;
    try {
      parsedTarget = parseLegacyBridgeRequestTarget(request.url);
    } catch (error) {
      invalidBridgeRequest(
        request,
        response,
        options.lifecycle,
        error instanceof LegacyBridgeRequestError
          ? error
          : new LegacyBridgeRequestError(
            "BRIDGE_REQUEST_TARGET_INVALID",
            "request target could not be classified",
          ),
      );
      return;
    }
    if (isParentAuthoritativeLegacyPath(parsedTarget.lowerPath)) {
      parent();
      return;
    }
    const blocked = legacyBridgeMutationBlockCode(request, parsedTarget);
    if (blocked) {
      rejectUnsafeLegacyMutation(request, response, options.lifecycle, blocked);
      return;
    }
    options.lifecycle.middleware(request, response, () => {
      options.lifecycle.setRouteId(request, "legacy.proxy");
      void options.lifecycle.trackHandler(() =>
        forward(request, response, parsedTarget)).catch(
        () => unavailable(request, response, options.lifecycle),
      );
    });
  }

  return Object.freeze({ dispatch, forward, middleware });
}

export type LegacyReverseProxy = ReturnType<typeof createLegacyReverseProxy>;

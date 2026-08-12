import {
  closeSync,
  constants as fileConstants,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
} from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { playlistExport } from "./server/playlistExport";
import { playlistThumbnails } from "./server/playlistThumbnails";
import {
  appDataDirectory,
  initializeGreenfieldAppDatabaseAtProcessStartup,
} from "./server/database";
import { databaseMatchesFrozenSchema37Contract } from "./server/backupInspection";
import {
  accountHistory,
  canvasPersistence,
  projectTitle,
} from "./server/canvasPersistence";
import { projectsApi } from "./server/projects";
import { assetStorage } from "./server/assetStorage";
import { audioStorage } from "./server/audioStorage";
import { videoStorage } from "./server/videoStorage";
import { mediaMetadataApi } from "./server/mediaMetadataApi";
import {
  generationTasks,
  initializePersistentGenerationTaskWorker,
  prepareGenerationRuntimeRoleTeardown,
  registerGenerationRuntimeRoleCoordinator,
  unregisterGenerationRuntimeRoleCoordinatorBeforeStartup,
} from "./server/generationTasks";
import {
  mediaLifecycleStartupRecoveryAllowsReadiness,
  recoverMediaLifecycleAtProcessStartup,
} from "./server/mediaLifecycle";
import { groupDownloadApi } from "./server/groupDownload";
import {
  adminGenerationSafetyApi,
} from "./server/generationSafety";
import {
  accountContextApi,
  adminUsersApi,
  authApi,
  authGate,
} from "./server/auth";
import { adminModelsApi, publicModelsApi } from "./server/modelCatalog";
import { adminProviderProfilesApi } from "./server/providerProfiles";
import { adminProviderCatalogApi } from "./server/providerCatalog";
import { adminStorageApi } from "./server/storageAdmin";
import { openApi } from "./server/openApi";
import { accountCredentialsApi } from "./server/accountCredentialsApi";
import { templateCatalogApi } from "./server/templateCatalog";
import { adminTemplatesApi } from "./server/adminTemplates";
import { agentConfigurationApi } from "./server/agentConfiguration";
import { characterCatalogApi } from "./server/characterCatalog";
import { libraryCatalogApi } from "./server/libraryCatalog";
import {
  HttpRequestError,
  decodedRequestPath,
} from "./server/httpRequest";
import {
  coordinateRuntimeShutdown,
  createRuntimeLifecycle,
  type RuntimeLifecycle,
} from "./server/runtimeLifecycle";
import {
  createRuntimeRoleCoordinator,
  runtimeRoleFromEnvironment,
  type RuntimeRoleCoordinator,
} from "./server/runtimeRole";

import {
  currentVersion,
  registerVersionLifecycle,
  versionApi,
} from "./server/version";
import { applySecurityHeaders } from "./server/securityHeaders";

if (process.env.UNBOUNDRY_EXPLICIT_SCHEMA_MIGRATION !== undefined) {
  throw new Error(
    "UNBOUNDRY_EXPLICIT_SCHEMA_MIGRATION is retired; use the one-shot schema migration CLI",
  );
}

const productionTestEnvironmentError =
  "UNBOUNDRY_PRODUCTION_TEST_ENV_FORBIDDEN: preview and production runtime reject UNBOUNDRY_SAFE_TEST and UNBOUNDRY_TEST_*";

type FixtureDocument = {
  fixtures: Array<{ id: string; kind: string; status: string }>;
};

const appRoot = fileURLToPath(new URL(".", import.meta.url));
const fixturePath = fileURLToPath(
  new URL("./spec/unboundry-state-fixtures.json", import.meta.url),
);
const implementationFixtureIds = new Set([
  "interaction.typed-input-matrix",
  "node.image.text-image-input",
  "node.image.text-image-input.persistence-retest",
]);

type ApiNext = (error?: unknown) => void;
type ApiHandler = (
  request: IncomingMessage,
  response: ServerResponse,
  next: ApiNext,
) => Promise<void> | void;

type RuntimeInstance = {
  generationStartupWorkerGate: GenerationStartupWorkerGate;
  lifecycle?: RuntimeLifecycle;
  roleCoordinator?: RuntimeRoleCoordinator;
  unregisterGeneration?: () => void;
};

type GenerationStartupWorkerGateState =
  | "deferred"
  | "failed"
  | "pending"
  | "ready";

type GenerationStartupWorkerGate = {
  state: GenerationStartupWorkerGateState;
};

function createMainRuntimeLifecycle(
  generationStartupWorkerGate: GenerationStartupWorkerGate,
  roleCoordinator?: RuntimeRoleCoordinator,
) {
  const registeredActiveCoordinator = Boolean(
    roleCoordinator?.role() === "active" &&
      roleCoordinator.snapshot().activeLeaseHeld,
  );
  return createRuntimeLifecycle({
    ...(registeredActiveCoordinator
      ? {
          beforeActiveLeaseRelease: () =>
            prepareGenerationRuntimeRoleTeardown(roleCoordinator!),
        }
      : {}),
    legacyStandbyDatabaseGuard: databaseMatchesFrozenSchema37Contract,
    readinessDatabaseGuard: (database) => {
      if (!mediaLifecycleStartupRecoveryAllowsReadiness(database)) return false;
      if (generationStartupWorkerGate.state === "ready") return true;
      if (generationStartupWorkerGate.state !== "deferred") return false;
      const active = database.prepare(`
        SELECT 1
        FROM generation_tasks
        WHERE state IN ('queued', 'running', 'recovering', 'retrying')
        LIMIT 1
      `).get();
      if (active) return false;
      // A startup-time marker/old snapshot may be repaired externally. A later
      // read-only readiness probe may clear the gate only when no durable work
      // was skipped; readiness never initializes the writer itself.
      generationStartupWorkerGate.state = "ready";
      return true;
    },
    ...(roleCoordinator ? { roleCoordinator } : {}),
  });
}
const runtimeOwnerSymbol = Symbol.for("unboundry.runtime.serve-owner.v1");
type ProcessRuntimeOwner = {
  runtime: RuntimeInstance;
  token: symbol;
};

function claimProcessRuntimeOwner(owner: ProcessRuntimeOwner) {
  const scope = globalThis as typeof globalThis & {
    [runtimeOwnerSymbol]?: ProcessRuntimeOwner;
  };
  if (scope[runtimeOwnerSymbol]) return false;
  scope[runtimeOwnerSymbol] = owner;
  return true;
}

function releaseProcessRuntimeOwner(owner: ProcessRuntimeOwner) {
  const scope = globalThis as typeof globalThis & {
    [runtimeOwnerSymbol]?: ProcessRuntimeOwner;
  };
  if (scope[runtimeOwnerSymbol] === owner) {
    delete scope[runtimeOwnerSymbol];
  }
}

function containsPath(parent: string, child: string) {
  const path = relative(parent, child);
  return path !== "" && path !== ".." &&
    !path.startsWith(`..${sep}`) && !path.startsWith(sep);
}

function safeMediaStartupRecoveryGate(rawGate: string) {
  if (process.env.UNBOUNDRY_SAFE_TEST !== "1") return undefined;
  let sentinelDescriptor: number | undefined;
  try {
    if (!/^(?:[a-z0-9._-]+)$/i.test(rawGate.slice(rawGate.lastIndexOf(sep) + 1))) {
      return undefined;
    }
    const systemTemporaryRoot = realpathSync(String(
      process.env.UNBOUNDRY_SYSTEM_TEMPORARY_ROOT ?? "",
    ));
    const testRoot = realpathSync(String(process.env.UNBOUNDRY_TEST_ROOT ?? ""));
    const repositoryRoot = realpathSync(String(
      process.env.UNBOUNDRY_TEST_REPOSITORY_ROOT ?? "",
    ));
    const originalRepositoryRoot = resolve(String(
      process.env.UNBOUNDRY_ORIGINAL_REPOSITORY_ROOT ?? "",
    ));
    const sentinelPath = realpathSync(String(
      process.env.UNBOUNDRY_SAFE_RUN_SENTINEL ?? "",
    ));
    const gateParent = realpathSync(resolve(rawGate, ".."));
    const gate = join(gateParent, rawGate.slice(rawGate.lastIndexOf(sep) + 1));
    const sentinel = lstatSync(sentinelPath);
    const gateParentDetails = lstatSync(gateParent, { bigint: true });
    const nonce = String(process.env.UNBOUNDRY_SAFE_RUN_NONCE ?? "");
    const expectedNodeOptions = `--import=${join(
      repositoryRoot,
      "scripts/offline-network-guard.mjs",
    )}`;
    sentinelDescriptor = openSync(
      sentinelPath,
      fileConstants.O_RDONLY | (fileConstants.O_NOFOLLOW ?? 0),
    );
    const buffer = Buffer.alloc(256);
    const bytesRead = readSync(
      sentinelDescriptor,
      buffer,
      0,
      buffer.length,
      0,
    );
    if (bytesRead === buffer.length) return undefined;
    const sentinelSource = buffer.toString("utf8", 0, bytesRead).trim();
    buffer.fill(0);
    if (
      nonce.length < 16 || sentinelSource !== nonce ||
      !sentinel.isFile() || sentinel.isSymbolicLink() || sentinel.nlink !== 1 ||
      typeof process.getuid !== "function" || sentinel.uid !== process.getuid() ||
      (sentinel.mode & 0o077) !== 0 ||
      !gateParentDetails.isDirectory() || gateParentDetails.isSymbolicLink() ||
      gateParentDetails.uid !== BigInt(process.getuid()) ||
      (gateParentDetails.mode & 0o022n) !== 0n ||
      !containsPath(systemTemporaryRoot, testRoot) ||
      !containsPath(testRoot, gateParent) ||
      !containsPath(systemTemporaryRoot, repositoryRoot) ||
      repositoryRoot === originalRepositoryRoot ||
      !containsPath(testRoot, sentinelPath) ||
      process.env.NODE_OPTIONS !== expectedNodeOptions
    ) return undefined;
    const pinnedGateParent = lstatSync(gateParent, { bigint: true });
    if (
      pinnedGateParent.dev !== gateParentDetails.dev ||
      pinnedGateParent.ino !== gateParentDetails.ino ||
      pinnedGateParent.uid !== gateParentDetails.uid ||
      pinnedGateParent.mode !== gateParentDetails.mode
    ) return undefined;
    return gate;
  } catch {
    return undefined;
  } finally {
    if (sentinelDescriptor !== undefined) closeSync(sentinelDescriptor);
  }
}

function apiFailure(
  request: IncomingMessage,
  response: ServerResponse,
  error: unknown,
  lifecycle: RuntimeLifecycle,
) {
  const known = error instanceof HttpRequestError;
  const status = known ? error.statusCode : 500;
  const code = known ? error.code : "INTERNAL_ERROR";
  const message = known ? error.message : "Internal server error";
  lifecycle.setResponseCode(request, code);
  if (response.writableEnded || response.destroyed) return;
  if (response.headersSent) {
    response.destroy();
    return;
  }
  response.statusCode = status;
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify({
    error: message,
    code,
    requestId: lifecycle.requestId(request),
  }));
}

function apiBoundary(
  routeId: string,
  handler: ApiHandler,
  runtime: RuntimeInstance,
) {
  const installedRuntime = runtime;
  return (
    request: IncomingMessage,
    response: ServerResponse,
    next: ApiNext,
  ) => {
    const lifecycle = installedRuntime.lifecycle;
    if (!lifecycle) {
      response.statusCode = 503;
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      response.end(JSON.stringify({
        code: "SERVICE_RUNTIME_UNAVAILABLE",
        error: "Runtime is unavailable",
      }));
      return;
    }
    lifecycle.setRouteId(request, routeId);
    void lifecycle
      .trackHandler(async () => {
        try {
          await handler(request, response, next);
        } catch (error) {
          apiFailure(request, response, error, lifecycle);
        }
      })
      .catch(() => {
        if (!response.destroyed) response.destroy();
      });
  };
}

type RuntimeServer = {
  close: () => Promise<void>;
  httpServer?: {
    closeAllConnections?: () => void;
    listening?: boolean;
    once: (event: "close" | "listening", listener: () => void) => void;
  } | null;
  middlewares: {
    use: (path: string, handler: (...args: any[]) => void) => void;
  };
};

function installSecurityHeaders(
  server: RuntimeServer,
  allowDevelopmentHmr: boolean,
) {
  server.middlewares.use("/", (request, response, next) => {
    const requestUrl = request.url ?? "";
    const [pathname, query = ""] = requestUrl.split("?", 2);
    const responsiveTarget =
      /^(?:1280x720|1440x900|1512x982|1920x1080)$/;
    const allowSameOriginChildFrames = allowDevelopmentHmr &&
      /^\/__responsive-preview\/(?:1280x720|1440x900|1512x982|1920x1080)$/.test(
        pathname ?? "",
      );
    const allowSameOriginEmbedding = allowDevelopmentHmr &&
      pathname === "/__fixture/shell.empty.primary" &&
      responsiveTarget.test(new URLSearchParams(query).get("embedded") ?? "");
    applySecurityHeaders(request, response, {
      allowDevelopmentHmr,
      allowSameOriginChildFrames,
      allowSameOriginEmbedding,
    });
    next();
  });
}

function runtimeFoundationApi(
  runtime: RuntimeInstance,
  allowDevelopmentHmr: boolean,
): Plugin {
  const install = async (server: RuntimeServer) => {
    const processOwner: ProcessRuntimeOwner = {
      runtime,
      token: Symbol("unboundry.runtime.owner"),
    };
    if (!claimProcessRuntimeOwner(processOwner)) {
      // This Vite instance already owns watcher/ws resources, even though it
      // must not create a second application runtime. Close only this raw
      // server; the installed runtime and its exact signal listener stay put.
      await server.close();
      throw new Error(
        "RUNTIME_RESTART_REQUIRED: close the current active runtime before starting another",
      );
    }
    if (runtime.lifecycle || runtime.roleCoordinator) {
      releaseProcessRuntimeOwner(processOwner);
      await server.close();
      throw new Error(
        "RUNTIME_RESTART_REQUIRED: runtime instance is already installed",
      );
    }
    let installedRoleCoordinator: RuntimeRoleCoordinator | undefined;
    let installedLifecycle: RuntimeLifecycle | undefined;
    let installedGenerationUnregister: (() => void) | undefined;
    try {
      installedRoleCoordinator = createRuntimeRoleCoordinator({
        dataDirectory: appDataDirectory(),
        role: runtimeRoleFromEnvironment(),
        ...(process.env.UNBOUNDRY_RUNTIME_DIR
          ? { runtimeDirectory: process.env.UNBOUNDRY_RUNTIME_DIR }
          : {}),
      });
      runtime.roleCoordinator = installedRoleCoordinator;
      if (
        installedRoleCoordinator.role() === "active" &&
        installedRoleCoordinator.snapshot().activeLeaseHeld
      ) {
        installedGenerationUnregister =
          registerGenerationRuntimeRoleCoordinator(installedRoleCoordinator);
        runtime.unregisterGeneration = installedGenerationUnregister;
      }
      installedLifecycle = createMainRuntimeLifecycle(
        runtime.generationStartupWorkerGate,
        installedRoleCoordinator,
      );
      runtime.lifecycle = installedLifecycle;
    } catch (error) {
      if (installedGenerationUnregister && installedRoleCoordinator) {
        try {
          unregisterGenerationRuntimeRoleCoordinatorBeforeStartup(
            installedRoleCoordinator,
          );
          installedGenerationUnregister();
        } catch {}
      }
      let coordinatorClosed = !installedRoleCoordinator;
      try {
        installedRoleCoordinator?.close();
        coordinatorClosed = true;
      } catch {}
      if (coordinatorClosed) {
        runtime.unregisterGeneration = undefined;
        runtime.roleCoordinator = undefined;
        runtime.lifecycle = undefined;
        releaseProcessRuntimeOwner(processOwner);
      }
      throw error;
    }
    const exactRoleCoordinator = installedRoleCoordinator;
    const exactLifecycle = installedLifecycle;
    let unregisterVersionLifecycle: () => void = () => undefined;
    const exactHealth = (kind: "live" | "ready") => apiBoundary(
      `health.${kind}`,
      (request, response, next) => {
        const remainder = (request.url ?? "").split("?", 1)[0] ?? "";
        if (remainder !== "" && remainder !== "/") {
          next();
          return;
        }
        exactLifecycle.healthApi(request, response, kind);
      },
      runtime,
    );
    let signalShutdownStarted = false;
    let closePromise: Promise<void> | undefined;
    const originalClose = server.close.bind(server);
    const removeRuntimeListeners = () => {
      process.removeListener("SIGTERM", onSigterm);
      process.removeListener("SIGINT", onSigint);
      unregisterVersionLifecycle();
    };
    const finalizeRuntimeTeardown = () => {
      installedGenerationUnregister?.();
      runtime.unregisterGeneration = undefined;
      runtime.roleCoordinator = undefined;
      runtime.lifecycle = undefined;
      releaseProcessRuntimeOwner(processOwner);
      removeRuntimeListeners();
    };
    const closeRuntime = () => {
      if (closePromise) return closePromise;
      closePromise = (async () => {
        const drained = await exactLifecycle.beginShutdown();
        if (!drained.drained) {
          throw new Error("Runtime shutdown did not drain");
        }
        // beginShutdown closes generation writers and releases the active
        // lease before Vite closes its listener. Admission is already frozen,
        // so a new owner cannot overlap old business work. Only after Vite
        // confirms close do we clear the coordinator identity for reload.
        await originalClose();
        finalizeRuntimeTeardown();
      })();
      return closePromise;
    };
    server.close = closeRuntime;
    const closeForSignal = () => {
      if (signalShutdownStarted) return;
      signalShutdownStarted = true;
      void coordinateRuntimeShutdown({
        beginShutdown: () => exactLifecycle.beginShutdown(),
        close: () => server.close(),
        closeAllConnections: () => server.httpServer?.closeAllConnections?.(),
        deadlineMs: exactLifecycle.getShutdownDeadlineMs(),
      }).then((exitCode) => process.exit(exitCode));
    };
    const onSigterm = () => closeForSignal();
    const onSigint = () => closeForSignal();
    try {
      // Security headers must precede health and lifecycle handlers because
      // those fail-closed handlers can end an API response without calling next.
      installSecurityHeaders(server, allowDevelopmentHmr);
      unregisterVersionLifecycle = registerVersionLifecycle(exactLifecycle);
      server.middlewares.use("/api/health/live", exactHealth("live"));
      server.middlewares.use("/api/health/ready", exactHealth("ready"));
      server.middlewares.use("/api", exactLifecycle.middleware);
      const viteSigtermListeners = server.httpServer
        ? process.listeners("SIGTERM").filter((listener) =>
            listener.name === "parentSigtermCallback"
          )
        : [];
      if (server.httpServer && viteSigtermListeners.length !== 1) {
        throw new Error("Unable to identify the Vite SIGTERM listener safely");
      }
      const [viteSigtermListener] = viteSigtermListeners;
      if (viteSigtermListener) {
        process.removeListener("SIGTERM", viteSigtermListener);
      }
      process.prependListener("SIGTERM", onSigterm);
      process.prependListener("SIGINT", onSigint);
      server.httpServer?.once("close", () => {
        removeRuntimeListeners();
      });
      if (
        process.env.UNBOUNDRY_SAFE_TEST === "1" &&
        process.env.UNBOUNDRY_TEST_RUNTIME_CONFIGURE_FAILURE === "1"
      ) {
        throw new Error("M81 controlled runtime configure failure");
      }
      greenfieldDatabaseStartup(exactLifecycle, exactRoleCoordinator);
      await mediaLifecycleStartupRecovery(
        exactLifecycle,
        exactRoleCoordinator,
      );
      persistentGenerationTaskStartup(
        server,
        exactLifecycle,
        exactRoleCoordinator,
        runtime.generationStartupWorkerGate,
      );
    } catch (error) {
      try {
        await closeRuntime();
      } catch {
        // Cleanup failure can mean an indeterminate lease. Preserve the
        // original startup error and keep that coordinator fail-closed.
      }
      throw error;
    }
  };
  return {
    enforce: "pre",
    name: "unboundry-runtime-foundation",
    configurePreviewServer(server) {
      return install(server as RuntimeServer);
    },
    configureServer(server) {
      return install(server as RuntimeServer);
    },
  };
}

function devFixtureApi(): Plugin {
  return {
    name: "unboundry-dev-fixture-api",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__fixture-api", async (request, response) => {
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("Content-Type", "application/json; charset=utf-8");

        let id: string;
        try {
          id = decodedRequestPath(request).replace(/^\/+/, "");
        } catch {
          response.statusCode = 400;
          response.end(JSON.stringify({ error: "Invalid fixture ID" }));
          return;
        }

        if (!/^[a-z0-9._-]+$/i.test(id)) {
          response.statusCode = 400;
          response.end(JSON.stringify({ error: "Invalid fixture ID" }));
          return;
        }

        try {
          const document = JSON.parse(
            await readFile(fixturePath, "utf8"),
          ) as FixtureDocument;
          const fixture = document.fixtures.find((candidate) => candidate.id === id) ??
            (implementationFixtureIds.has(id)
              ? { id, kind: "node", status: "PARTIAL" }
              : undefined);

          if (!fixture) {
            response.statusCode = 404;
            response.end(JSON.stringify({ error: "Fixture not found" }));
            return;
          }

          response.statusCode = 200;
          response.end(JSON.stringify({ fixture }));
        } catch {
          response.statusCode = 500;
          response.end(JSON.stringify({ error: "Fixture source unavailable" }));
        }
      });
    },
  };
}

function testDataDirectoryApi(runtime: RuntimeInstance): Plugin {
  const install = (middlewares: {
    use: (path: string, handler: (...args: any[]) => void) => void;
  }) => {
    middlewares.use("/api/test-data-directory", apiBoundary(
      "test-data-directory",
      (request, response) => {
      if (process.env.UNBOUNDRY_TEST_AUTH_BYPASS !== "1") {
        response.statusCode = 404;
        response.end("{}");
        return;
      }
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      response.end(
        JSON.stringify({ dataDirectory: appDataDirectory() }),
      );
      },
      runtime,
    ));
  };
  return {
    name: "unboundry-test-data-directory-api",
    configurePreviewServer(server) {
      install(server.middlewares);
    },
    configureServer(server) {
      install(server.middlewares);
    },
  };
}

function playlistExportApi(runtime: RuntimeInstance): Plugin {
  return {
    name: "unboundry-playlist-export-api",
    configurePreviewServer(server) {
      server.middlewares.use(
        "/api/playlist/export",
        apiBoundary("playlist.export", playlistExport, runtime),
      );
    },
    configureServer(server) {
      server.middlewares.use(
        "/api/playlist/export",
        apiBoundary("playlist.export", playlistExport, runtime),
      );
    },
  };
}

function authenticationApi(runtime: RuntimeInstance): Plugin {
  const install = (middlewares: {
    use: (path: string, handler: (...args: any[]) => void) => void;
  }) => {
    middlewares.use("/api/version", apiBoundary(
      "version",
      (request, response) => versionApi(request, response, "version"),
      runtime,
    ));
    middlewares.use("/api/updates", apiBoundary(
      "updates",
      (request, response) => versionApi(request, response, "updates"),
      runtime,
    ));
    middlewares.use("/api/auth", apiBoundary("auth", authApi, runtime));
    middlewares.use("/api", apiBoundary("auth-gate", authGate, runtime));
    middlewares.use(
      "/api/admin/users",
      apiBoundary("admin.users", adminUsersApi, runtime),
    );
    middlewares.use(
      "/api/account-context",
      apiBoundary("account.context", accountContextApi, runtime),
    );
    middlewares.use(
      "/api/account-credentials",
      apiBoundary("account.credentials", accountCredentialsApi, runtime),
    );
  };
  return {
    name: "unboundry-authentication-api",
    configurePreviewServer(server) {
      install(server.middlewares);
    },
    configureServer(server) {
      install(server.middlewares);
    },
  };
}

function modelCatalogApi(runtime: RuntimeInstance): Plugin {
  const install = (middlewares: {
    use: (path: string, handler: (...args: any[]) => void) => void;
  }) => {
    middlewares.use(
      "/api/admin/models",
      apiBoundary("admin.models", adminModelsApi, runtime),
    );
    middlewares.use("/api/models", apiBoundary("models", publicModelsApi, runtime));
  };
  return {
    name: "unboundry-model-catalog-api",
    configurePreviewServer(server) {
      install(server.middlewares);
    },
    configureServer(server) {
      install(server.middlewares);
    },
  };
}

function templatesApi(runtime: RuntimeInstance): Plugin {
  const install = (middlewares: {
    use: (path: string, handler: (...args: any[]) => void) => void;
  }) => {
    middlewares.use(
      "/api/admin/templates",
      apiBoundary("admin.templates", adminTemplatesApi, runtime),
    );
    middlewares.use(
      "/api/templates",
      apiBoundary("templates", templateCatalogApi, runtime),
    );
  };
  return {
    name: "unboundry-template-catalog-api",
    configurePreviewServer(server) {
      install(server.middlewares);
    },
    configureServer(server) {
      install(server.middlewares);
    },
  };
}

function agentConfigApi(runtime: RuntimeInstance): Plugin {
  const install = (middlewares: {
    use: (path: string, handler: (...args: any[]) => void) => void;
  }) => {
    middlewares.use(
      "/api/agent-config",
      apiBoundary("agent-config", agentConfigurationApi, runtime),
    );
  };
  return {
    name: "unboundry-agent-configuration-api",
    configurePreviewServer(server) {
      install(server.middlewares);
    },
    configureServer(server) {
      install(server.middlewares);
    },
  };
}

function charactersApi(runtime: RuntimeInstance): Plugin {
  const install = (middlewares: {
    use: (path: string, handler: (...args: any[]) => void) => void;
  }) => {
    middlewares.use(
      "/api/characters",
      apiBoundary("characters", characterCatalogApi, runtime),
    );
  };
  return {
    name: "unboundry-character-catalog-api",
    configurePreviewServer(server) {
      install(server.middlewares);
    },
    configureServer(server) {
      install(server.middlewares);
    },
  };
}

function libraryApi(runtime: RuntimeInstance): Plugin {
  const install = (middlewares: {
    use: (path: string, handler: (...args: any[]) => void) => void;
  }) => {
    middlewares.use(
      "/api/library",
      apiBoundary("library", libraryCatalogApi, runtime),
    );
  };
  return {
    name: "unboundry-library-catalog-api",
    configurePreviewServer(server) {
      install(server.middlewares);
    },
    configureServer(server) {
      install(server.middlewares);
    },
  };
}

function providerProfilesApi(runtime: RuntimeInstance): Plugin {
  const install = (middlewares: {
    use: (path: string, handler: (...args: any[]) => void) => void;
  }) => {
    middlewares.use(
      "/api/admin/providers",
      apiBoundary("admin.providers", adminProviderProfilesApi, runtime),
    );
  };
  return {
    name: "unboundry-provider-profiles-api",
    configurePreviewServer(server) {
      install(server.middlewares);
    },
    configureServer(server) {
      install(server.middlewares);
    },
  };
}

function providerCatalogApi(runtime: RuntimeInstance): Plugin {
  const install = (middlewares: {
    use: (path: string, handler: (...args: any[]) => void) => void;
  }) => {
    middlewares.use(
      "/api/admin/provider-catalog",
      apiBoundary("admin.provider-catalog", adminProviderCatalogApi, runtime),
    );
  };
  return {
    name: "unboundry-provider-catalog-api",
    configurePreviewServer(server) {
      install(server.middlewares);
    },
    configureServer(server) {
      install(server.middlewares);
    },
  };
}

function storageAdminApi(runtime: RuntimeInstance): Plugin {
  const install = (middlewares: {
    use: (path: string, handler: (...args: any[]) => void) => void;
  }) => {
    middlewares.use(
      "/api/admin/storage",
      apiBoundary("admin.storage", adminStorageApi, runtime),
    );
  };
  return {
    name: "unboundry-storage-admin-api",
    configurePreviewServer(server) {
      install(server.middlewares);
    },
    configureServer(server) {
      install(server.middlewares);
    },
  };
}

function generationSafetyAdminApi(runtime: RuntimeInstance): Plugin {
  const install = (middlewares: {
    use: (path: string, handler: (...args: any[]) => void) => void;
  }) => {
    middlewares.use(
      "/api/admin/generation-safety",
      apiBoundary("admin.generation-safety", adminGenerationSafetyApi, runtime),
    );
  };
  return {
    name: "unboundry-generation-safety-admin-api",
    configurePreviewServer(server) {
      install(server.middlewares);
    },
    configureServer(server) {
      install(server.middlewares);
    },
  };
}

function openApiPlugin(runtime: RuntimeInstance): Plugin {
  const install = (middlewares: {
    use: (path: string, handler: (...args: any[]) => void) => void;
  }) => {
    middlewares.use(
      "/api/openapi.json",
      apiBoundary("openapi", openApi, runtime),
    );
  };
  return {
    name: "unboundry-openapi",
    configurePreviewServer(server) {
      install(server.middlewares);
    },
    configureServer(server) {
      install(server.middlewares);
    },
  };
}

function playlistThumbnailApi(runtime: RuntimeInstance): Plugin {
  const handler = apiBoundary("playlist.thumbnails", playlistThumbnails, runtime);
  return {
    name: "unboundry-playlist-thumbnail-api",
    configurePreviewServer(server) {
      server.middlewares.use("/api/playlist/thumbnails", handler);
    },
    configureServer(server) {
      server.middlewares.use("/api/playlist/thumbnails", handler);
    },
  };
}

function canvasPersistenceApi(runtime: RuntimeInstance): Plugin {
  const canvasHandler = (
    request: Parameters<typeof canvasPersistence>[0],
    response: Parameters<typeof canvasPersistence>[1],
  ) => {
    if (/\/group-download(?:\?|$)/i.test(request.url ?? "")) {
      return groupDownloadApi(request, response);
    }
    return canvasPersistence(request, response);
  };
  const protectedCanvasHandler = apiBoundary("canvas", canvasHandler, runtime);
  const install = (middlewares: {
    use: (path: string, handler: (...args: any[]) => void) => void;
  }) => {
    middlewares.use("/api/canvas", protectedCanvasHandler);
    middlewares.use(
      "/api/history",
      apiBoundary("history", accountHistory, runtime),
    );
    middlewares.use(
      "/api/project-title",
      apiBoundary("project-title", projectTitle, runtime),
    );
    middlewares.use(
      "/api/projects",
      apiBoundary("projects", projectsApi, runtime),
    );
    middlewares.use(
      "/api/assets",
      apiBoundary("assets", assetStorage, runtime),
    );
    middlewares.use(
      "/api/audio-assets",
      apiBoundary("audio-assets", audioStorage, runtime),
    );
    middlewares.use(
      "/api/video-assets",
      apiBoundary("video-assets", videoStorage, runtime),
    );
    middlewares.use(
      "/api/media-metadata",
      apiBoundary("media-metadata", mediaMetadataApi, runtime),
    );
  };
  return {
    name: "unboundry-canvas-persistence-api",
    configurePreviewServer(server) {
      install(server.middlewares);
    },
    configureServer(server) {
      install(server.middlewares);
    },
  };
}

function generationTaskApi(runtime: RuntimeInstance): Plugin {
  const handler = apiBoundary("generation-tasks", generationTasks, runtime);
  return {
    name: "unboundry-generation-task-api",
    configurePreviewServer(server) {
      server.middlewares.use("/api/generation-tasks", handler);
    },
    configureServer(server) {
      server.middlewares.use("/api/generation-tasks", handler);
    },
  };
}

function persistentGenerationTaskStartup(
  server: RuntimeServer,
  installedLifecycle: RuntimeLifecycle,
  installedRoleCoordinator: RuntimeRoleCoordinator,
  generationStartupWorkerGate: GenerationStartupWorkerGate,
): void {
    const start = () => {
      if (
        installedLifecycle.getMode() !== "active" ||
        installedRoleCoordinator.role() !== "active" ||
        !installedRoleCoordinator.snapshot().activeLeaseHeld
      ) {
        generationStartupWorkerGate.state = "ready";
        return;
      }
      const startupProbe = createRuntimeLifecycle({
        legacyStandbyDatabaseGuard: databaseMatchesFrozenSchema37Contract,
        readinessDatabaseGuard: mediaLifecycleStartupRecoveryAllowsReadiness,
      }).probeDatabase();
      // Bind the main lifecycle to what startup observed before any background
      // writer can be initialized. In particular, observing schema 37 is a
      // process-lifetime restart latch: an external one-shot migration cannot
      // turn this already-running process into a schema-39 writer.
      const startupProcessCanBecomeActive =
        installedLifecycle.observeStartupDatabaseProbe(startupProbe);
      if (
        !startupProcessCanBecomeActive || !startupProbe.ok || startupProbe.standby
      ) {
        // The ordinary readiness probe retains the exact failure code. This
        // worker must not open a writer on old schema, restore markers, or a
        // failed media readiness gate.
        generationStartupWorkerGate.state = "deferred";
        return;
      }
      installedRoleCoordinator.assertActive("generation-worker");
      void initializePersistentGenerationTaskWorker().then(
        () => {
          generationStartupWorkerGate.state = "ready";
        },
        () => {
          generationStartupWorkerGate.state = "failed";
        },
      );
    };
    if (!server.httpServer) {
      generationStartupWorkerGate.state = "failed";
      return;
    }
    if (server.httpServer.listening) start();
    else server.httpServer.once("listening", start);
}

function greenfieldDatabaseStartup(
  installedLifecycle: RuntimeLifecycle,
  installedRoleCoordinator: RuntimeRoleCoordinator,
): void {
    // Maintenance is observation-only. Existing databases of every shape are
    // also left to standby/readiness classification by the database helper.
    if (
      installedLifecycle.getMode() !== "active" ||
      installedRoleCoordinator?.role() !== "active" ||
      !installedRoleCoordinator.snapshot().activeLeaseHeld
    ) return;
    installedRoleCoordinator.assertActive("database-initialize");
    initializeGreenfieldAppDatabaseAtProcessStartup();
}

async function mediaLifecycleStartupRecovery(
  installedLifecycle: RuntimeLifecycle,
  installedRoleCoordinator: RuntimeRoleCoordinator,
): Promise<void> {
    // Vite awaits async configure hooks before accepting requests. Unexpected
    // database failures therefore fail startup visibly; per-object physical
    // failures remain durable failed/compensating rows and do not become ready.
    if (
      installedRoleCoordinator?.role() !== "active" ||
      !installedRoleCoordinator.snapshot().activeLeaseHeld
    ) return;
    const recovery = await installedRoleCoordinator.runDetached(
      "writer",
      async () => {
        const controlledGate =
          process.env.UNBOUNDRY_TEST_MEDIA_STARTUP_RECOVERY_GATE;
        if (controlledGate) {
          const pinnedGate = safeMediaStartupRecoveryGate(controlledGate);
          if (!pinnedGate) {
            throw new Error("M81 media startup gate attestation failed");
          }
          await writeFile(`${pinnedGate}.entered`, "entered\n", {
            encoding: "utf8",
            flag: "wx",
          });
          for (;;) {
            try {
              await readFile(pinnedGate);
              break;
            } catch (error) {
              if (
                !(error instanceof Error && "code" in error &&
                  error.code === "ENOENT")
              ) throw error;
            }
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
        }
        return recoverMediaLifecycleAtProcessStartup();
      },
    );
    if (recovery.schemaMigrationRestartRequired) {
      installedLifecycle.requireRestartAfterStartupSchemaMigration();
    }
}

export default defineConfig(({ command, isPreview }) => {
  const runtime: RuntimeInstance = {
    generationStartupWorkerGate: { state: "pending" },
  };
  if (isPreview || process.env.NODE_ENV === "production") {
    const testOnlyEnvironmentVisible = Object.keys(process.env).some((name) =>
      name === "UNBOUNDRY_SAFE_TEST" || name.startsWith("UNBOUNDRY_TEST_"));
    if (testOnlyEnvironmentVisible) {
      throw new Error(productionTestEnvironmentError);
    }
  }
  // Config resolution is side-effect free: no data path, SQLite lease, writer,
  // or process-global lifecycle is opened here. Each plugin factory captures
  // this immutable per-config holder; build config loads therefore cannot alter
  // an already-running serve instance.
  return {
    root: fileURLToPath(new URL("./client", import.meta.url)),
    envDir: process.env.UNBOUNDRY_SAFE_TEST === "1" ? false : undefined,
    plugins: [
      // Install the lifecycle/close wrapper before any startup hook that can
      // reject. Programmatic createServer callers may catch such a rejection
      // without exiting the process, so the coordinator must remain closable.
      ...(command === "serve"
        ? [runtimeFoundationApi(runtime, !isPreview)]
        : []),
      react(),
      devFixtureApi(),
      testDataDirectoryApi(runtime),
      authenticationApi(runtime),
      openApiPlugin(runtime),
      modelCatalogApi(runtime),
      templatesApi(runtime),
      agentConfigApi(runtime),
      charactersApi(runtime),
      libraryApi(runtime),
      providerProfilesApi(runtime),
      providerCatalogApi(runtime),
      storageAdminApi(runtime),
      generationSafetyAdminApi(runtime),
      canvasPersistenceApi(runtime),
      generationTaskApi(runtime),
      playlistExportApi(runtime),
      playlistThumbnailApi(runtime),
    ],
    build: {
      outDir: fileURLToPath(new URL("./dist/client", import.meta.url)),
      emptyOutDir: true,
    },
    server: {
      fs: {
        strict: true,
        allow: [fileURLToPath(new URL("./client", import.meta.url))],
      },
    },
    preview: {
      allowedHosts: ["canvas.mymy.ltd"],
    },
    define: {
      __UNBOUNDRY_VERSION__: JSON.stringify(currentVersion),
    },
    cacheDir: process.env.UNBOUNDRY_VITE_CACHE_DIR ?? `${appRoot}/node_modules/.vite`,
  };
});

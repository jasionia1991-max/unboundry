import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { playlistExport } from "./server/playlistExport";
import { playlistThumbnails } from "./server/playlistThumbnails";
import { appDataDirectory } from "./server/database";
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
import { generationTasks } from "./server/generationTasks";
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
} from "./server/runtimeLifecycle";
import {
  currentVersion,
  registerVersionLifecycle,
  versionApi,
} from "./server/version";

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

const runtimeLifecycle = createRuntimeLifecycle();
type SignalListener = (...args: any[]) => void;
let capturedViteSigtermListener: SignalListener | undefined;
let restoreSigtermCapture: (() => void) | undefined;

// Vite 8.1.5 registers its named CLI SIGTERM coordinator after resolving the
// config and before invoking configureServer/configurePreviewServer. Capture
// that exact function at registration time; a count/diff heuristic could erase
// an unrelated host listener that happened to register during the same window.
function armViteSigtermCapture() {
  if (restoreSigtermCapture || capturedViteSigtermListener) return;
  const originalOnce = process.once;
  const interceptedOnce = function (
    this: NodeJS.Process,
    event: string | symbol,
    listener: SignalListener,
  ) {
    const result = Reflect.apply(originalOnce, this, [event, listener]) as NodeJS.Process;
    if (
      event === "SIGTERM" &&
      listener.name === "parentSigtermCallback"
    ) {
      capturedViteSigtermListener = listener;
      restoreSigtermCapture?.();
    }
    return result;
  };
  restoreSigtermCapture = () => {
    if (process.once === interceptedOnce) {
      Object.defineProperty(process, "once", {
        configurable: true,
        value: originalOnce,
        writable: true,
      });
    }
    restoreSigtermCapture = undefined;
  };
  Object.defineProperty(process, "once", {
    configurable: true,
    value: interceptedOnce,
    writable: true,
  });
}

function apiFailure(
  request: IncomingMessage,
  response: ServerResponse,
  error: unknown,
) {
  const known = error instanceof HttpRequestError;
  const status = known ? error.statusCode : 500;
  const code = known ? error.code : "INTERNAL_ERROR";
  const message = known ? error.message : "Internal server error";
  runtimeLifecycle.setResponseCode(request, code);
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
    requestId: runtimeLifecycle.requestId(request),
  }));
}

function apiBoundary(routeId: string, handler: ApiHandler) {
  return (
    request: IncomingMessage,
    response: ServerResponse,
    next: ApiNext,
  ) => {
    runtimeLifecycle.setRouteId(request, routeId);
    void runtimeLifecycle
      .trackHandler(async () => {
        try {
          await handler(request, response, next);
        } catch (error) {
          apiFailure(request, response, error);
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
    once: (event: "close", listener: () => void) => void;
  } | null;
  middlewares: {
    use: (path: string, handler: (...args: any[]) => void) => void;
  };
};

function runtimeFoundationApi(): Plugin {
  const install = (server: RuntimeServer) => {
    const unregisterVersionLifecycle = registerVersionLifecycle(runtimeLifecycle);
    const exactHealth = (kind: "live" | "ready") => apiBoundary(
      `health.${kind}`,
      (request, response, next) => {
        const remainder = (request.url ?? "").split("?", 1)[0] ?? "";
        if (remainder !== "" && remainder !== "/") {
          next();
          return;
        }
        runtimeLifecycle.healthApi(request, response, kind);
      },
    );
    server.middlewares.use("/api/health/live", exactHealth("live"));
    server.middlewares.use("/api/health/ready", exactHealth("ready"));
    server.middlewares.use("/api", runtimeLifecycle.middleware);

    let signalShutdownStarted = false;
    const closeForSignal = () => {
      if (signalShutdownStarted) return;
      signalShutdownStarted = true;
      void coordinateRuntimeShutdown({
        beginShutdown: () => runtimeLifecycle.beginShutdown(),
        close: () => server.close(),
        closeAllConnections: () => server.httpServer?.closeAllConnections?.(),
        deadlineMs: runtimeLifecycle.getShutdownDeadlineMs(),
      }).then((exitCode) => process.exit(exitCode));
    };
    const onSigterm = () => closeForSignal();
    const onSigint = () => closeForSignal();
    restoreSigtermCapture?.();
    const viteSigtermListener = capturedViteSigtermListener;
    capturedViteSigtermListener = undefined;
    if (!viteSigtermListener) {
      throw new Error(
        "Unable to identify the Vite SIGTERM listener safely",
      );
    }
    process.removeListener("SIGTERM", viteSigtermListener);
    process.prependListener("SIGTERM", onSigterm);
    process.prependListener("SIGINT", onSigint);
    server.httpServer?.once("close", () => {
      if (!signalShutdownStarted) {
        process.removeListener("SIGTERM", onSigterm);
        process.removeListener("SIGINT", onSigint);
      }
      unregisterVersionLifecycle();
    });
  };
  return {
    enforce: "pre",
    name: "unboundry-runtime-foundation",
    configurePreviewServer(server) {
      install(server as RuntimeServer);
    },
    configureServer(server) {
      install(server as RuntimeServer);
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

function testDataDirectoryApi(): Plugin {
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

function playlistExportApi(): Plugin {
  return {
    name: "unboundry-playlist-export-api",
    configurePreviewServer(server) {
      server.middlewares.use(
        "/api/playlist/export",
        apiBoundary("playlist.export", playlistExport),
      );
    },
    configureServer(server) {
      server.middlewares.use(
        "/api/playlist/export",
        apiBoundary("playlist.export", playlistExport),
      );
    },
  };
}

function authenticationApi(): Plugin {
  const install = (middlewares: {
    use: (path: string, handler: (...args: any[]) => void) => void;
  }) => {
    middlewares.use("/api/version", apiBoundary(
      "version",
      (request, response) => versionApi(request, response, "version"),
    ));
    middlewares.use("/api/updates", apiBoundary(
      "updates",
      (request, response) => versionApi(request, response, "updates"),
    ));
    middlewares.use("/api/auth", apiBoundary("auth", authApi));
    middlewares.use("/api", apiBoundary("auth-gate", authGate));
    middlewares.use(
      "/api/admin/users",
      apiBoundary("admin.users", adminUsersApi),
    );
    middlewares.use(
      "/api/account-context",
      apiBoundary("account.context", accountContextApi),
    );
    middlewares.use(
      "/api/account-credentials",
      apiBoundary("account.credentials", accountCredentialsApi),
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

function modelCatalogApi(): Plugin {
  const install = (middlewares: {
    use: (path: string, handler: (...args: any[]) => void) => void;
  }) => {
    middlewares.use(
      "/api/admin/models",
      apiBoundary("admin.models", adminModelsApi),
    );
    middlewares.use("/api/models", apiBoundary("models", publicModelsApi));
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

function templatesApi(): Plugin {
  const install = (middlewares: {
    use: (path: string, handler: (...args: any[]) => void) => void;
  }) => {
    middlewares.use(
      "/api/admin/templates",
      apiBoundary("admin.templates", adminTemplatesApi),
    );
    middlewares.use(
      "/api/templates",
      apiBoundary("templates", templateCatalogApi),
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

function agentConfigApi(): Plugin {
  const install = (middlewares: {
    use: (path: string, handler: (...args: any[]) => void) => void;
  }) => {
    middlewares.use(
      "/api/agent-config",
      apiBoundary("agent-config", agentConfigurationApi),
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

function charactersApi(): Plugin {
  const install = (middlewares: {
    use: (path: string, handler: (...args: any[]) => void) => void;
  }) => {
    middlewares.use(
      "/api/characters",
      apiBoundary("characters", characterCatalogApi),
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

function libraryApi(): Plugin {
  const install = (middlewares: {
    use: (path: string, handler: (...args: any[]) => void) => void;
  }) => {
    middlewares.use(
      "/api/library",
      apiBoundary("library", libraryCatalogApi),
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

function providerProfilesApi(): Plugin {
  const install = (middlewares: {
    use: (path: string, handler: (...args: any[]) => void) => void;
  }) => {
    middlewares.use(
      "/api/admin/providers",
      apiBoundary("admin.providers", adminProviderProfilesApi),
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

function providerCatalogApi(): Plugin {
  const install = (middlewares: {
    use: (path: string, handler: (...args: any[]) => void) => void;
  }) => {
    middlewares.use(
      "/api/admin/provider-catalog",
      apiBoundary("admin.provider-catalog", adminProviderCatalogApi),
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

function storageAdminApi(): Plugin {
  const install = (middlewares: {
    use: (path: string, handler: (...args: any[]) => void) => void;
  }) => {
    middlewares.use(
      "/api/admin/storage",
      apiBoundary("admin.storage", adminStorageApi),
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

function generationSafetyAdminApi(): Plugin {
  const install = (middlewares: {
    use: (path: string, handler: (...args: any[]) => void) => void;
  }) => {
    middlewares.use(
      "/api/admin/generation-safety",
      apiBoundary("admin.generation-safety", adminGenerationSafetyApi),
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

function openApiPlugin(): Plugin {
  const install = (middlewares: {
    use: (path: string, handler: (...args: any[]) => void) => void;
  }) => {
    middlewares.use(
      "/api/openapi.json",
      apiBoundary("openapi", openApi),
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

function playlistThumbnailApi(): Plugin {
  const handler = apiBoundary("playlist.thumbnails", playlistThumbnails);
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

function canvasPersistenceApi(): Plugin {
  const canvasHandler = (
    request: Parameters<typeof canvasPersistence>[0],
    response: Parameters<typeof canvasPersistence>[1],
  ) => {
    if (/\/group-download(?:\?|$)/i.test(request.url ?? "")) {
      return groupDownloadApi(request, response);
    }
    return canvasPersistence(request, response);
  };
  const protectedCanvasHandler = apiBoundary("canvas", canvasHandler);
  const install = (middlewares: {
    use: (path: string, handler: (...args: any[]) => void) => void;
  }) => {
    middlewares.use("/api/canvas", protectedCanvasHandler);
    middlewares.use(
      "/api/history",
      apiBoundary("history", accountHistory),
    );
    middlewares.use(
      "/api/project-title",
      apiBoundary("project-title", projectTitle),
    );
    middlewares.use(
      "/api/projects",
      apiBoundary("projects", projectsApi),
    );
    middlewares.use(
      "/api/assets",
      apiBoundary("assets", assetStorage),
    );
    middlewares.use(
      "/api/audio-assets",
      apiBoundary("audio-assets", audioStorage),
    );
    middlewares.use(
      "/api/video-assets",
      apiBoundary("video-assets", videoStorage),
    );
    middlewares.use(
      "/api/media-metadata",
      apiBoundary("media-metadata", mediaMetadataApi),
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

function generationTaskApi(): Plugin {
  const handler = apiBoundary("generation-tasks", generationTasks);
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

export default defineConfig(({ command }) => {
  if (command === "serve") armViteSigtermCapture();
  return {
    root: fileURLToPath(new URL("./client", import.meta.url)),
    envDir: process.env.UNBOUNDRY_SAFE_TEST === "1" ? false : undefined,
    plugins: [
      react(),
      devFixtureApi(),
      runtimeFoundationApi(),
      testDataDirectoryApi(),
      authenticationApi(),
      openApiPlugin(),
      modelCatalogApi(),
      templatesApi(),
      agentConfigApi(),
      charactersApi(),
      libraryApi(),
      providerProfilesApi(),
      providerCatalogApi(),
      storageAdminApi(),
      generationSafetyAdminApi(),
      canvasPersistenceApi(),
      generationTaskApi(),
      playlistExportApi(),
      playlistThumbnailApi(),
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

import { readFile } from "node:fs/promises";
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
import { adminGenerationSafetyApi } from "./server/generationSafety";
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

function devFixtureApi(): Plugin {
  return {
    name: "unboundry-dev-fixture-api",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__fixture-api", async (request, response) => {
        const id = decodeURIComponent((request.url ?? "").split("?")[0]).replace(
          /^\/+/,
          "",
        );

        response.setHeader("Cache-Control", "no-store");
        response.setHeader("Content-Type", "application/json; charset=utf-8");

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
    middlewares.use("/api/test-data-directory", (request, response) => {
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
    });
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
      server.middlewares.use("/api/playlist/export", (request, response) => {
        void playlistExport(request, response);
      });
    },
    configureServer(server) {
      server.middlewares.use("/api/playlist/export", (request, response) => {
        void playlistExport(request, response);
      });
    },
  };
}

function authenticationApi(): Plugin {
  const install = (middlewares: {
    use: (path: string, handler: (...args: any[]) => void) => void;
  }) => {
    middlewares.use("/api/auth", (request, response) => {
      void authApi(request, response);
    });
    middlewares.use("/api", (request, response, next) => {
      void authGate(request, response, next);
    });
    middlewares.use("/api/admin/users", (request, response) => {
      void adminUsersApi(request, response);
    });
    middlewares.use("/api/account-context", (request, response) => {
      accountContextApi(request, response);
    });
    middlewares.use("/api/account-credentials", (request, response) => {
      void accountCredentialsApi(request, response);
    });
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
    middlewares.use("/api/admin/models", (request, response) => {
      void adminModelsApi(request, response);
    });
    middlewares.use("/api/models", (request, response) => {
      void publicModelsApi(request, response);
    });
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
    middlewares.use("/api/admin/templates", (request, response) => {
      void adminTemplatesApi(request, response);
    });
    middlewares.use("/api/templates", (request, response) => {
      void templateCatalogApi(request, response);
    });
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
    middlewares.use("/api/agent-config", (request, response) => {
      agentConfigurationApi(request, response);
    });
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
    middlewares.use("/api/characters", (request, response) => {
      characterCatalogApi(request, response);
    });
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
    middlewares.use("/api/library", (request, response) => {
      libraryCatalogApi(request, response);
    });
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
    middlewares.use("/api/admin/providers", (request, response) => {
      void adminProviderProfilesApi(request, response);
    });
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
    middlewares.use("/api/admin/provider-catalog", (request, response) => {
      void adminProviderCatalogApi(request, response);
    });
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
    middlewares.use("/api/admin/storage", (request, response) => {
      void adminStorageApi(request, response);
    });
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
    middlewares.use("/api/admin/generation-safety", (request, response) => {
      void adminGenerationSafetyApi(request, response);
    });
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
    middlewares.use("/api/openapi.json", (request, response) => {
      openApi(request, response);
    });
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
  const handler = (request: Parameters<typeof playlistThumbnails>[0], response: Parameters<typeof playlistThumbnails>[1]) => {
    void playlistThumbnails(request, response);
  };
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
      void groupDownloadApi(request, response);
      return;
    }
    void canvasPersistence(request, response);
  };
  return {
    name: "unboundry-canvas-persistence-api",
    configurePreviewServer(server) {
      server.middlewares.use("/api/canvas", canvasHandler);
      server.middlewares.use("/api/history", (request, response) => {
        void accountHistory(request, response);
      });
      server.middlewares.use("/api/project-title", (request, response) => {
        void projectTitle(request, response);
      });
      server.middlewares.use("/api/projects", (request, response) => {
        void projectsApi(request, response);
      });
      server.middlewares.use("/api/assets", (request, response) => {
        void assetStorage(request, response);
      });
      server.middlewares.use("/api/audio-assets", (request, response) => {
        void audioStorage(request, response);
      });
      server.middlewares.use("/api/video-assets", (request, response) => {
        void videoStorage(request, response);
      });
      server.middlewares.use("/api/media-metadata", (request, response) => {
        mediaMetadataApi(request, response);
      });
    },
    configureServer(server) {
      server.middlewares.use("/api/canvas", canvasHandler);
      server.middlewares.use("/api/history", (request, response) => {
        void accountHistory(request, response);
      });
      server.middlewares.use("/api/project-title", (request, response) => {
        void projectTitle(request, response);
      });
      server.middlewares.use("/api/projects", (request, response) => {
        void projectsApi(request, response);
      });
      server.middlewares.use("/api/assets", (request, response) => {
        void assetStorage(request, response);
      });
      server.middlewares.use("/api/audio-assets", (request, response) => {
        void audioStorage(request, response);
      });
      server.middlewares.use("/api/video-assets", (request, response) => {
        void videoStorage(request, response);
      });
      server.middlewares.use("/api/media-metadata", (request, response) => {
        mediaMetadataApi(request, response);
      });
    },
  };
}

function generationTaskApi(): Plugin {
  const handler = (
    request: Parameters<typeof generationTasks>[0],
    response: Parameters<typeof generationTasks>[1],
  ) => {
    void generationTasks(request, response);
  };
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

export default defineConfig({
    root: fileURLToPath(new URL("./client", import.meta.url)),
    plugins: [
      react(),
      devFixtureApi(),
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
    cacheDir: `${appRoot}/node_modules/.vite`,
});

import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, test } from "@playwright/test";
import { authGate } from "../server/auth";
import {
  appDataDirectory,
  currentSchemaVersion,
} from "../server/database";
import {
  adminModelsApi,
  publicModelsApi,
} from "../server/modelCatalog";
import { importProviderCatalogDrafts } from "../server/providerCatalog";
import { saveProviderProfile } from "../server/providerProfiles";

type ApiResult = {
  body: Record<string, any>;
  status: number;
};

function databaseAt(directory: string, readOnly = false) {
  return new DatabaseSync(join(directory, "unboundry.sqlite"), { readOnly });
}

async function startLifecycleServer() {
  const server = createServer((request, response) => {
    const route = request.url ?? "/";
    const dispatch = () => {
      if (route.startsWith("/api/admin/models")) {
        request.url = route.slice("/api/admin/models".length) || "/";
        void adminModelsApi(request, response);
        return;
      }
      if (route.startsWith("/api/models")) {
        request.url = route.slice("/api/models".length) || "/";
        void publicModelsApi(request, response);
        return;
      }
      response.statusCode = 404;
      response.end();
    };
    void authGate(request, response, dispatch);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Lifecycle test server has no TCP address");
  }
  return {
    origin: `http://127.0.0.1:${address.port}`,
    server,
  };
}

async function stopServer(server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function api(
  origin: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<ApiResult> {
  const response = await fetch(`${origin}${path}`, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    method,
  });
  const text = await response.text();
  return {
    body: text ? JSON.parse(text) as Record<string, any> : {},
    status: response.status,
  };
}

test("model archive, restore and guarded deletion preserve identity and never call a Provider", async () => {
  const directory = await mkdtemp(join(tmpdir(), "unboundry-model-lifecycle-"));
  const previousDataDirectory = process.env.UNBOUNDRY_DATA_DIR;
  const previousBypass = process.env.UNBOUNDRY_TEST_AUTH_BYPASS;
  process.env.UNBOUNDRY_DATA_DIR = directory;
  process.env.UNBOUNDRY_TEST_AUTH_BYPASS = "1";
  let server: Server | undefined;
  try {
    expect(appDataDirectory()).toBe(directory);
    const profile = await saveProviderProfile({
      apiKey: `lifecycle-${randomUUID()}`,
      baseUrl: "https://openrouter.ai/api/v1",
      driver: "openrouter",
      label: "Lifecycle Provider",
    });
    const started = await startLifecycleServer();
    server = started.server;
    const { origin } = started;

    expect((await api(origin, "GET", "/api/admin/models")).status).toBe(200);
    const store = databaseAt(directory);
    try {
      expect(store.prepare("PRAGMA user_version").get()).toEqual({
        user_version: currentSchemaVersion,
      });
      const columns = store.prepare("PRAGMA table_info(model_profiles)")
        .all() as Array<{ name: string }>;
      expect(columns.map((column) => column.name)).toEqual(
        expect.arrayContaining(["archived_at", "published_at"]),
      );
      const triggers = store.prepare(`
        SELECT name FROM sqlite_master
        WHERE type = 'trigger' AND name IN (
          'archived_models_cannot_enable_binding_update',
          'generation_tasks_capture_model_display_name',
          'model_profiles_capture_first_publish_update'
        )
        ORDER BY name
      `).all() as Array<{ name: string }>;
      expect(triggers.map((trigger) => trigger.name)).toHaveLength(3);
    } finally {
      store.close();
    }

    const createModel = async (
      name: string,
      options: { isDefault?: boolean; status?: "draft" | "published" } = {},
    ) => {
      const created = await api(origin, "POST", "/api/admin/models", {
        capability: "text",
        displayName: name,
        isDefault: options.isDefault ?? false,
        maxCostMicrounits: 0,
        providerModelId: `test/${name.toLowerCase().replaceAll(" ", "-")}`,
        providerProfileId: profile.id,
        sortOrder: 100,
        status: options.status ?? "draft",
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      return created.body.model as {
        archived: boolean;
        archivedAt?: string;
        everPublished: boolean;
        id: string;
        status: string;
      };
    };

    const reversible = await createModel(
      "Reversible Model",
      { status: "published" },
    );
    expect(reversible.everPublished).toBe(true);
    const publishedArchive = await api(
      origin,
      "POST",
      `/api/admin/models/${reversible.id}/archive`,
    );
    expect(publishedArchive).toMatchObject({
      body: {
        code: "MODEL_NOT_DISABLED",
        error: expect.stringContaining("请先停用"),
      },
      status: 409,
    });
    expect((await api(
      origin,
      "PATCH",
      `/api/admin/models/${reversible.id}`,
      { status: "disabled" },
    )).status).toBe(200);
    const archived = await api(
      origin,
      "POST",
      `/api/admin/models/${reversible.id}/archive`,
    );
    expect(archived.status).toBe(200);
    expect(archived.body).toMatchObject({
      model: { archived: true, id: reversible.id },
      paidProviderRequests: 0,
    });
    const archivedPublic = await api(
      origin,
      "GET",
      "/api/models?capability=text",
    );
    expect(archivedPublic.body.models.map((model: { id: string }) => model.id))
      .not.toContain(reversible.id);
    const archivedStore = databaseAt(directory);
    try {
      expect(archivedStore.prepare(`
        SELECT enabled, is_default
        FROM node_model_bindings WHERE model_id = ?
      `).get(reversible.id)).toEqual({ enabled: 0, is_default: 0 });
      expect(() => archivedStore.prepare(`
        UPDATE node_model_bindings SET enabled = 1 WHERE model_id = ?
      `).run(reversible.id)).toThrow(/archived model binding/);
    } finally {
      archivedStore.close();
    }
    const restored = await api(
      origin,
      "POST",
      `/api/admin/models/${reversible.id}/restore`,
    );
    expect(restored.status).toBe(200);
    expect(restored.body.model).toMatchObject({
      archived: false,
      id: reversible.id,
      status: "disabled",
    });
    expect((await api(
      origin,
      "PATCH",
      `/api/admin/models/${reversible.id}`,
      { status: "published" },
    )).status).toBe(200);
    const restoredPublic = await api(
      origin,
      "GET",
      "/api/models?capability=text",
    );
    expect(restoredPublic.body.models.map((model: { id: string }) => model.id))
      .toContain(reversible.id);

    const defaultModel = await createModel(
      "Default Guard",
      { isDefault: true, status: "published" },
    );
    const defaultDelete = await api(
      origin,
      "DELETE",
      `/api/admin/models/${defaultModel.id}`,
    );
    expect(defaultDelete).toMatchObject({
      body: { code: "DEFAULT_MODEL" },
      status: 409,
    });
    const defaultArchive = await api(
      origin,
      "POST",
      `/api/admin/models/${defaultModel.id}/archive`,
    );
    expect(defaultArchive).toMatchObject({
      body: { code: "DEFAULT_MODEL" },
      status: 409,
    });

    expect((await api(
      origin,
      "PATCH",
      `/api/admin/models/${reversible.id}`,
      { status: "disabled" },
    )).status).toBe(200);
    const publishedDelete = await api(
      origin,
      "DELETE",
      `/api/admin/models/${reversible.id}`,
    );
    expect(publishedDelete).toMatchObject({
      body: { code: "EVER_PUBLISHED" },
      status: 409,
    });

    const canvasModel = await createModel("Canvas Guard");
    const canvasStore = databaseAt(directory);
    try {
      const timestamp = new Date().toISOString();
      canvasStore.prepare(`
        INSERT INTO canvas_documents (
          owner_id, id, revision, nodes, edges, viewport, updated_at
        )
        VALUES ('__test__', 'model-lifecycle-canvas', 1, ?, '[]', ?, ?)
      `).run(
        JSON.stringify([{
          data: { textModelId: canvasModel.id },
          id: "text-model-lifecycle",
          type: "text",
        }]),
        JSON.stringify({ x: 0, y: 0, zoom: 1 }),
        timestamp,
      );
    } finally {
      canvasStore.close();
    }
    const canvasDelete = await api(
      origin,
      "DELETE",
      `/api/admin/models/${canvasModel.id}`,
    );
    expect(canvasDelete).toMatchObject({
      body: {
        code: "CANVAS_REFERENCED",
        references: { canvasDocuments: 1 },
      },
      status: 409,
    });

    const historyModel = await createModel("History Guard");
    const activeModel = await createModel("Active Guard");
    const taskStore = databaseAt(directory);
    try {
      const insertTask = taskStore.prepare(`
        INSERT INTO generation_tasks (
          id, canvas_id, node_id, kind, prompt, model, parameters,
          idempotency_key, request_fingerprint, state, attempt,
          created_at, updated_at, owner_id, cost_currency,
          model_configuration
        )
        VALUES (?, ?, ?, 'text', 'test prompt', ?, '{}', ?, ?, ?, 0,
          ?, ?, '__test__', 'USD', ?)
      `);
      const timestamp = new Date().toISOString();
      insertTask.run(
        "history-model-task",
        "history-model-canvas",
        "history-model-node",
        historyModel.id,
        "history-model-key",
        "history-model-fingerprint",
        "success",
        timestamp,
        timestamp,
        JSON.stringify({ modelId: historyModel.id }),
      );
      insertTask.run(
        "active-model-task",
        "active-model-canvas",
        "active-model-node",
        activeModel.id,
        "active-model-key",
        "active-model-fingerprint",
        "queued",
        timestamp,
        timestamp,
        JSON.stringify({ modelId: activeModel.id }),
      );
      const snapshot = taskStore.prepare(`
        SELECT model_configuration
        FROM generation_tasks WHERE id = 'history-model-task'
      `).get() as { model_configuration: string };
      expect(JSON.parse(snapshot.model_configuration)).toMatchObject({
        displayName: "History Guard",
        modelId: historyModel.id,
      });
    } finally {
      taskStore.close();
    }
    expect((await api(
      origin,
      "PATCH",
      `/api/admin/models/${historyModel.id}`,
      { displayName: "History Guard Renamed" },
    )).status).toBe(200);
    const snapshotAfterRename = databaseAt(directory, true);
    try {
      const row = snapshotAfterRename.prepare(`
        SELECT model_configuration
        FROM generation_tasks WHERE id = 'history-model-task'
      `).get() as { model_configuration: string };
      expect(JSON.parse(row.model_configuration).displayName).toBe("History Guard");
    } finally {
      snapshotAfterRename.close();
    }
    expect(await api(
      origin,
      "DELETE",
      `/api/admin/models/${historyModel.id}`,
    )).toMatchObject({
      body: { code: "HISTORICAL_TASKS" },
      status: 409,
    });
    expect(await api(
      origin,
      "DELETE",
      `/api/admin/models/${activeModel.id}`,
    )).toMatchObject({
      body: { code: "ACTIVE_TASKS" },
      status: 409,
    });

    const lifecycleCatalog = await api(origin, "GET", "/api/admin/models");
    expect(lifecycleCatalog.status).toBe(200);
    const lifecycleModels = lifecycleCatalog.body.models as Array<{
      canDelete: boolean;
      deleteBlockedCode?: string;
      deleteBlockedReason?: string;
      id: string;
      references: {
        activeTasks: number;
        canvasDocuments: number;
        tasks: number;
      };
    }>;
    expect(lifecycleModels.find((model) => model.id === canvasModel.id))
      .toMatchObject({
        canDelete: false,
        deleteBlockedCode: "CANVAS_REFERENCED",
        references: { activeTasks: 0, canvasDocuments: 1, tasks: 0 },
      });
    expect(lifecycleModels.find((model) => model.id === historyModel.id))
      .toMatchObject({
        canDelete: false,
        deleteBlockedCode: "HISTORICAL_TASKS",
        references: { activeTasks: 0, canvasDocuments: 0, tasks: 1 },
      });
    expect(lifecycleModels.find((model) => model.id === activeModel.id))
      .toMatchObject({
        canDelete: false,
        deleteBlockedCode: "ACTIVE_TASKS",
        references: { activeTasks: 1, canvasDocuments: 0, tasks: 1 },
      });

    const deletable = await createModel("Delete Draft");
    expect(await api(
      origin,
      "DELETE",
      `/api/admin/models/${deletable.id}`,
    )).toMatchObject({
      body: { code: "NOT_ARCHIVED" },
      status: 409,
    });
    expect((await api(
      origin,
      "POST",
      `/api/admin/models/${deletable.id}/archive`,
    )).status).toBe(200);
    expect(await api(
      origin,
      "DELETE",
      `/api/admin/models/${deletable.id}`,
    )).toEqual({
      body: {
        deleted: true,
        id: deletable.id,
        paidProviderRequests: 0,
      },
      status: 200,
    });

    const catalogStore = databaseAt(directory);
    const catalogProviderModelId = "catalog/recoverable-model";
    try {
      const timestamp = new Date().toISOString();
      catalogStore.prepare(`
        UPDATE provider_profiles
        SET
          catalog_key_status = 'valid',
          catalog_checked_at = ?,
          catalog_synced_at = ?,
          catalog_models = ?,
          catalog_model_count = 1
        WHERE id = ?
      `).run(
        timestamp,
        timestamp,
        JSON.stringify([{
          capability: "text",
          discoveryId: `openrouter:${catalogProviderModelId}`,
          displayName: "Catalog Recoverable",
          providerModelId: catalogProviderModelId,
          source: "openrouter-account-catalog",
          status: "available",
        }]),
        profile.id,
      );
    } finally {
      catalogStore.close();
    }
    expect(await importProviderCatalogDrafts(profile.id, [{
      discoveryId: `openrouter:${catalogProviderModelId}`,
    }], "__test__")).toEqual({ imported: 1, skipped: 0 });
    const importedStore = databaseAt(directory, true);
    let importedModelId = "";
    try {
      importedModelId = String((importedStore.prepare(`
        SELECT id FROM model_profiles
        WHERE provider_profile_id = ? AND provider_model_id = ?
      `).get(profile.id, catalogProviderModelId) as { id: string }).id);
    } finally {
      importedStore.close();
    }
    expect((await api(
      origin,
      "POST",
      `/api/admin/models/${importedModelId}/archive`,
    )).status).toBe(200);
    expect(await importProviderCatalogDrafts(profile.id, [{
      discoveryId: `openrouter:${catalogProviderModelId}`,
    }], "__test__")).toEqual({ imported: 0, restored: 1, skipped: 0 });
    const recoveredStore = databaseAt(directory, true);
    try {
      expect(recoveredStore.prepare(`
        SELECT
          COUNT(*) AS count,
          MIN(id) AS id,
          MIN(archived_at) AS archived_at,
          MIN(status) AS status
        FROM model_profiles
        WHERE provider_profile_id = ? AND provider_model_id = ?
      `).get(profile.id, catalogProviderModelId)).toEqual({
        archived_at: null,
        count: 1,
        id: importedModelId,
        status: "draft",
      });
      expect(recoveredStore.prepare(`
        SELECT enabled, is_default
        FROM node_model_bindings WHERE model_id = ?
      `).get(importedModelId)).toEqual({ enabled: 0, is_default: 0 });
      expect(recoveredStore.prepare(`
        SELECT COUNT(*) AS count FROM generation_provider_attempts
      `).get()).toEqual({ count: 0 });
      const actions = recoveredStore.prepare(`
        SELECT action FROM admin_audit_events
        WHERE action IN (
          'model.archive', 'model.restore', 'model.delete',
          'model.delete_rejected', 'model.archive_rejected'
        )
      `).all() as Array<{ action: string }>;
      expect(actions.map((row) => row.action)).toEqual(
        expect.arrayContaining([
          "model.archive",
          "model.restore",
          "model.delete",
          "model.delete_rejected",
          "model.archive_rejected",
        ]),
      );
    } finally {
      recoveredStore.close();
    }
  } finally {
    if (server) await stopServer(server);
    if (previousDataDirectory === undefined) delete process.env.UNBOUNDRY_DATA_DIR;
    else process.env.UNBOUNDRY_DATA_DIR = previousDataDirectory;
    if (previousBypass === undefined) delete process.env.UNBOUNDRY_TEST_AUTH_BYPASS;
    else process.env.UNBOUNDRY_TEST_AUTH_BYPASS = previousBypass;
    await rm(directory, { force: true, recursive: true });
  }
});

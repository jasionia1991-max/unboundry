import { createServer, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, test } from "@playwright/test";
import { authGate } from "../server/auth";
import { appDataDirectory } from "../server/database";
import { adminModelsApi } from "../server/modelCatalog";
import { saveProviderProfile } from "../server/providerProfiles";

async function startModelServer() {
  const server = createServer((request, response) => {
    const route = request.url ?? "/";
    const dispatch = () => {
      if (!route.startsWith("/api/admin/models")) {
        response.statusCode = 404;
        response.end();
        return;
      }
      request.url = route.slice("/api/admin/models".length) || "/";
      void adminModelsApi(request, response);
    };
    void authGate(request, response, dispatch);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test address");
  return { origin: `http://127.0.0.1:${address.port}`, server };
}

async function stopServer(server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function api(origin: string, method: string, path: string, body?: unknown) {
  const response = await fetch(`${origin}${path}`, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    method,
  });
  return {
    body: JSON.parse(await response.text()) as Record<string, any>,
    status: response.status,
  };
}

test("relay models persist an explicit compatible protocol without Provider requests", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tapnow-relay-model-protocol-"));
  const previousDirectory = process.env.TAPNOW_DATA_DIR;
  const previousBypass = process.env.TAPNOW_TEST_AUTH_BYPASS;
  process.env.TAPNOW_DATA_DIR = directory;
  process.env.TAPNOW_TEST_AUTH_BYPASS = "1";
  let server: Server | undefined;
  try {
    expect(appDataDirectory()).toBe(directory);
    const profile = await saveProviderProfile({
      apiKey: "relay-model-fixture-key",
      baseUrl: "https://api.example.test/v1",
      driver: "multi-protocol-relay",
      label: "Relay model fixture",
    });
    const started = await startModelServer();
    server = started.server;
    const createBody = {
      capability: "text",
      displayName: "Claude Relay Fixture",
      isDefault: false,
      maxCostMicrounits: 1_000_000,
      providerModelId: "claude-fixture-v1",
      providerProfileId: profile.id,
      providerProtocol: "claude-messages",
      sortOrder: 100,
      status: "draft",
    };
    const created = await api(started.origin, "POST", "/api/admin/models", createBody);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.model).toMatchObject({
      capability: "text",
      parameterSchema: {
        fields: [
          expect.objectContaining({ defaultValue: "text", key: "inputMode" }),
          expect.objectContaining({ defaultValue: 64, key: "maxOutputTokens" }),
          expect.objectContaining({ defaultValue: 0, key: "temperature" }),
          expect.objectContaining({ defaultValue: 1, key: "outputCount" }),
        ],
      },
      providerDriver: "multi-protocol-relay",
      providerProtocol: "claude-messages",
      status: "draft",
    });

    const missingProtocol = await api(started.origin, "POST", "/api/admin/models", {
      ...createBody,
      displayName: "Missing protocol",
      providerModelId: "missing-protocol-v1",
      providerProtocol: undefined,
    });
    expect(missingProtocol.status).toBe(400);
    const incompatible = await api(started.origin, "POST", "/api/admin/models", {
      ...createBody,
      displayName: "Wrong protocol",
      providerModelId: "wrong-protocol-v1",
      providerProtocol: "gpt-image",
    });
    expect(incompatible.status).toBe(400);

    const updated = await api(
      started.origin,
      "PATCH",
      `/api/admin/models/${created.body.model.id}`,
      { providerProtocol: "openai-responses" },
    );
    expect(updated.status, JSON.stringify(updated.body)).toBe(200);
    expect(updated.body.model.providerProtocol).toBe("openai-responses");

    const incompatibleSchema = structuredClone(
      updated.body.model.parameterSchema,
    );
    incompatibleSchema.upstreamInputs.video = {
      limitMode: "fixed",
      maxCount: 1,
      supported: true,
    };
    const rejectedPublish = await api(
      started.origin,
      "PATCH",
      `/api/admin/models/${created.body.model.id}`,
      { parameterSchema: incompatibleSchema, status: "published" },
    );
    expect(rejectedPublish.status).toBe(400);

    const multiOutputSchema = structuredClone(
      updated.body.model.parameterSchema,
    );
    const outputCount = multiOutputSchema.fields.find(
      (field: { key: string }) => field.key === "outputCount",
    );
    outputCount.options.push({ label: "2×", value: 2 });
    const rejectedMultiOutput = await api(
      started.origin,
      "PATCH",
      `/api/admin/models/${created.body.model.id}`,
      { parameterSchema: multiOutputSchema, status: "published" },
    );
    expect(rejectedMultiOutput.status).toBe(400);

    const unboundedTextSchema = structuredClone(
      updated.body.model.parameterSchema,
    );
    unboundedTextSchema.fields.find(
      (field: { key: string }) => field.key === "maxOutputTokens",
    ).options.push({ label: "8192 Token", value: 8192 });
    const rejectedUnboundedText = await api(
      started.origin,
      "PATCH",
      `/api/admin/models/${created.body.model.id}`,
      { parameterSchema: unboundedTextSchema, status: "published" },
    );
    expect(rejectedUnboundedText.status).toBe(400);

    const ttsCreated = await api(started.origin, "POST", "/api/admin/models", {
      capability: "audio",
      displayName: "Doubao TTS 2.0 Fixture",
      isDefault: false,
      maxCostMicrounits: 1_000_000,
      providerModelId: "doubao-tts-2.0",
      providerProfileId: profile.id,
      providerProtocol: "media-generate",
      sortOrder: 110,
      status: "draft",
    });
    expect(ttsCreated.status, JSON.stringify(ttsCreated.body)).toBe(201);
    expect(ttsCreated.body.model.parameterSchema.fields.map(
      (field: { defaultValue: unknown; key: string }) => [field.key, field.defaultValue],
    )).toEqual([
      ["inputMode", "text"],
      ["speaker", "zh_female_vv_uranus_bigtts"],
      ["speechRate", "0"],
      ["emotion", "auto"],
      ["emotionScale", 4],
      ["format", "mp3"],
      ["outputCount", 1],
    ]);
    expect(ttsCreated.body.model.parameterSchema.fields.map(
      (field: { key: string }) => field.key,
    )).not.toEqual(expect.arrayContaining(["duration", "audioMode"]));

    const store = new DatabaseSync(join(directory, "tapnow.sqlite"), { readOnly: true });
    try {
      expect(store.prepare(`
        SELECT provider_protocol FROM model_profiles WHERE id = ?
      `).get(created.body.model.id)).toEqual({
        provider_protocol: "openai-responses",
      });
      expect(store.prepare(`
        SELECT COUNT(*) AS count FROM generation_provider_attempts
      `).get()).toEqual({ count: 0 });
      expect(store.prepare(`
        SELECT COUNT(*) AS count FROM generation_tasks
      `).get()).toEqual({ count: 0 });
    } finally {
      store.close();
    }
  } finally {
    if (server) await stopServer(server);
    if (previousDirectory === undefined) delete process.env.TAPNOW_DATA_DIR;
    else process.env.TAPNOW_DATA_DIR = previousDirectory;
    if (previousBypass === undefined) delete process.env.TAPNOW_TEST_AUTH_BYPASS;
    else process.env.TAPNOW_TEST_AUTH_BYPASS = previousBypass;
    await rm(directory, { force: true, recursive: true });
  }
});

import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type { ClientRequest, IncomingMessage } from "node:http";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { DatabaseSync } from "node:sqlite";
import { expect, test } from "@playwright/test";
import { authGate } from "../server/auth";
import { appDataDirectory } from "../server/database";
import {
  assertPublicHttpsDestination,
  fetchPublicHttps,
  privateNetworkAddress,
} from "../server/outboundNetwork";
import {
  adminProviderCatalogApi,
  getProviderCatalog,
  getProviderReadOnlyDescriptor,
  importProviderCatalogDrafts,
  readProviderReadOnlyResource,
  syncProviderCatalog,
} from "../server/providerCatalog";
import {
  saveProviderProfile,
  verifyProviderProfile,
} from "../server/providerProfiles";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

test("outbound destination guard rejects IPv6 transition and mixed private DNS answers", async () => {
  for (const address of [
    "::ffff:7f00:1",
    "::ffff:8.8.8.8",
    "::192.168.1.1",
    "64:ff9b::7f00:1",
    "2002:7f00:1::",
    "fec0::1",
    "ff02::1",
  ]) {
    expect(privateNetworkAddress(address), address).toBe(true);
  }
  expect(privateNetworkAddress("2001:4860:4860::8888")).toBe(false);
  await expect(assertPublicHttpsDestination(
    "https://mixed.public.invalid/v1/models",
    async () => [
      { address: "8.8.8.8", family: 4 },
      { address: "::ffff:7f00:1", family: 6 },
    ],
  )).rejects.toMatchObject({ code: "FORMAT" });
});

test("secure HTTPS transport pins the validated IPv4 or IPv6 answer and returns a standard Response", async () => {
  for (const destination of [
    { address: "8.8.8.8", family: 4 as const },
    { address: "2001:4860:4860::8888", family: 6 as const },
  ]) {
    const observed: Array<{
      address: string | unknown[];
      family?: number;
      hostname: string;
    }> = [];
    const requester = ((
      url: URL,
      options: {
        lookup?: (
          hostname: string,
          lookupOptions: { all?: boolean; family?: number },
          callback: (
            error: Error | null,
            address: string | unknown[],
            family?: number,
          ) => void,
        ) => void;
      },
      respond: (response: IncomingMessage) => void,
    ) => {
      const request = new EventEmitter() as ClientRequest;
      request.end = (() => {
        options.lookup?.(
          url.hostname,
          { family: destination.family },
          (error, address, family) => {
            if (error) {
              request.emit("error", error);
              return;
            }
            observed.push({ address, family, hostname: url.hostname });
            const incoming = Readable.from([
              Buffer.from(JSON.stringify({ pinned: true }), "utf8"),
            ]) as IncomingMessage;
            Object.assign(incoming, {
              rawHeaders: ["Content-Type", "application/json"],
              statusCode: 200,
              statusMessage: "OK",
            });
            respond(incoming);
          },
        );
        return request;
      }) as ClientRequest["end"];
      return request;
    }) as NonNullable<
      Parameters<typeof fetchPublicHttps>[2]
    >["requester"];
    const response = await fetchPublicHttps(
      "https://pinned.relay.invalid/v1/jobs",
      { body: "{}", method: "POST", redirect: "error" },
      {
        requester,
        resolver: async () => [destination],
      },
    );
    expect(response).toBeInstanceOf(Response);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ pinned: true });
    expect(observed).toEqual([{
      address: destination.address,
      family: destination.family,
      hostname: "pinned.relay.invalid",
    }]);
  }
});

test("secure HTTPS transport aborts unresolved DNS at its timeout without opening a request", async () => {
  let requestCount = 0;
  await expect(fetchPublicHttps(
    "https://timeout.relay.invalid/v1/models",
    { method: "GET" },
    {
      requester: (() => {
        requestCount += 1;
        throw new Error("must not open a request");
      }) as NonNullable<Parameters<typeof fetchPublicHttps>[2]>["requester"],
      resolver: () => new Promise(() => undefined),
      timeoutMs: 5,
    },
  )).rejects.toMatchObject({ name: "TimeoutError" });
  expect(requestCount).toBe(0);
});

async function temporaryDataDirectory<T>(run: (directory: string) => Promise<T>) {
  const directory = await mkdtemp(join(tmpdir(), "tapnow-relay-server-"));
  const previous = process.env.TAPNOW_DATA_DIR;
  process.env.TAPNOW_DATA_DIR = directory;
  try {
    expect(appDataDirectory()).toBe(directory);
    return await run(directory);
  } finally {
    if (previous === undefined) delete process.env.TAPNOW_DATA_DIR;
    else process.env.TAPNOW_DATA_DIR = previous;
    await rm(directory, { force: true, recursive: true });
  }
}

test("multi-protocol relay verifies, syncs enhanced and fallback catalogs, and exposes only bounded read-only summaries", async () => {
  await temporaryDataDirectory(async (directory) => {
    const secret = `relay-${randomUUID()}`;
    const profile = await saveProviderProfile({
      apiKey: secret,
      baseUrl: "https://api.relay.example",
      driver: "multi-protocol-relay",
      label: "Relay",
    });
    const verificationRequests: Array<{
      authorization: string | null;
      method: string | undefined;
      url: string;
    }> = [];
    const verification = await verifyProviderProfile(profile.id, (async (
      input,
      init,
    ) => {
      const headers = new Headers(init?.headers);
      verificationRequests.push({
        authorization: headers.get("Authorization"),
        method: init?.method,
        url: String(input),
      });
      return jsonResponse({
        models: [{
          id: "zeta/image-model",
          name: "Zeta Image",
          output_modalities: ["image"],
          pricing: { currency: "USD", image: "0.02" },
          protocols: ["gpt-image"],
          type: "图片",
        }],
        total: 1,
        type: "list",
      });
    }) as typeof fetch);
    expect(verification.modelCount).toBe(1);
    expect(verificationRequests).toEqual([{
      authorization: `Bearer ${secret}`,
      method: "GET",
      url: "https://api.relay.example/v1/skills/models",
    }]);

    const syncRequests: Array<{ method: string | undefined; url: string }> = [];
    const synced = await syncProviderCatalog(profile.id, (async (input, init) => {
      syncRequests.push({ method: init?.method, url: String(input) });
      return jsonResponse({
        models: [{
          id: "same/model",
          name: "Sparse duplicate",
        }, {
          id: "same/model",
          input_modalities: ["image", "text"],
          name: "Rich duplicate",
          output_modalities: ["text"],
          pricing_hint: "0.01 / request",
          protocols: ["openai-chat", "claude-messages", "not-supported"],
          type: "chat",
        }, {
          id: "alpha/video-model",
          modalities: ["video"],
          protocol: "media-generate",
          type: "视频",
        }, {
          id: secret,
          name: "must never be exposed",
          protocols: ["openai-chat"],
        }],
        total: 4,
        type: "list",
      });
    }) as typeof fetch);
    expect(syncRequests).toEqual([{
      method: "GET",
      url: "https://api.relay.example/v1/skills/models",
    }]);
    expect(synced.controlPlaneRequests).toBe(1);
    expect(synced.catalog.models.map((model) => model.providerModelId)).toEqual([
      "alpha/video-model",
      "same/model",
    ]);
    expect(synced.catalog.models[0]).toMatchObject({
      capability: "video",
      discoveryId: "multi-protocol-relay:alpha/video-model",
      metadata: {
        modalities: ["video"],
        modelType: "视频",
        protocols: ["media-generate"],
      },
      source: "multi-protocol-relay-account-catalog",
    });
    expect(synced.catalog.models[1]).toMatchObject({
      capability: "text",
      displayName: "Rich duplicate",
      metadata: {
        inputModalities: ["image", "text"],
        modelType: "chat",
        outputModalities: ["text"],
        pricingSummary: "0.01 / request",
        protocols: ["openai-chat", "claude-messages"],
      },
    });
    expect(synced.catalog).toMatchObject({
      credentialMode: "profile-api-key",
      keyStatus: "valid",
      modelCount: 2,
      scope: "account",
      supported: true,
      supportsImport: true,
      supportsReadOnlyManagement: true,
      supportsSync: true,
    });
    expect(JSON.stringify(synced)).not.toContain(secret);

    const actorUserId = "relay-admin-fixture";
    const actorStore = new DatabaseSync(join(directory, "tapnow.sqlite"));
    try {
      const timestamp = new Date().toISOString();
      actorStore.prepare(`
        INSERT INTO users (
          id, login_name, display_name, password_hash,
          role, status, created_at, updated_at
        ) VALUES (?, 'relay-admin', 'Relay Admin', 'test-only-hash',
          'admin', 'active', ?, ?)
      `).run(actorUserId, timestamp, timestamp);
    } finally {
      actorStore.close();
    }
    const imported = await importProviderCatalogDrafts(
      profile.id,
      [
        {
          discoveryId: "multi-protocol-relay:same/model",
          providerProtocol: "openai-chat",
        },
        {
          discoveryId: "multi-protocol-relay:same/model",
          providerProtocol: "claude-messages",
        },
        {
          discoveryId: "multi-protocol-relay:alpha/video-model",
          providerProtocol: "media-generate",
        },
      ],
      actorUserId,
    );
    expect(imported).toEqual({ imported: 3, skipped: 0 });
    const importedStore = new DatabaseSync(join(directory, "tapnow.sqlite"), {
      readOnly: true,
    });
    try {
      expect(importedStore.prepare(`
        SELECT provider_model_id, provider_protocol, capability, status
        FROM model_profiles
        WHERE provider_profile_id = ?
        ORDER BY provider_model_id, provider_protocol
      `).all(profile.id)).toEqual([
        {
          capability: "video",
          provider_model_id: "alpha/video-model",
          provider_protocol: "media-generate",
          status: "draft",
        },
        {
          capability: "text",
          provider_model_id: "same/model",
          provider_protocol: "claude-messages",
          status: "draft",
        },
        {
          capability: "text",
          provider_model_id: "same/model",
          provider_protocol: "openai-chat",
          status: "draft",
        },
      ]);
    } finally {
      importedStore.close();
    }

    const fallbackProfile = await saveProviderProfile({
      apiKey: `fallback-${randomUUID()}`,
      baseUrl: "https://fallback.relay.example/v1",
      driver: "multi-protocol-relay",
      label: "Fallback relay",
    });
    const fallbackRequests: string[] = [];
    const fallback = await syncProviderCatalog(
      fallbackProfile.id,
      (async (input, init) => {
        expect(init?.method).toBe("GET");
        fallbackRequests.push(String(input));
        return fallbackRequests.length === 1
          ? jsonResponse({ error: "not found" }, 404)
          : jsonResponse({ data: [{ id: "basic-only" }] });
      }) as typeof fetch,
    );
    expect(fallbackRequests).toEqual([
      "https://fallback.relay.example/v1/skills/models",
      "https://fallback.relay.example/v1/models",
    ]);
    expect(fallback.controlPlaneRequests).toBe(2);
    expect(fallback.catalog.models).toEqual([{
      capability: "unknown",
      discoveryId: "multi-protocol-relay:basic-only",
      displayName: "basic-only",
      providerModelId: "basic-only",
      source: "multi-protocol-relay-account-catalog",
      status: "available",
    }]);
    expect(await importProviderCatalogDrafts(
      fallbackProfile.id,
      [{
        capability: "text",
        discoveryId: "multi-protocol-relay:basic-only",
        providerProtocol: "openai-chat",
      }],
      actorUserId,
    )).toEqual({ imported: 1, skipped: 0 });
    const fallbackStore = new DatabaseSync(join(directory, "tapnow.sqlite"), {
      readOnly: true,
    });
    try {
      expect(fallbackStore.prepare(`
        SELECT capability, provider_model_id, provider_protocol, status
        FROM model_profiles
        WHERE provider_profile_id = ?
      `).get(fallbackProfile.id)).toEqual({
        capability: "text",
        provider_model_id: "basic-only",
        provider_protocol: "openai-chat",
        status: "draft",
      });
    } finally {
      fallbackStore.close();
    }

    const descriptor = await getProviderReadOnlyDescriptor(profile.id);
    expect(descriptor).toEqual({
      available: true,
      paidGenerationRequests: 0,
      providerReadOnlyRequests: 0,
      resources: {
        balance: { supported: true },
        modelDetail: { requiresModel: true, supported: true },
        pricing: { requiresModel: true, supported: true },
        taskStatus: { supported: true },
        usage: { supported: true },
      },
    });

    const managementRequests: Array<{
      authorization: string | null;
      method: string | undefined;
      url: string;
    }> = [];
    const managementFetcher = (async (input, init) => {
      const headers = new Headers(init?.headers);
      managementRequests.push({
        authorization: headers.get("Authorization"),
        method: init?.method,
        url: String(input),
      });
      const url = String(input);
      if (url.endsWith("/skills/balance")) {
        return jsonResponse({
          data: { available_balance: "12.50", currency: "USD" },
          status: secret,
          raw_private_note: secret,
        });
      }
      if (url.endsWith("/skills/usage")) {
        return jsonResponse({ data: { input_tokens: 12, output_tokens: 4 } });
      }
      if (url.endsWith("/skills/task-status")) {
        return jsonResponse({ data: [{ status: "running" }, { status: "done" }] });
      }
      if (url.includes("/pricing")) {
        return jsonResponse({ data: { currency: "USD", price: "0.02", unit: "request" } });
      }
      return jsonResponse({ undocumented_secret: secret });
    }) as typeof fetch;

    const balance = await readProviderReadOnlyResource(
      profile.id,
      "balance",
      {},
      managementFetcher,
    );
    expect(balance).toMatchObject({
      available: true,
      paidGenerationRequests: 0,
      parsed: true,
      providerReadOnlyRequests: 1,
      resource: "balance",
      summary: { balance: "12.50", currency: "USD" },
    });
    expect(JSON.stringify(balance)).not.toContain(secret);

    const usage = await readProviderReadOnlyResource(
      profile.id,
      "usage",
      {},
      managementFetcher,
    );
    expect(usage.summary).toEqual({ inputTokens: 12, outputTokens: 4 });

    const taskStatus = await readProviderReadOnlyResource(
      profile.id,
      "task-status",
      {},
      managementFetcher,
    );
    expect(taskStatus.summary).toEqual({
      itemCount: 2,
      statusCounts: { done: 1, running: 1 },
    });

    const pricing = await readProviderReadOnlyResource(
      profile.id,
      "pricing",
      { model: "vendor/model" },
      managementFetcher,
    );
    expect(pricing.summary).toEqual({
      cost: "0.02",
      currency: "USD",
      unit: "request",
    });

    const unknown = await readProviderReadOnlyResource(
      profile.id,
      "model-detail",
      { model: "vendor/model" },
      managementFetcher,
    );
    expect(unknown).toMatchObject({
      available: true,
      parsed: false,
      providerReadOnlyRequests: 1,
      resource: "model-detail",
    });
    expect(unknown).not.toHaveProperty("summary");
    expect(JSON.stringify(unknown)).not.toContain(secret);
    expect(managementRequests).toEqual([
      {
        authorization: `Bearer ${secret}`,
        method: "GET",
        url: "https://api.relay.example/v1/skills/balance",
      },
      {
        authorization: `Bearer ${secret}`,
        method: "GET",
        url: "https://api.relay.example/v1/skills/usage",
      },
      {
        authorization: `Bearer ${secret}`,
        method: "GET",
        url: "https://api.relay.example/v1/skills/task-status",
      },
      {
        authorization: `Bearer ${secret}`,
        method: "GET",
        url: "https://api.relay.example/v1/skills/models/vendor%2Fmodel/pricing",
      },
      {
        authorization: `Bearer ${secret}`,
        method: "GET",
        url: "https://api.relay.example/v1/skills/models/vendor%2Fmodel",
      },
    ]);

    const previousBypass = process.env.TAPNOW_TEST_AUTH_BYPASS;
    process.env.TAPNOW_TEST_AUTH_BYPASS = "1";
    const server = createServer((request, response) => {
      void authGate(request, response, () => {
        void adminProviderCatalogApi(request, response);
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("No port");
      const response = await fetch(
        `http://127.0.0.1:${address.port}/${profile.id}/readonly`,
      );
      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).not.toContain(secret);
      expect(JSON.parse(text)).toMatchObject({
        available: true,
        paidGenerationRequests: 0,
        providerReadOnlyRequests: 0,
      });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (previousBypass === undefined) delete process.env.TAPNOW_TEST_AUTH_BYPASS;
      else process.env.TAPNOW_TEST_AUTH_BYPASS = previousBypass;
    }

    expect(await getProviderCatalog(profile.id)).toMatchObject({ modelCount: 2 });
    await saveProviderProfile({
      apiKey: `${secret}-changed`,
      baseUrl: profile.baseUrl,
      driver: profile.driver,
      label: profile.label,
    }, profile.id);
    await expect(importProviderCatalogDrafts(
      profile.id,
      [{
        discoveryId: "multi-protocol-relay:same/model",
        providerProtocol: "openai-responses",
      }],
      actorUserId,
    )).rejects.toThrow(/synchronized again/);
    const store = new DatabaseSync(join(directory, "tapnow.sqlite"), {
      readOnly: true,
    });
    try {
      expect(store.prepare(`
        SELECT COUNT(*) AS count FROM generation_provider_attempts
      `).get()).toEqual({ count: 0 });
      expect(store.prepare(`
        SELECT COUNT(*) AS count FROM generation_tasks
      `).get()).toEqual({ count: 0 });
    } finally {
      store.close();
    }
  });
});

test("relay authentication failures do not fall back or expose the remote response", async () => {
  await temporaryDataDirectory(async () => {
    const secret = `relay-auth-${randomUUID()}`;
    const profile = await saveProviderProfile({
      apiKey: secret,
      baseUrl: "https://auth.relay.example/v1",
      driver: "multi-protocol-relay",
      label: "Relay auth",
    });
    const requests: string[] = [];
    await expect(verifyProviderProfile(profile.id, (async (input, init) => {
      expect(init?.method).toBe("GET");
      requests.push(String(input));
      return jsonResponse({ error: secret }, 401);
    }) as typeof fetch)).rejects.toMatchObject({ code: "AUTH" });
    expect(requests).toEqual([
      "https://auth.relay.example/v1/skills/models",
    ]);

    const privateProfile = await saveProviderProfile({
      apiKey: `private-${randomUUID()}`,
      baseUrl: "https://127.0.0.1/v1",
      driver: "multi-protocol-relay",
      label: "Private relay",
    });
    let privateRequestCount = 0;
    await expect(verifyProviderProfile(privateProfile.id, (async () => {
      privateRequestCount += 1;
      return jsonResponse({ models: [] });
    }) as typeof fetch)).rejects.toMatchObject({ code: "FORMAT" });
    expect(privateRequestCount).toBe(0);
  });
});

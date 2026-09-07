import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "./safe-test";
import { AccountMutationBlockedError } from "../server/accountMutationFence";
import { currentSchemaVersion, openAppDatabase } from "../server/database";
import {
  archivePublicTemplate,
  deletePublicTemplate,
  restorePublicTemplate,
  savePublicTemplate,
  updatePublicTemplate,
} from "../server/adminTemplates";
import {
  auditPublicTemplateCompatibility,
  auditStoredPublicTemplates,
  PublicTemplateCompatibilityError,
} from "../server/templateCompatibility";
import {
  listPublicTemplates,
  publicTemplateCard,
  validTemplateGraph,
} from "../server/templateCatalog";
import { knownModelParameterSchema } from "../types/modelParameters";

const port = Number(process.env.UNBOUNDRY_TEST_AUX_PORT);
const origin = `http://127.0.0.1:${port}`;
const vite = join(process.cwd(), "node_modules/vite/bin/vite.js");

async function startServer(dataDirectory: string) {
  const child = spawn(
    process.execPath,
    [vite, "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
    {
      env: {
        ...process.env,
        UNBOUNDRY_DATA_DIR: dataDirectory,
        UNBOUNDRY_TEST_AUTH_BYPASS: undefined,
      },
      stdio: "ignore",
    },
  );
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) break;
    try {
      if ((await fetch(`${origin}/api/auth/status`)).ok) return child;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  child.kill("SIGTERM");
  throw new Error("Public template test server did not start");
}

async function stopServer(child: ChildProcess) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise((resolve) => child.once("exit", resolve));
}

function cookie(response: Response) {
  return response.headers.get("set-cookie")?.split(";")[0] ?? "";
}

function request(
  path: string,
  options: RequestInit & { cookie?: string } = {},
) {
  const { cookie: session, ...init } = options;
  return fetch(`${origin}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(session ? { Cookie: session } : {}),
      ...init.headers,
    },
  });
}

function timestamp() {
  return new Date().toISOString();
}

function uploadPlaceholderGraph() {
  return {
    edges: [
      {
        data: { inputOrder: 1, inputRole: "prompt" },
        id: "pub-edge-1",
        source: "pub-text",
        sourceHandle: "source",
        target: "pub-image",
        targetHandle: "target",
        type: "cuttable",
      },
    ],
    nodes: [
      {
        data: { label: "Group", title: "公共模板组" },
        id: "pub-group",
        position: { x: 0, y: 0 },
        style: { height: 348, width: 548 },
        type: "group",
        zIndex: 0,
      },
      {
        data: { label: "Text", title: "说明", textPrompt: "上传位说明" },
        id: "pub-text",
        parentId: "pub-group",
        position: { x: 20, y: 20 },
        style: { height: 250, width: 250 },
        type: "text",
        zIndex: 1,
      },
      {
        data: { label: "Image", title: "上传位图片" },
        id: "pub-image",
        parentId: "pub-group",
        position: { x: 300, y: 20 },
        style: { height: 250, width: 250 },
        type: "image",
        zIndex: 1,
      },
    ],
    version: 1,
  };
}

function markedUploadPlaceholderGraph(marker: string) {
  const graph = structuredClone(uploadPlaceholderGraph());
  const textNode = graph.nodes.find((node) => node.type === "text");
  if (!textNode) throw new Error("upload placeholder graph is missing text node");
  textNode.data = {
    ...textNode.data,
    textPrompt: `上传位说明 ${marker}`,
    title: `说明 ${marker}`,
  };
  return graph;
}

async function createAdminUiTemplate(
  page: any,
  title: string,
  marker: string,
) {
  const response = await page.request.post("/api/admin/templates", {
    data: {
      category: ["工具"],
      description: `隔离回归夹具 ${marker}`,
      graph: markedUploadPlaceholderGraph(marker),
      title,
    },
  });
  expect(response.status()).toBe(201);
  const body = await response.json() as { template: { id: string } };
  return { id: body.template.id, marker, title };
}

async function readAdminUiTemplate(
  page: any,
  id: string,
) {
  const response = await page.request.get(
    "/api/admin/templates?limit=100&offset=0&includeGraph=true",
  );
  expect(response.ok()).toBeTruthy();
  const body = await response.json() as {
    items: Array<{
      graph?: Record<string, unknown>;
      id: string;
      status: string;
      title: string;
    }>;
  };
  const item = body.items.find((candidate) => candidate.id === id);
  if (!item) throw new Error(`fixture template ${id} is missing`);
  return item;
}

function readPublicTemplateDbRow(dataDirectory: string, id: string) {
  const store = openAppDatabase(dataDirectory);
  try {
    const row = store.prepare(`
      SELECT id, title, graph, status
      FROM public_templates
      WHERE id = ?
    `).get(id) as {
      graph: string;
      id: string;
      status: string;
      title: string;
    } | undefined;
    if (!row) throw new Error(`public template row ${id} is missing`);
    return row;
  } finally {
    store.close();
  }
}

function countPublicTemplateRows(dataDirectory: string, title: string) {
  const store = openAppDatabase(dataDirectory);
  try {
    return Number((store.prepare(`
      SELECT COUNT(*) AS count
      FROM public_templates
      WHERE title = ?
    `).get(title) as { count: number }).count);
  } finally {
    store.close();
  }
}

async function adminGraphListPayload(page: any) {
  const response = await page.request.get(
    "/api/admin/templates?limit=100&offset=0&includeGraph=true",
  );
  expect(response.ok()).toBeTruthy();
  return JSON.stringify(await response.json());
}

function graphPayloadForTemplate(
  payload: string,
  id: string,
  marker: string,
) {
  const body = JSON.parse(payload) as {
    items: Array<{ graph?: unknown; id: string }>;
  };
  const item = body.items.find((candidate) => candidate.id === id);
  if (!item) throw new Error(`fixture template ${id} is missing from graph list`);
  item.graph = markedUploadPlaceholderGraph(marker);
  return JSON.stringify(body);
}

function graphPayloadWithoutTemplate(payload: string, id: string) {
  const body = JSON.parse(payload) as {
    items: Array<{ id: string }>;
    pagination?: { total?: number };
  };
  body.items = body.items.filter((item) => item.id !== id);
  if (body.pagination?.total !== undefined) {
    body.pagination.total = body.items.length;
  }
  return JSON.stringify(body);
}

function graphPayloadMissingGraph(payload: string, id: string) {
  const body = JSON.parse(payload) as {
    items: Array<{ graph?: unknown; id: string }>;
  };
  const item = body.items.find((candidate) => candidate.id === id);
  if (!item) throw new Error(`fixture template ${id} is missing from graph list`);
  delete item.graph;
  return JSON.stringify(body);
}

async function ignoreAdminGraphAbort(page: any) {
  await page.evaluate(() => {
    const scope = window as Window & {
      __unboundryAdminGraphAbortIgnored?: boolean;
      __unboundryAdminGraphJsonConsumed?: Record<string, number>;
      __unboundryAdminGraphToken?: number;
    };
    if (scope.__unboundryAdminGraphAbortIgnored) return;
    scope.__unboundryAdminGraphJsonConsumed = {};
    scope.__unboundryAdminGraphToken = 0;
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const requestUrl = typeof input === "string"
        ? input
        : input instanceof Request
          ? input.url
          : input.toString();
      const url = new URL(requestUrl, window.location.href);
      if (
        /^\/api\/admin\/templates\/[a-f0-9-]{36}$/i.test(url.pathname) &&
        (init?.method ?? "GET") === "GET"
      ) {
        const token = String(
          (scope.__unboundryAdminGraphToken ?? 0) + 1,
        );
        scope.__unboundryAdminGraphToken = Number(token);
        const headers = new Headers(init?.headers);
        headers.set("X-Unboundry-Test-Graph-Token", token);
        const response = await originalFetch(input, {
          ...init,
          headers,
          signal: undefined,
        });
        const originalJson = response.json.bind(response);
        Object.defineProperty(response, "json", {
          configurable: true,
          value: async () => {
            const body = await originalJson();
            const consumed = scope.__unboundryAdminGraphJsonConsumed ?? {};
            consumed[token] = (consumed[token] ?? 0) + 1;
            scope.__unboundryAdminGraphJsonConsumed = consumed;
            return body;
          },
        });
        return response;
      }
      return originalFetch(input, init);
    };
    scope.__unboundryAdminGraphAbortIgnored = true;
  });
}

async function adminGraphJsonConsumed(page: any, token: string) {
  return page.evaluate((value: string) => {
    const scope = window as Window & {
      __unboundryAdminGraphJsonConsumed?: Record<string, number>;
    };
    return scope.__unboundryAdminGraphJsonConsumed?.[value] ?? 0;
  }, token);
}

async function installAdminGraphReadGate(page: any, defaultBody: string) {
  const pending: Array<{
    done: Promise<void>;
    finish: () => void;
    token: string;
    respond: (response: {
      body: string;
      status: number;
    }) => void;
  }> = [];
  const handler = async (route: any) => {
    const url = new URL(route.request().url());
    if (
      !/^\/api\/admin\/templates\/[a-f0-9-]{36}$/i.test(url.pathname) ||
      route.request().method() !== "GET"
    ) {
      await route.continue();
      return;
    }
    let respond!: (response: { body: string; status: number }) => void;
    let finish!: () => void;
    const responseReady = new Promise<{ body: string; status: number }>((resolve) => {
      respond = resolve;
    });
    const done = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const token = route.request().headers()["x-unboundry-test-graph-token"] ?? "";
    pending.push({ done, finish, respond, token });
    const response = await responseReady;
    try {
      const payload = JSON.parse(response.body);
      // The fixture list is test data only; the product now reads one exact ID.
      const body = Array.isArray(payload.items)
        ? JSON.stringify({ template: payload.items.find((item: { id: string }) => item.id === url.pathname.split("/").at(-1)) })
        : response.body;
      await route.fulfill({ body, contentType: "application/json", status: response.status });
    } finally {
      finish();
    }
  };
  await page.route("**/api/admin/templates**", handler);
  return {
    dispose: async () => {
      await page.unroute("**/api/admin/templates**", handler);
    },
    pending,
    release: async (
      index: number,
      response: { body?: string; status?: number } = {},
    ) => {
      const item = pending[index];
      if (!item) throw new Error(`missing deferred graph response ${index}`);
      if (!item.token) {
        throw new Error("deferred graph response is missing its test token");
      }
      item.respond({
        body: response.body ?? defaultBody,
        status: response.status ?? 200,
      });
      await item.done;
      await expect
        .poll(() => adminGraphJsonConsumed(page, item.token))
        .toBeGreaterThan(0);
      await waitForUiRender(page);
    },
    releaseForDocumentNavigation: async (
      index: number,
      response: { body?: string; status?: number } = {},
    ) => {
      const item = pending[index];
      if (!item) throw new Error(`missing deferred graph response ${index}`);
      item.respond({
        body: response.body ?? defaultBody,
        status: response.status ?? 200,
      });
      await item.done;
    },
  };
}

async function installAdminListReadGate(page: any) {
  const prefix = `tpl-list-${randomUUID()}`;
  await page.evaluate(() => {
    const scope = window as Window & {
      __tplListConsumed?: string[];
      __tplListOriginalFetch?: typeof fetch;
    };
    scope.__tplListConsumed = [];
    const originalFetch = window.fetch.bind(window);
    scope.__tplListOriginalFetch = originalFetch;
    window.fetch = async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input instanceof Request ? input.url : input.toString(), location.href);
      const response = await originalFetch(input, url.pathname === "/api/admin/templates"
        ? { ...init, signal: undefined } : init);
      const token = response.headers.get("x-tpl-list-token");
      if (token) {
        const originalJson = response.json.bind(response);
        Object.defineProperty(response, "json", {
          configurable: true,
          value: async () => {
            const body = await originalJson();
            scope.__tplListConsumed?.push(token);
            return body;
          },
        });
      }
      return response;
    };
  });
  const pending: Array<{
    respond: (body: string) => void;
    done: Promise<void>;
    token: string;
  }> = [];
  const handler = async (route: any) => {
    const url = new URL(route.request().url());
    if (
      pending.length >= 2 ||
      route.request().method() !== "GET" ||
      url.pathname !== "/api/admin/templates" ||
      url.searchParams.get("includeGraph") !== "false"
    ) {
      await route.fallback();
      return;
    }
    let respond!: (body: string) => void;
    let finish!: () => void;
    const bodyReady = new Promise<string>((resolve) => {
      respond = resolve;
    });
    const done = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const token = `${prefix}-${pending.length}`;
    pending.push({ respond, done, token });
    try {
      await route.fulfill({
        body: await bodyReady,
        contentType: "application/json",
        headers: { "x-tpl-list-token": token },
        status: 200,
      });
    } finally {
      finish();
    }
  };
  await page.route("**/api/admin/templates**", handler);
  return {
    pending,
    release: async (index: number, body: string) => {
      const item = pending[index];
      if (!item) throw new Error(`missing list response ${index}`);
      item.respond(body);
      await item.done;
      await expect
        .poll(() => page.evaluate((token: string) => {
          const scope = window as Window & { __tplListConsumed?: string[] };
          return scope.__tplListConsumed?.includes(token) ?? false;
        }, item.token))
        .toBe(true);
      await waitForUiRender(page);
    },
    dispose: async () => {
      await page.unroute("**/api/admin/templates**", handler);
      await page.evaluate(() => {
        const scope = window as Window & {
          __tplListOriginalFetch?: typeof fetch;
        };
        if (scope.__tplListOriginalFetch) {
          window.fetch = scope.__tplListOriginalFetch;
        }
        delete scope.__tplListOriginalFetch;
      });
    },
  };
}

async function installTemplatePatchGate(page: any, id: string) {
  let releasePending!: () => void;
  let resolvePending!: () => void;
  let completion!: Promise<void>;
  let firstPatchSeen = false;
  let extraPatchCount = 0;
  const handler = async (route: any) => {
    if (route.request().method() !== "PATCH") {
      await route.continue();
      return;
    }
    if (firstPatchSeen) {
      extraPatchCount += 1;
      await route.fulfill({
        body: JSON.stringify({ error: "模板正在保存" }),
        contentType: "application/json",
        status: 409,
      });
      return;
    }
    firstPatchSeen = true;
    completion = new Promise<void>((resolve) => {
      resolvePending = resolve;
    });
    await new Promise<void>((resolve) => {
      releasePending = resolve;
    });
    try {
      await route.continue();
    } finally {
      resolvePending();
    }
  };
  await page.route(`**/api/admin/templates/${id}`, handler);
  return {
    dispose: async () => {
      await page.unroute(`**/api/admin/templates/${id}`, handler);
    },
    extraPatchCount: () => extraPatchCount,
    release: async () => {
      if (!firstPatchSeen || !releasePending) {
        throw new Error(`template ${id} PATCH was not deferred`);
      }
      releasePending();
      await completion;
    },
    seen: () => firstPatchSeen,
  };
}

async function installRetryableTemplatePatchGate(page: any, id: string) {
  const pending: Array<{
    done: Promise<void>;
    finish: () => void;
    respond: (response: { body: string; status: number }) => void;
  }> = [];
  const handler = async (route: any) => {
    if (route.request().method() !== "PATCH") {
      await route.continue();
      return;
    }
    let respond!: (response: { body: string; status: number }) => void;
    let finish!: () => void;
    const responseReady = new Promise<{ body: string; status: number }>((resolve) => {
      respond = resolve;
    });
    const done = new Promise<void>((resolve) => {
      finish = resolve;
    });
    pending.push({ done, finish, respond });
    const response = await responseReady;
    try {
      if (response.status === 200) {
        await route.continue();
      } else {
        await route.fulfill({
          body: response.body,
          contentType: "application/json",
          status: response.status,
        });
      }
    } finally {
      finish();
    }
  };
  await page.route(`**/api/admin/templates/${id}`, handler);
  return {
    dispose: async () => {
      await page.unroute(`**/api/admin/templates/${id}`, handler);
    },
    pending,
    release: async (
      index: number,
      response: { body?: string; status?: number } = {},
    ) => {
      const item = pending[index];
      if (!item) throw new Error(`missing deferred PATCH response ${index}`);
      item.respond({
        body: response.body ?? JSON.stringify({}),
        status: response.status ?? 200,
      });
      await item.done;
    },
  };
}

async function installTemplatePostGate(page: any) {
  const pending: Array<{
    done: Promise<void>;
    finish: () => void;
    respond: () => void;
  }> = [];
  const handler = async (route: any) => {
    const url = new URL(route.request().url());
    if (
      route.request().method() !== "POST" ||
      url.pathname !== "/api/admin/templates"
    ) {
      await route.continue();
      return;
    }
    let respond!: () => void;
    let finish!: () => void;
    const responseReady = new Promise<void>((resolve) => {
      respond = resolve;
    });
    const done = new Promise<void>((resolve) => {
      finish = resolve;
    });
    pending.push({ done, finish, respond });
    await responseReady;
    try {
      await route.continue();
    } finally {
      finish();
    }
  };
  await page.route("**/api/admin/templates**", handler);
  return {
    dispose: async () => {
      await page.unroute("**/api/admin/templates**", handler);
    },
    pending,
    release: async (index: number) => {
      const item = pending[index];
      if (!item) throw new Error(`missing deferred POST response ${index}`);
      item.respond();
      await item.done;
    },
  };
}

function requestBody(request: any) {
  const body = request.postData();
  return body ? JSON.parse(body) as Record<string, unknown> : {};
}

async function waitForUiRender(page: any) {
  await page.evaluate(() => new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
  }));
}

async function captureTemplateUiEvidence(
  page: any,
  width: number,
  height: number,
  state: "error" | "reading" | "saving" | "waiting",
) {
  const modal = page.getByTestId("admin-template-modal");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  expect(await modal.evaluate((element: HTMLElement) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  for (const control of [
    modal.getByLabel(/模板图 JSON/),
    modal.getByRole("button", { name: "关闭公共模板弹窗" }),
    modal.getByRole("button", { name: /^(保存|保存中|等待上一项保存)$/ }),
  ]) {
    await control.scrollIntoViewIfNeeded();
    await expect(control).toBeInViewport();
  }
  const path = test.info().outputPath(`tpl-${width}x${height}-${state}.png`);
  await page.screenshot({ path });
  console.log(`[tpl-ui-evidence] ${path}`);
}

test("template graph contract rejects self-parented groups and missing top-level nodes", () => {
  const valid = uploadPlaceholderGraph();
  expect(validTemplateGraph(valid)).toBe(true);

  const selfParented = structuredClone(valid);
  selfParented.nodes[0].parentId = selfParented.nodes[0].id;
  expect(validTemplateGraph(selfParented)).toBe(false);

  const missingParent = structuredClone(valid);
  missingParent.nodes[1].parentId = "missing-group";
  expect(validTemplateGraph(missingParent)).toBe(false);

  const duplicateNode = structuredClone(valid);
  duplicateNode.nodes[2].id = duplicateNode.nodes[1].id;
  expect(validTemplateGraph(duplicateNode)).toBe(false);
});

function pinnedImageGenerationGraph(
  modelId?: string,
  imageParameters: Record<string, unknown> = {},
) {
  return {
    edges: [{
      data: { inputOrder: 1, inputRole: "reference-image" },
      id: "compat-edge",
      source: "compat-reference",
      sourceHandle: "source",
      target: "compat-target",
      targetHandle: "target",
      type: "cuttable",
    }],
    nodes: [{
      data: { label: "Group", title: "兼容检查组" },
      id: "compat-group",
      position: { x: 0, y: 0 },
      style: { height: 348, width: 828 },
      type: "group",
      zIndex: 0,
    }, {
      data: { label: "Image", title: "商品参考图" },
      id: "compat-reference",
      parentId: "compat-group",
      position: { x: 20, y: 20 },
      style: { height: 250, width: 250 },
      type: "image",
      zIndex: 1,
    }, {
      data: {
        imageModelId: modelId,
        imageParameters,
        imagePrompt: "生成商品主图",
        imagePromptReady: true,
        label: "Image",
        title: "商品主图",
      },
      id: "compat-target",
      parentId: "compat-group",
      position: { x: 300, y: 20 },
      style: { height: 250, width: 250 },
      type: "image",
      zIndex: 1,
    }],
    version: 1,
  };
}

function seedPublishedImageModel(
  store: ReturnType<typeof openAppDatabase>,
  modelId: string,
) {
  const now = timestamp();
  const providerId = `${modelId}-provider`;
  store.prepare(`
    INSERT INTO provider_profiles (
      id, display_name, driver, status, created_at, updated_at,
      provider_configuration_version
    ) VALUES (?, '模板兼容测试平台', 'multi-protocol-relay', 'enabled', ?, ?, 1)
  `).run(providerId, now, now);
  const schema = knownModelParameterSchema({
    capability: "image",
    providerDriver: "multi-protocol-relay",
    providerModelId: "gpt-image-2",
  });
  store.prepare(`
    INSERT INTO model_profiles (
      id, display_name, provider_profile_id, provider_model_id,
      capability, status, default_parameters, created_at, updated_at,
      max_cost_microunits, cost_currency, provider_protocol
    ) VALUES (
      ?, '模板兼容图片模型', ?, 'gpt-image-2', 'image', 'published',
      ?, ?, ?, 1000000, 'USD', 'gpt-image'
    )
  `).run(modelId, providerId, JSON.stringify(schema), now, now);
  store.prepare(`
    INSERT INTO node_model_bindings (
      node_type, model_id, enabled, is_default, sort_order, created_at, updated_at
    ) VALUES ('image', ?, 1, 1, 1, ?, ?)
  `).run(modelId, now, now);
  return schema;
}

test("v31 migration creates public_templates with the two real seeds idempotently", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-public-mig-"));
  try {
    const store = openAppDatabase(dataDirectory);
    expect(
      Number(
        (
          store.prepare("PRAGMA user_version").get() as {
            user_version: number;
          }
        ).user_version,
      ),
    ).toBe(currentSchemaVersion);
    const rows = store
      .prepare(`
        SELECT
          id, title, description, category, graph, preview_image, status
        FROM public_templates
        ORDER BY rowid
      `)
      .all() as Array<{
      category: string;
      description: string;
      graph: string;
      id: string;
      preview_image: string;
      status: string;
      title: string;
    }>;
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.status)).toEqual([
      "published",
      "published",
      "published",
    ]);
    expect(rows.map((row) => row.id)).toEqual([
      "0786e042-095e-4551-b91b-365492e91241",
      "aaf7cc53-a595-45da-a6bb-7c93309e0962",
      "e6b7f8c4-8c7d-4f8e-9d0a-3a1b2c3d4e5f",
    ]);
    for (const row of rows) {
      expect(JSON.parse(row.category)).toEqual(["电商"]);
      expect(row.preview_image).toMatch(/^\/templates\/.+\.png$/);
      expect(row.description.length).toBeGreaterThan(0);
      const graph = JSON.parse(row.graph) as {
        nodes: Array<{ type: string }>;
      };
      expect(
        graph.nodes.filter((node) => node.type === "group"),
      ).toHaveLength(1);
    }
    store.close();

    const reopened = openAppDatabase(dataDirectory);
    expect(
      Number(
        (
          reopened.prepare("PRAGMA user_version").get() as {
            user_version: number;
          }
        ).user_version,
      ),
    ).toBe(currentSchemaVersion);
    expect(
      Number(
        (
          reopened
            .prepare("SELECT COUNT(*) AS count FROM public_templates")
            .get() as { count: number }
        ).count,
      ),
    ).toBe(3);
    reopened.close();
  } finally {
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("public template storage enforces validation, status transitions and seed protection", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-public-store-"));
  try {
    const store = openAppDatabase(dataDirectory);
    const now = timestamp();
    store
      .prepare(`
        INSERT INTO users (
          id, login_name, display_name, password_hash, role, status,
          created_at, updated_at
        )
        VALUES (?, ?, ?, ?, 'admin', 'active', ?, ?)
      `)
      .run("pub-admin", "pubadmin", "Pub Admin", "test-only", now, now);

    expect(() =>
      savePublicTemplate(store, "pub-admin", {
        graph: uploadPlaceholderGraph(),
        title: "",
      }),
    ).toThrow("标题");
    expect(() =>
      savePublicTemplate(store, "pub-admin", {
        category: ["最近使用"],
        graph: uploadPlaceholderGraph(),
        title: "非法分类",
      }),
    ).toThrow("分类");
    expect(() =>
      savePublicTemplate(store, "pub-admin", {
        graph: { nodes: [{ id: "x" }], edges: [], version: 1 },
        title: "非法图",
      }),
    ).toThrow("图结构");

    const created = savePublicTemplate(store, "pub-admin", {
      category: ["电商", "广告"],
      description: "上传位模板说明",
      graph: uploadPlaceholderGraph(),
      previewImage: "/templates/custom.png",
      title: "上传位公共模板",
    });
    expect(created.status).toBe("draft");
    expect(created.created_by).toBe("pub-admin");
    expect(created.preview_image).toBe("/templates/custom.png");

    store
      .prepare(`
        INSERT INTO users (
          id, login_name, display_name, password_hash, role, status,
          created_at, updated_at
        )
        VALUES ('pub-other', 'pubother', 'Pub Other', 'test-only', 'user',
          'active', ?, ?)
      `)
      .run(now, now);
    const insertCoverMedia = store.prepare(`
      INSERT INTO media_assets (
        kind, id, owner_id, storage_name, byte_size, created_at, updated_at,
        storage_status
      )
      VALUES (?, 'public-cover', ?, ?, 1, ?, ?, 'ready')
    `);
    insertCoverMedia.run(
      "audio",
      "pub-admin",
      "public-cover.mp3",
      now,
      now,
    );
    const coverRow = {
      ...created,
      cover_asset_id: "public-cover",
      preview_image: null,
    };
    expect(publicTemplateCard(store, coverRow, false).cover).toBeNull();
    insertCoverMedia.run(
      "image",
      "pub-other",
      "public-cover.png",
      now,
      now,
    );
    expect(publicTemplateCard(store, coverRow, false).cover).toBeNull();
    store.prepare(`
      UPDATE media_assets
      SET owner_id = 'pub-admin', storage_status = 'pending'
      WHERE kind = 'image' AND id = 'public-cover'
    `).run();
    expect(publicTemplateCard(store, coverRow, false).cover).toBeNull();
    store.prepare(`
      UPDATE media_assets
      SET storage_status = 'ready'
      WHERE kind = 'image' AND id = 'public-cover'
    `).run();
    expect(publicTemplateCard(store, coverRow, false).cover).toEqual({
      assetId: "public-cover",
      kind: "image",
    });
    insertCoverMedia.run(
      "video",
      "pub-admin",
      "public-cover.mp4",
      now,
      now,
    );
    expect(publicTemplateCard(store, coverRow, false).cover).toBeNull();

    const drafts = listPublicTemplates(store, {
      category: "全部",
      includeGraph: false,
      limit: 20,
      offset: 0,
      query: "",
      status: "draft",
    });
    expect(drafts.total).toBe(1);
    const published = listPublicTemplates(store, {
      category: "全部",
      includeGraph: false,
      limit: 20,
      offset: 0,
      query: "",
      status: "published",
    });
    expect(published.total).toBe(3);
    const ecommerceOnly = listPublicTemplates(store, {
      category: "电商",
      includeGraph: false,
      limit: 20,
      offset: 0,
      query: "",
      status: "",
    });
    expect(ecommerceOnly.total).toBe(4);

    const updated = updatePublicTemplate(store, "pub-admin", created.id, {
      status: "published",
      title: "已发布的上传位模板",
    });
    expect(updated.status).toBe("published");
    expect(updated.title).toBe("已发布的上传位模板");

    const archived = archivePublicTemplate(store, "pub-admin", created.id);
    expect(archived.status).toBe("archived");
    expect(archived.archived_at).not.toBeNull();
    const restored = restorePublicTemplate(store, "pub-admin", created.id);
    expect(restored.status).toBe("published");
    expect(restored.archived_at).toBeNull();

    expect(deletePublicTemplate(store, "pub-admin", created.id)).toBe(true);
    expect(
      store
        .prepare("SELECT COUNT(*) AS count FROM public_templates WHERE id = ?")
        .get(created.id) as { count: number },
    ).toMatchObject({ count: 0 });

    const seed = store
      .prepare("SELECT id FROM public_templates LIMIT 1")
      .get() as { id: string };
    expect(() =>
      deletePublicTemplate(store, "pub-admin", seed.id),
    ).toThrow("种子模板不可物理删除");

    const audits = store
      .prepare(`
        SELECT action
        FROM admin_audit_events
        WHERE actor_user_id = ?
        ORDER BY rowid
      `)
      .all("pub-admin") as Array<{ action: string }>;
    expect(audits.map((row) => row.action)).toEqual([
      "public_template.create",
      "public_template.update",
      "public_template.archive",
      "public_template.restore",
      "public_template.delete",
    ]);
    store.close();
  } finally {
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("public template publication pins a compatible model before becoming visible", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-public-compat-"));
  try {
    const store = openAppDatabase(dataDirectory);
    try {
      const now = timestamp();
      store.prepare(`
        INSERT INTO users (
          id, login_name, display_name, password_hash, role, status,
          created_at, updated_at
        ) VALUES (
          'compat-admin', 'compat-admin', 'Compat Admin', 'test-only',
          'admin', 'active', ?, ?
        )
      `).run(now, now);
      const modelId = "template-compatible-image";
      seedPublishedImageModel(store, modelId);
      const draft = savePublicTemplate(store, "compat-admin", {
        graph: pinnedImageGenerationGraph(),
        title: "待绑定模型模板",
      });
      expect(() => updatePublicTemplate(
        store,
        "compat-admin",
        draft.id,
        { status: "published" },
      )).toThrow(PublicTemplateCompatibilityError);
      expect(store.prepare(`
        SELECT status FROM public_templates WHERE id = ?
      `).get(draft.id)).toEqual({ status: "draft" });

      expect(() => updatePublicTemplate(
        store,
        "compat-admin",
        draft.id,
        {
          graph: pinnedImageGenerationGraph(modelId, { quality: "ultra" }),
          status: "published",
        },
      )).toThrow("节点参数与推荐模型");
      expect(store.prepare(`
        SELECT status FROM public_templates WHERE id = ?
      `).get(draft.id)).toEqual({ status: "draft" });

      const published = updatePublicTemplate(
        store,
        "compat-admin",
        draft.id,
        {
          graph: pinnedImageGenerationGraph(modelId),
          status: "published",
        },
      );
      expect(published.status).toBe("published");
      expect(
        auditStoredPublicTemplates(store).find((item) => item.id === draft.id),
      ).toMatchObject({ issues: [], status: "PASS" });

      archivePublicTemplate(store, "compat-admin", draft.id);
      store.prepare(`
        UPDATE model_profiles SET status = 'disabled' WHERE id = ?
      `).run(modelId);
      expect(() => restorePublicTemplate(store, "compat-admin", draft.id))
        .toThrow("未发布、已停用或节点类型不匹配");
      expect(store.prepare(`
        SELECT status FROM public_templates WHERE id = ?
      `).get(draft.id)).toEqual({ status: "archived" });

      const seedAudits = auditStoredPublicTemplates(store).filter((item) =>
        item.id === "0786e042-095e-4551-b91b-365492e91241" ||
        item.id === "aaf7cc53-a595-45da-a6bb-7c93309e0962");
      expect(seedAudits).toHaveLength(2);
      expect(seedAudits.map((item) => item.status)).toEqual([
        "NEEDS_MODEL",
        "NEEDS_MODEL",
      ]);
    } finally {
      store.close();
    }
  } finally {
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("template compatibility keeps canvas-only storyboard connections valid", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-public-storyboard-"));
  try {
    const store = openAppDatabase(dataDirectory);
    try {
      expect(auditPublicTemplateCompatibility(store, {
        edges: [{
          id: "storyboard-edge",
          source: "storyboard-text",
          sourceHandle: "source",
          target: "storyboard-table",
          targetHandle: "target",
          type: "cuttable",
        }],
        nodes: [{
          data: { label: "Text", title: "分镜脚本" },
          id: "storyboard-text",
          position: { x: 0, y: 0 },
          style: { height: 250, width: 250 },
          type: "text",
          zIndex: 0,
        }, {
          data: { label: "Storyboard", title: "抖音分镜表" },
          id: "storyboard-table",
          position: { x: 300, y: 0 },
          style: { height: 250, width: 500 },
          type: "storyboard",
          zIndex: 0,
        }],
        version: 1,
      })).toEqual({ issues: [], status: "PASS" });
    } finally {
      store.close();
    }
  } finally {
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("public template writes fence account deletion and keep audit atomic", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-public-fence-"));
  try {
    const store = openAppDatabase(dataDirectory);
    try {
      const now = timestamp();
      store.prepare(`
        INSERT INTO users (
          id, login_name, display_name, password_hash, role, status,
          created_at, updated_at
        )
        VALUES ('template-admin', 'template-admin', 'Template Admin',
          'test-only', 'admin', 'active', ?, ?)
      `).run(now, now);
      const committed = savePublicTemplate(store, "template-admin", {
        graph: uploadPlaceholderGraph(),
        title: "Commit First Template",
      });
      const restorable = savePublicTemplate(store, "template-admin", {
        graph: uploadPlaceholderGraph(),
        title: "Restorable Template",
      });
      archivePublicTemplate(store, "template-admin", restorable.id);
      const beforeAuditCount = Number((store.prepare(`
        SELECT COUNT(*) AS count
        FROM admin_audit_events
        WHERE actor_user_id = 'template-admin'
      `).get() as { count: number }).count);

      // Commit-first rows and audits remain durable when deletion commits next.
      store.prepare(`
        INSERT INTO account_delete_intents (
          owner_id, state, error_code, retry_count, created_at, updated_at
        ) VALUES ('template-admin', 'running', NULL, 0, ?, ?)
      `).run(now, now);
      expect(store.prepare(`
        SELECT title FROM public_templates WHERE id = ?
      `).get(committed.id)).toEqual({ title: "Commit First Template" });

      const blockedMutations = [
        () => savePublicTemplate(store, "template-admin", {
          graph: uploadPlaceholderGraph(),
          title: "Blocked Create",
        }),
        () => updatePublicTemplate(
          store,
          "template-admin",
          committed.id,
          { title: "Blocked Update" },
        ),
        () => archivePublicTemplate(store, "template-admin", committed.id),
        () => restorePublicTemplate(store, "template-admin", restorable.id),
        () => deletePublicTemplate(store, "template-admin", committed.id),
      ];
      for (const mutation of blockedMutations) {
        expect(mutation).toThrow(AccountMutationBlockedError);
      }
      expect(store.prepare(`
        SELECT title, status FROM public_templates WHERE id = ?
      `).get(committed.id)).toEqual({
        status: "draft",
        title: "Commit First Template",
      });
      expect(store.prepare(`
        SELECT status FROM public_templates WHERE id = ?
      `).get(restorable.id)).toEqual({ status: "archived" });
      expect(store.prepare(`
        SELECT COUNT(*) AS count FROM public_templates
        WHERE title = 'Blocked Create'
      `).get()).toEqual({ count: 0 });
      expect(Number((store.prepare(`
        SELECT COUNT(*) AS count
        FROM admin_audit_events
        WHERE actor_user_id = 'template-admin'
      `).get() as { count: number }).count)).toBe(beforeAuditCount);

      store.prepare(`
        DELETE FROM account_delete_intents WHERE owner_id = 'template-admin'
      `).run();
      store.exec(`
        CREATE TRIGGER test_public_template_audit_fault
        BEFORE INSERT ON admin_audit_events
        WHEN NEW.action = 'public_template.update'
        BEGIN
          SELECT RAISE(ABORT, 'test public template audit fault');
        END;
      `);
      expect(() => updatePublicTemplate(
        store,
        "template-admin",
        committed.id,
        { title: "Must Roll Back" },
      )).toThrow("test public template audit fault");
      expect(store.prepare(`
        SELECT title FROM public_templates WHERE id = ?
      `).get(committed.id)).toEqual({ title: "Commit First Template" });
      expect(Number((store.prepare(`
        SELECT COUNT(*) AS count
        FROM admin_audit_events
        WHERE actor_user_id = 'template-admin'
      `).get() as { count: number }).count)).toBe(beforeAuditCount);
    } finally {
      store.close();
    }
  } finally {
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("admin CRUD API, ordinary 403 and the public GET keep the seed contract", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-public-api-"));
  let server: ChildProcess | undefined;
  try {
    server = await startServer(dataDirectory);
    const bootstrap = await request("/api/auth/bootstrap", {
      body: JSON.stringify({
        displayName: "Owner",
        loginName: "owner",
        password: "owner-password-123",
      }),
      method: "POST",
    });
    expect(bootstrap.status).toBe(201);
    const adminCookie = cookie(bootstrap);

    const incompatiblePublish = await request("/api/admin/templates", {
      body: JSON.stringify({
        graph: pinnedImageGenerationGraph(),
        status: "published",
        title: "禁止静默选模型",
      }),
      cookie: adminCookie,
      method: "POST",
    });
    expect(incompatiblePublish.status).toBe(400);
    await expect(incompatiblePublish.json()).resolves.toMatchObject({
      code: "TEMPLATE_COMPATIBILITY_FAILED",
      issues: [{ code: "MODEL_SELECTION_REQUIRED", nodeId: "compat-target" }],
    });

    const fenceStore = openAppDatabase(dataDirectory);
    try {
      const admin = fenceStore.prepare(`
        SELECT id FROM users WHERE login_name = 'owner'
      `).get() as { id: string };
      const now = timestamp();
      fenceStore.prepare(`
        INSERT INTO account_delete_intents (
          owner_id, state, error_code, retry_count, created_at, updated_at
        ) VALUES (?, 'running', NULL, 0, ?, ?)
      `).run(admin.id, now, now);
      const blocked = await request("/api/admin/templates", {
        body: JSON.stringify({
          graph: uploadPlaceholderGraph(),
          title: "Blocked API Template",
        }),
        cookie: adminCookie,
        method: "POST",
      });
      expect(blocked.status).toBe(409);
      await expect(blocked.json()).resolves.toMatchObject({
        code: "ACCOUNT_DELETE_ACTIVE",
      });
      expect(fenceStore.prepare(`
        SELECT COUNT(*) AS count FROM public_templates
        WHERE title = 'Blocked API Template'
      `).get()).toEqual({ count: 0 });
      fenceStore.prepare(`
        DELETE FROM account_delete_intents WHERE owner_id = ?
      `).run(admin.id);
    } finally {
      fenceStore.close();
    }

    const createdUser = await request("/api/admin/users", {
      body: JSON.stringify({
        displayName: "Ordinary",
        loginName: "ordinary",
        password: "ordinary-pass-123",
      }),
      cookie: adminCookie,
      method: "POST",
    });
    expect(createdUser.status).toBe(201);
    const ordinaryId = (
      (await createdUser.json()).user as { id: string }
    ).id;
    const login = await request("/api/auth/login", {
      body: JSON.stringify({
        loginName: "ordinary",
        password: "ordinary-pass-123",
      }),
      method: "POST",
    });
    const userCookie = cookie(login);
    await test.step("UI04 admin detail uses management permission", async () => {
      const id = "0786e042-095e-4551-b91b-365492e91241";
      expect((await request(`/api/admin/templates/${id}`, { cookie: userCookie })).status).toBe(403);
      expect((await request(`/api/admin/templates/${id}`)).status).toBe(401);
      const allowed = await request(`/api/admin/templates/${id}`, { cookie: adminCookie });
      expect(allowed.status).toBe(200);
      expect((await allowed.json()).template.id).toBe(id);
    });

    // 公共 GET 结构不变：两条种子，分类/封面/描述/图结构与改造前一致。
    const publicList = await request(
      "/api/templates?space=public&limit=20&offset=0&includeGraph=true",
      { cookie: adminCookie },
    );
    expect(publicList.status).toBe(200);
    const catalog = (await publicList.json()) as {
      categories: string[];
      items: Array<{
        categories: string[];
        description: string;
        graph?: {
          edges: unknown[];
          nodes: Array<{ type: string }>;
          version: 1;
        };
        id: string;
        previewImage: string;
        title: string;
      }>;
      pagination: { hasMore: boolean; total: number };
    };
    expect(catalog.categories).toContain("电商");
    expect(catalog.pagination).toMatchObject({ total: 3, hasMore: false });
    const detail = catalog.items.find(
      (item) => item.id === "0786e042-095e-4551-b91b-365492e91241",
    )!;
    expect(detail.graph?.nodes).toHaveLength(12);
    expect(detail.graph?.edges).toHaveLength(29);
    expect(
      detail.graph?.nodes.filter((node) => node.type === "group"),
    ).toHaveLength(1);
    const expert = catalog.items.find(
      (item) => item.id === "aaf7cc53-a595-45da-a6bb-7c93309e0962",
    )!;
    expect(expert.graph?.nodes).toHaveLength(14);
    expect(expert.graph?.edges).toHaveLength(12);
    const garment = catalog.items.find(
      (item) => item.id === "e6b7f8c4-8c7d-4f8e-9d0a-3a1b2c3d4e5f",
    )!;
    expect(garment.graph?.nodes).toHaveLength(9);
    expect(garment.graph?.edges).toHaveLength(12);
    expect(
      garment.graph?.nodes.filter((node) => node.type === "group"),
    ).toHaveLength(1);
    for (const item of catalog.items) {
      expect(item.categories).toEqual(["电商"]);
      expect(item.previewImage).toMatch(/^\/templates\/.+\.png$/);
      expect(typeof item.description).toBe("string");
    }

    // 普通账号无 manage_public_templates：管理接口全部 403。
    for (const [method, path, body] of [
      ["GET", "/api/admin/templates", undefined],
      [
        "POST",
        "/api/admin/templates",
        { graph: uploadPlaceholderGraph(), title: "越权模板" },
      ],
      [
        "PATCH",
        "/api/admin/templates/0786e042-095e-4551-b91b-365492e91241",
        { title: "越权改名" },
      ],
      [
        "DELETE",
        "/api/admin/templates/0786e042-095e-4551-b91b-365492e91241",
        undefined,
      ],
    ] as const) {
      const response = await request(path, {
        body: body ? JSON.stringify(body) : undefined,
        cookie: userCookie,
        method,
      });
      expect(response.status).toBe(403);
    }

    // 管理员 CRUD：draft → published → archived → 恢复。
    const created = await request("/api/admin/templates", {
      body: JSON.stringify({
        category: ["工具"],
        description: "管理员新建模板",
        graph: uploadPlaceholderGraph(),
        previewImage: "/templates/custom.png",
        title: "管理员新建模板",
      }),
      cookie: adminCookie,
      method: "POST",
    });
    expect(created.status).toBe(201);
    const templateId = (
      (await created.json()) as {
        template: { id: string };
      }
    ).template.id;

    const adminDrafts = await request(
      "/api/admin/templates?status=draft",
      { cookie: adminCookie },
    );
    expect(
      (
        (await adminDrafts.json()) as {
          items: Array<{ id: string }>;
        }
      ).items.map((item) => item.id),
    ).toContain(templateId);

    const publish = await request(
      `/api/admin/templates/${templateId}`,
      {
        body: JSON.stringify({ status: "published" }),
        cookie: adminCookie,
        method: "PATCH",
      },
    );
    expect(publish.status).toBe(200);
    const visible = await request(
      "/api/templates?space=public&q=管理员新建模板",
      { cookie: adminCookie },
    );
    expect(
      ((await visible.json()) as { items: Array<{ id: string }> }).items,
    ).toHaveLength(1);

    const archived = await request(
      `/api/admin/templates/${templateId}`,
      { cookie: adminCookie, method: "DELETE" },
    );
    expect(archived.status).toBe(200);
    const hidden = await request(
      "/api/templates?space=public&q=管理员新建模板",
      { cookie: adminCookie },
    );
    expect(
      ((await hidden.json()) as { items: Array<{ id: string }> }).items,
    ).toHaveLength(0);

    const restored = await request(
      `/api/admin/templates/${templateId}`,
      {
        body: JSON.stringify({ status: "published" }),
        cookie: adminCookie,
        method: "PATCH",
      },
    );
    expect(restored.status).toBe(200);
    const visibleAgain = await request(
      "/api/templates?space=public&q=管理员新建模板",
      { cookie: adminCookie },
    );
    expect(
      ((await visibleAgain.json()) as { items: Array<{ id: string }> }).items,
    ).toHaveLength(1);

    expect(
      (
        await request(`/api/admin/templates/not-a-uuid`, {
          cookie: adminCookie,
          method: "PATCH",
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await request(
          `/api/admin/templates/${templateId}`,
          { cookie: adminCookie, method: "PATCH" },
        )
      ).status,
    ).toBe(400);

    // 授予 manage_public_templates 后普通账号可访问管理接口（权限矩阵正例）。
    const grant = await request(
      `/api/admin/users/${ordinaryId}/permissions`,
      {
        body: JSON.stringify({
          permissions: ["manage_public_templates"],
        }),
        cookie: adminCookie,
        method: "PUT",
      },
    );
    expect(grant.status).toBe(200);
    expect(
      (await request("/api/admin/templates", { cookie: userCookie })).status,
    ).toBe(200);
  } finally {
    if (server) await stopServer(server);
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("a published upload-placeholder template imports for an ordinary account with preview cover", async ({
  page,
}) => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-public-ui-"));
  let server: ChildProcess | undefined;
  try {
    server = await startServer(dataDirectory);
    const bootstrap = await page.request.post("/api/auth/bootstrap", {
      data: {
        displayName: "Owner",
        loginName: "owner",
        password: "owner-password-123",
      },
    });
    expect(bootstrap.status()).toBe(201);
    const createdUser = await page.request.post("/api/admin/users", {
      data: {
        displayName: "Ordinary",
        loginName: "ordinary",
        password: "ordinary-pass-123",
      },
    });
    expect(createdUser.status()).toBe(201);

    const template = await page.request.post("/api/admin/templates", {
      data: {
        category: ["工具"],
        description: "上传位公共模板",
        graph: uploadPlaceholderGraph(),
        previewImage: "/templates/ecommerce-detail-workflow.png",
        status: "published",
        title: "上传位公共模板",
      },
    });
    expect(template.status()).toBe(201);

    await page.request.post("/api/auth/logout");
    const login = await page.request.post("/api/auth/login", {
      data: {
        loginName: "ordinary",
        password: "ordinary-pass-123",
      },
    });
    expect(login.status()).toBe(200);
    const project = (
      (await (await page.request.post("/api/projects", { data: {} })).json()) as {
        id: string;
      }
    );
    await page.goto(`/canvas/${project.id}`);
    await expect(page.getByTestId("canvas-world")).toHaveAttribute(
      "data-persistence-ready",
      "true",
    );

    await page.getByTestId("templates").click();
    const panel = page.getByTestId("templates-panel");
    await expect(panel).toBeVisible();
    const card = panel
      .locator(".template-card")
      .filter({ hasText: "上传位公共模板" });
    await expect(card).toBeVisible();
    await expect(card.locator(".template-card-art img")).toHaveAttribute(
      "src",
      "/templates/ecommerce-detail-workflow.png",
    );
    await card.click();

    await expect(page.locator(".react-flow__node-group")).toHaveCount(1);
    await expect(page.locator(".react-flow__node-text")).toHaveCount(1);
    await expect(page.locator(".react-flow__node-image")).toHaveCount(1);
    await page.reload();
    await expect(page.getByTestId("canvas-world")).toHaveAttribute(
      "data-persistence-ready",
      "true",
    );
    await expect(page.locator(".react-flow__node-group")).toHaveCount(1);
    await expect(page.locator(".react-flow__node-text")).toHaveCount(1);
    await expect(page.locator(".react-flow__node-image")).toHaveCount(1);
    const importedCanvas = await (
      await page.request.get(`/api/canvas/${project.id}`)
    ).json() as {
      edges: Array<{ data?: { inputOrder?: number; inputRole?: string } }>;
    };
    expect(importedCanvas.edges).toHaveLength(1);
    expect(importedCanvas.edges[0].data).toEqual({
      inputOrder: 1,
      inputRole: "prompt",
    });

    await page.request.delete(`/api/canvas/${project.id}`);
    await page.request.delete(`/api/projects/${project.id}`);
  } finally {
    if (server) await stopServer(server);
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("admin templates page creates, edits, archives and restores public templates", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-public-adminui-"));
  let server: ChildProcess | undefined;
  try {
    server = await startServer(dataDirectory);
    const bootstrap = await page.request.post("/api/auth/bootstrap", {
      data: {
        displayName: "Owner",
        loginName: "owner",
        password: "owner-password-123",
      },
    });
    expect(bootstrap.status()).toBe(201);

    await page.goto("/admin/templates");
    await expect(page.getByTestId("admin-templates-page")).toBeVisible();
    await expect(
      page.getByTestId("admin-templates-list"),
    ).toContainText("电商详情页工作流");
    await expect(
      page.getByTestId("admin-templates-list"),
    ).toContainText("213.电商图片生成专家");
    const seedCard = page
      .locator(".admin-template-card")
      .filter({ hasText: "电商详情页工作流" });
    await expect(seedCard.locator("[data-compatibility='NEEDS_MODEL']"))
      .toContainText("需要绑定模型");

    // TPL-EDIT-ISOLATION-001 的 A/B/C 夹具只存在于这个临时数据库；
    // S01 放在原 CRUD UI 操作之前，确保旧客户端会稳定暴露错目标写入。
    const isolationModal = page.getByTestId("admin-template-modal");
    const fixtureA = await createAdminUiTemplate(
      page,
      "隔离夹具 A",
      "TPL-A",
    );
    const fixtureB = await createAdminUiTemplate(
      page,
      "隔离夹具 B",
      "TPL-B",
    );
    const fixtureC = await createAdminUiTemplate(
      page,
      "隔离夹具 C",
      "TPL-C",
    );
    const cardFor = (id: string) =>
      page.getByTestId(`admin-template-${id}`);
    await page.reload();
    await expect(cardFor(fixtureA.id)).toBeVisible();
    await expect(cardFor(fixtureB.id)).toBeVisible();
    await expect(cardFor(fixtureC.id)).toBeVisible();
    await ignoreAdminGraphAbort(page);

    await test.step(
      "TPL-S01 A 关闭后打开 B，迟到的 A 读取不能写入 B",
      async () => {
        const beforeA = await readAdminUiTemplate(page, fixtureA.id);
        const beforeADb = readPublicTemplateDbRow(dataDirectory, fixtureA.id);
        const gate = await installAdminGraphReadGate(
          page,
          await adminGraphListPayload(page),
        );
        await cardFor(fixtureA.id).getByRole("button", { name: "编辑" }).click();
        await expect(isolationModal).toBeVisible();
        await expect.poll(() => gate.pending.length).toBe(1);
        await isolationModal
          .getByRole("button", { name: "关闭公共模板弹窗" })
          .click();
        await expect(isolationModal).toHaveCount(0);

        await cardFor(fixtureB.id).getByRole("button", { name: "编辑" }).click();
        await expect(isolationModal).toBeVisible();
        await expect.poll(() => gate.pending.length).toBe(2);
        await gate.release(1);
        await waitForUiRender(page);
        await expect(isolationModal.getByLabel(/模板标题/)).toHaveValue(
          fixtureB.title,
        );
        await expect(isolationModal.getByLabel(/模板图 JSON/)).toHaveValue(
          /TPL-B/,
        );
        await gate.release(0);
        await waitForUiRender(page);
        await expect(isolationModal.getByLabel(/模板标题/)).toHaveValue(
          fixtureB.title,
        );
        await expect(isolationModal.getByLabel(/模板图 JSON/)).toHaveValue(
          /TPL-B/,
        );
        const patchRequests: string[] = [];
        const onPatchRequest = (request: any) => {
          const url = new URL(request.url());
          if (request.method() === "PATCH") {
            patchRequests.push(url.pathname);
          }
        };
        page.on("request", onPatchRequest);
        await isolationModal.getByLabel(/模板标题/).fill("S01 B 隔离后");
        await isolationModal.getByRole("button", { name: "保存" }).click();
        await expect.poll(() => patchRequests.length).toBe(1);
        expect(patchRequests[0]).toBe(`/api/admin/templates/${fixtureB.id}`);
        await expect(isolationModal).toHaveCount(0);
        page.off("request", onPatchRequest);

        const savedA = await readAdminUiTemplate(page, fixtureA.id);
        const savedB = await readAdminUiTemplate(page, fixtureB.id);
        expect(savedA).toEqual(beforeA);
        expect(savedB.title).toBe("S01 B 隔离后");
        expect(JSON.stringify(savedB.graph)).toContain(fixtureB.marker);
        expect(readPublicTemplateDbRow(dataDirectory, fixtureA.id)).toEqual(beforeADb);
        const savedBDb = readPublicTemplateDbRow(dataDirectory, fixtureB.id);
        expect(savedBDb.title).toBe("S01 B 隔离后");
        expect(JSON.parse(savedBDb.graph)).toEqual(markedUploadPlaceholderGraph(fixtureB.marker));
        fixtureB.title = "S01 B 隔离后";
        await gate.dispose();
      },
    );

    const newTemplateButton = page.getByRole("button", {
      name: "新建公共模板",
    });
    await newTemplateButton.click();
    const modal = page.getByTestId("admin-template-modal");
    await expect(modal).toBeVisible();
    await expect(
      page.getByRole("dialog", { name: "新建公共模板" }),
    ).toBeVisible();
    await expect(modal.getByLabel(/模板标题/)).toBeFocused();
    const toolsCheckbox = modal.getByRole("checkbox", { name: "工具" });
    await expect(toolsCheckbox).toHaveCSS("appearance", "none");
    const templatesSection = page.locator(".admin-templates-section");
    expect((await templatesSection.boundingBox())?.width).toBeLessThanOrEqual(960);
    await page.keyboard.press("Escape");
    await expect(modal).toHaveCount(0);
    await expect(newTemplateButton).toBeFocused();

    await newTemplateButton.click();
    await expect(modal).toBeVisible();
    await modal.getByLabel(/模板标题/).fill("UI 新建模板");
    await modal.getByLabel("说明（可选）", { exact: true }).fill("通过管理页创建");
    await modal.getByRole("checkbox", { name: "工具" }).check();
    const statusSelect = modal.getByTestId("admin-template-status-select");
    await statusSelect.getByRole("combobox", { name: "状态" }).click();
    await statusSelect.getByRole("option", { name: "发布" }).click();
    await modal
      .getByLabel(/模板图 JSON/)
      .fill(JSON.stringify(uploadPlaceholderGraph()));
    await modal.getByRole("button", { name: "保存" }).click();
    await expect(modal).toHaveCount(0);
    const createdCard = page
      .locator(".admin-template-card")
      .filter({ hasText: "UI 新建模板" });
    await expect(createdCard).toBeVisible();
    await expect(createdCard.locator("[data-status='published']")).toBeVisible();
    await expect(createdCard.locator("[data-compatibility='PASS']"))
      .toContainText("兼容检查通过");
    const publicList = await page.request.get(
      "/api/templates?space=public&q=UI 新建模板",
    );
    expect(
      ((await publicList.json()) as { items: Array<{ id: string }> }).items,
    ).toHaveLength(1);

    await page.goto("/canvas");
    await page.getByTestId("templates").click();
    const canvasTemplates = page.getByTestId("templates-panel");
    await expect(canvasTemplates).toContainText("UI 新建模板");
    await page.goto("/admin/templates");
    await expect(page.getByTestId("admin-templates-page")).toBeVisible();

    await createdCard.getByRole("button", { name: "编辑" }).click();
    await expect(modal).toBeVisible();
    await modal.getByLabel(/模板标题/).fill("UI 编辑后");
    await modal.getByRole("button", { name: "保存" }).click();
    await expect(
      page
        .locator(".admin-template-card")
        .filter({ hasText: "UI 编辑后" }),
    ).toBeVisible();

    await page.goBack();
    await page.getByTestId("templates").click();
    await expect(canvasTemplates).toBeVisible();
    await expect(canvasTemplates).toContainText("UI 编辑后");
    await expect(canvasTemplates).not.toContainText("UI 新建模板");
    await page.goto("/admin/templates");
    await expect(page.getByTestId("admin-templates-page")).toBeVisible();

    await page
      .locator(".admin-template-card")
      .filter({ hasText: "UI 编辑后" })
      .getByRole("button", { name: "归档" })
      .click();
    await expect(page.getByTestId("confirm-dialog")).toBeVisible();
    await page.getByTestId("confirm-dialog").getByRole("button", {
      name: "归档",
    }).click();
    await expect(
      page
        .locator(".admin-template-card")
        .filter({ hasText: "UI 编辑后" })
        .locator("[data-status='archived']"),
    ).toBeVisible();
    const hiddenAfterArchive = await page.request.get(
      "/api/templates?space=public&q=UI 编辑后",
    );
    expect(
      (
        (await hiddenAfterArchive.json()) as {
          items: Array<{ id: string }>;
        }
      ).items,
    ).toHaveLength(0);

    await page
      .locator(".admin-template-card")
      .filter({ hasText: "UI 编辑后" })
      .getByRole("button", { name: "恢复" })
      .click();
    await expect(
      page
        .locator(".admin-template-card")
        .filter({ hasText: "UI 编辑后" })
        .locator("[data-status='published']"),
    ).toBeVisible();
    const visibleAfterRestore = await page.request.get(
      "/api/templates?space=public&q=UI 编辑后",
    );
    expect(
      (
        (await visibleAfterRestore.json()) as {
          items: Array<{ id: string }>;
        }
      ).items,
    ).toHaveLength(1);
    await ignoreAdminGraphAbort(page);

    await test.step(
      "TPL-S02 同一模板重新打开也按编辑会话隔离",
      async () => {
        const originalBody = await adminGraphListPayload(page);
        const firstBody = JSON.stringify({ error: "old editor session failed" });
        const secondBody = graphPayloadForTemplate(
          originalBody,
          fixtureA.id,
          "TPL-A-SECOND-READ",
        );
        const gate = await installAdminGraphReadGate(page, originalBody);
        await cardFor(fixtureA.id).getByRole("button", { name: "编辑" }).click();
        await expect.poll(() => gate.pending.length).toBe(1);
        await isolationModal
          .getByRole("button", { name: "关闭公共模板弹窗" })
          .click();
        await cardFor(fixtureA.id).getByRole("button", { name: "编辑" }).click();
        await expect.poll(() => gate.pending.length).toBe(2);
        await gate.release(1, { body: secondBody });
        await waitForUiRender(page);
        await expect(isolationModal.getByLabel(/模板图 JSON/)).toHaveValue(
          /TPL-A-SECOND-READ/,
        );
        await gate.release(0, { body: firstBody, status: 500 });
        await waitForUiRender(page);
        await expect(isolationModal.getByLabel(/模板图 JSON/)).toHaveValue(
          /TPL-A-SECOND-READ/,
        );
        await expect(isolationModal.getByRole("alert")).toHaveCount(0);
        await expect(isolationModal).not.toContainText("正在读取模板内容");
        await isolationModal
          .getByRole("button", { name: "关闭公共模板弹窗" })
          .click();
        await gate.dispose();
      },
    );

    await test.step(
      "TPL-S03 关闭、取消、Escape、外点都会废弃旧读取",
      async () => {
        const closeActions = [
          async () => {
            await isolationModal
              .getByRole("button", { name: "关闭公共模板弹窗" })
              .click();
          },
          async () => {
            await isolationModal.getByRole("button", { name: "取消" }).click();
          },
          async () => {
            await page.keyboard.press("Escape");
          },
          async () => {
            await page
              .locator(".admin-template-modal-backdrop")
              .click({ position: { x: 4, y: 4 } });
          },
        ];
        for (const close of closeActions) {
          const gate = await installAdminGraphReadGate(
            page,
            await adminGraphListPayload(page),
          );
          await cardFor(fixtureA.id)
            .getByRole("button", { name: "编辑" })
            .click();
          await expect(isolationModal).toBeVisible();
          await expect.poll(() => gate.pending.length).toBe(1);
          await close();
          await expect(isolationModal).toHaveCount(0);
          await expect(
            cardFor(fixtureA.id).getByRole("button", { name: "编辑" }),
          ).toBeFocused();
          await gate.release(0);
          await waitForUiRender(page);
          await expect(isolationModal).toHaveCount(0);
          await gate.dispose();
        }

        const gate = await installAdminGraphReadGate(
          page,
          await adminGraphListPayload(page),
        );
        await cardFor(fixtureA.id).getByRole("button", { name: "编辑" }).click();
        await expect.poll(() => gate.pending.length).toBe(1);
        // 这个项目使用 location.href 做页面路由；用真实导航触发旧
        // AdminTemplatesPage 卸载，不能用 pushState 留在旧 React 树里。
        await page.goto("/canvas/projects");
        await expect(page.getByTestId("admin-templates-page")).toHaveCount(0);
        await expect(page.getByTestId("admin-template-modal")).toHaveCount(0);
        await expect(page.getByRole("alert")).toHaveCount(0);
        // 旧 document 已经销毁，返回值不可能再被它消费；这里只释放路由
        // handler 让请求收束，不把旧 document 的 JSON 消费当作验收条件。
        await gate.releaseForDocumentNavigation(0);
        await gate.dispose();

        await page.goto("/admin/templates");
        await expect(page.getByTestId("admin-templates-page")).toBeVisible();
        await ignoreAdminGraphAbort(page);
        await cardFor(fixtureA.id).getByRole("button", { name: "编辑" }).click();
        await expect(isolationModal).toBeVisible();
        await expect(isolationModal.getByLabel(/模板图 JSON/)).toHaveValue(/TPL-A/);
        await isolationModal.getByRole("button", { name: "取消" }).click();
      },
    );

    await test.step(
      "TPL-S04 新建连续选择 A、B、C 只接受最后来源",
      async () => {
        const gate = await installAdminGraphReadGate(
          page,
          await adminGraphListPayload(page),
        );
        await newTemplateButton.click();
        await expect(isolationModal).toBeVisible();
        await isolationModal.getByLabel(/模板标题/).fill("S04 自定义标题");
        const baseSelect = isolationModal
          .getByTestId("admin-template-base-select")
          .getByRole("combobox", { name: "基于现有模板（可选）" });
        const selectBase = async (title: string) => {
          await baseSelect.click();
          await isolationModal.getByRole("option", { name: title }).click();
        };
        await selectBase(fixtureA.title);
        await selectBase(fixtureB.title);
        await selectBase(fixtureC.title);
        await expect.poll(() => gate.pending.length).toBe(3);
        await gate.release(2);
        await gate.release(0);
        await gate.release(1);
        await waitForUiRender(page);
        await expect(baseSelect).toHaveAttribute("data-value", fixtureC.id);
        await expect(isolationModal.getByLabel(/模板标题/)).toHaveValue(
          "S04 自定义标题",
        );
        await expect(isolationModal.getByLabel(/模板图 JSON/)).toHaveValue(
          /TPL-C/,
        );
        await isolationModal.getByRole("button", { name: "取消" }).click();
        await gate.dispose();
      },
    );

    await test.step(
      "TPL-S05 空来源和失败来源都不能反向覆盖稳定草稿",
      async () => {
        const firstGate = await installAdminGraphReadGate(
          page,
          await adminGraphListPayload(page),
        );
        await newTemplateButton.click();
        const baseSelect = isolationModal
          .getByTestId("admin-template-base-select")
          .getByRole("combobox", { name: "基于现有模板（可选）" });
        await baseSelect.click();
        await isolationModal.getByRole("option", { name: fixtureA.title }).click();
        await baseSelect.click();
        await isolationModal
          .getByRole("option", { name: "不基于现有模板" })
          .click();
        await expect.poll(() => firstGate.pending.length).toBe(1);
        await firstGate.release(0, {
          body: JSON.stringify({ error: "late empty source failure" }),
          status: 500,
        });
        await waitForUiRender(page);
        await expect(baseSelect).toHaveAttribute("data-value", "");
        await expect(isolationModal.getByLabel(/模板图 JSON/)).toHaveValue("");
        await expect(isolationModal.getByRole("alert")).toHaveCount(0);
        await isolationModal.getByRole("button", { name: "取消" }).click();
        await firstGate.dispose();

        const secondGate = await installAdminGraphReadGate(
          page,
          await adminGraphListPayload(page),
        );
        await newTemplateButton.click();
        const secondBaseSelect = isolationModal
          .getByTestId("admin-template-base-select")
          .getByRole("combobox", { name: "基于现有模板（可选）" });
        await secondBaseSelect.click();
        await isolationModal.getByRole("option", { name: fixtureA.title }).click();
        await expect.poll(() => secondGate.pending.length).toBe(1);
        await secondGate.release(0);
        await waitForUiRender(page);
        const manualGraph = markedUploadPlaceholderGraph("S05-MANUAL");
        await isolationModal
          .getByLabel(/模板图 JSON/)
          .fill(JSON.stringify(manualGraph));
        await isolationModal.getByLabel(/模板标题/).fill("S05 手工标题");
        await secondBaseSelect.click();
        await isolationModal.getByRole("option", { name: fixtureB.title }).click();
        await expect.poll(() => secondGate.pending.length).toBe(2);
        await secondGate.release(1, {
          body: JSON.stringify({ error: "synthetic source failure" }),
          status: 500,
        });
        await waitForUiRender(page);
        await expect(isolationModal.getByRole("alert")).toContainText(
          "来源模板读取失败",
        );
        await expect(secondBaseSelect).toHaveAttribute("data-value", "");
        await expect(isolationModal.getByLabel(/模板标题/)).toHaveValue(
          "S05 手工标题",
        );
        await expect(isolationModal.getByLabel(/模板图 JSON/)).toHaveValue(
          JSON.stringify(manualGraph),
        );
        await isolationModal.getByLabel(/模板标题/).fill("S05 M 可保存");
        await isolationModal.getByRole("button", { name: "保存" }).click();
        await expect(isolationModal).toHaveCount(0);
        const savedManual = await page.request.get(
          "/api/admin/templates?limit=100&offset=0&includeGraph=true",
        );
        const savedManualBody = await savedManual.json() as {
          items: Array<{ graph?: unknown; title: string }>;
        };
        const savedManualItem = savedManualBody.items.find(
          (item) => item.title === "S05 M 可保存",
        );
        if (!savedManualItem) throw new Error("S05 manual template was not saved");
        expect(JSON.stringify(savedManualItem.graph)).toContain("S05-MANUAL");
        await secondGate.dispose();
      },
    );

    await test.step(
      "TPL-S06 手工 JSON 优先于编辑中的迟到读取并可真实保存",
      async () => {
        const gate = await installAdminGraphReadGate(
          page,
          await adminGraphListPayload(page),
        );
        await cardFor(fixtureC.id).getByRole("button", { name: "编辑" }).click();
        await expect.poll(() => gate.pending.length).toBe(1);
        const manualGraph = markedUploadPlaceholderGraph("S06-MANUAL");
        const manualJson = JSON.stringify(manualGraph);
        await isolationModal.getByLabel(/模板图 JSON/).fill(manualJson);
        await gate.release(0, {
          body: JSON.stringify({ error: "late initial graph failure" }),
          status: 500,
        });
        await waitForUiRender(page);
        await expect(isolationModal.getByRole("alert")).toHaveCount(0);
        await expect(isolationModal.getByLabel(/模板图 JSON/)).toHaveValue(
          manualJson,
        );
        await isolationModal.getByLabel(/模板标题/).fill("S06 C 手工内容");
        await isolationModal.getByRole("button", { name: "保存" }).click();
        await expect(isolationModal).toHaveCount(0);
        const saved = await readAdminUiTemplate(page, fixtureC.id);
        expect(saved.title).toBe("S06 C 手工内容");
        expect(JSON.stringify(saved.graph)).toContain("S06-MANUAL");
        fixtureC.title = "S06 C 手工内容";
        await gate.dispose();
      },
    );

    await test.step("TPL-S06 来源读取期间手改，迟到成功或失败都不能覆盖，并真实保存", async () => {
      for (const status of [200, 500]) {
        const gate = await installAdminGraphReadGate(page, await adminGraphListPayload(page));
        await newTemplateButton.click();
        const base = isolationModal.getByTestId("admin-template-base-select").getByRole("combobox");
        await base.click();
        await isolationModal.getByRole("option", { name: fixtureA.title, exact: true }).click();
        await expect.poll(() => gate.pending.length).toBe(1);
        const marker = `S06-SOURCE-MANUAL-${status}`;
        const manual = JSON.stringify(markedUploadPlaceholderGraph(marker));
        await isolationModal.getByLabel(/模板图 JSON/).fill(manual);
        await expect(base).toHaveAttribute("data-value", "");
        await gate.release(0, status === 500 ? {
          body: JSON.stringify({ error: "过期来源失败" }), status,
        } : {});
        await expect(isolationModal.getByLabel(/模板图 JSON/)).toHaveValue(manual);
        await expect(isolationModal.getByRole("alert")).toHaveCount(0);
        const title = `S06 来源手工保存 ${status}`;
        await isolationModal.getByLabel(/模板标题/).fill(title);
        await isolationModal.getByRole("button", { name: "保存", exact: true }).click();
        await expect(isolationModal).toHaveCount(0);
        const created = page.locator(".admin-template-card").filter({ hasText: title });
        await expect(created).toBeVisible();
        const testId = await created.getAttribute("data-testid");
        expect(testId).toBeTruthy();
        const saved = readPublicTemplateDbRow(dataDirectory, testId!.replace("admin-template-", ""));
        expect(saved.graph).toContain(marker);
        await gate.dispose();
      }
    });

    await test.step(
      "TPL-S07 精确图缺失时明确失败，改标题不回写空图",
      async () => {
        const originalBody = await adminGraphListPayload(page);
        const beforeDb = readPublicTemplateDbRow(dataDirectory, fixtureA.id);
        const gate = await installAdminGraphReadGate(page, originalBody);
        await cardFor(fixtureA.id).getByRole("button", { name: "编辑" }).click();
        await expect.poll(() => gate.pending.length).toBe(1);
        await gate.release(0, {
          body: graphPayloadWithoutTemplate(originalBody, fixtureA.id),
        });
        await waitForUiRender(page);
        await expect(isolationModal.getByRole("alert")).toContainText(
          "读取失败",
        );
        await expect(
          isolationModal.getByRole("button", { name: "重新读取模板内容" }),
        ).toBeVisible();
        await isolationModal
          .getByRole("button", { name: "重新读取模板内容" })
          .click();
        await expect.poll(() => gate.pending.length).toBe(2);
        await gate.release(1, {
          body: JSON.stringify({ error: "retry graph failure" }),
          status: 500,
        });
        await waitForUiRender(page);
        await expect(isolationModal.getByRole("alert")).toContainText(
          "读取失败",
        );
        await isolationModal
          .getByRole("button", { name: "重新读取模板内容" })
          .click();
        await expect.poll(() => gate.pending.length).toBe(3);
        await gate.release(2, {
          body: graphPayloadMissingGraph(originalBody, fixtureA.id),
        });
        await waitForUiRender(page);
        await expect(isolationModal.getByRole("alert")).toContainText(
          "读取失败",
        );
        const patchBodies: Array<Record<string, unknown>> = [];
        let postCount = 0;
        const onRequest = (request: any) => {
          const url = new URL(request.url());
          if (
            request.method() === "POST" &&
            url.pathname === "/api/admin/templates"
          ) {
            postCount += 1;
          }
          if (
            request.method() === "PATCH" &&
            url.pathname === `/api/admin/templates/${fixtureA.id}`
          ) {
            patchBodies.push(requestBody(request));
          }
        };
        page.on("request", onRequest);
        await isolationModal.getByLabel(/模板标题/).fill("S07 A 只改标题");
        await isolationModal.getByRole("button", { name: "保存" }).click();
        await expect.poll(() => patchBodies.length).toBe(1);
        expect(Object.hasOwn(patchBodies[0], "graph")).toBe(false);
        await expect(isolationModal).toHaveCount(0);
        page.off("request", onRequest);
        expect(postCount).toBe(0);
        const saved = await readAdminUiTemplate(page, fixtureA.id);
        expect(saved.title).toBe("S07 A 只改标题");
        expect(JSON.stringify(saved.graph)).toContain(fixtureA.marker);
        const savedDb = readPublicTemplateDbRow(dataDirectory, fixtureA.id);
        expect(savedDb.title).toBe("S07 A 只改标题");
        expect(savedDb.graph).toBe(beforeDb.graph);
        fixtureA.title = "S07 A 只改标题";
        await gate.dispose();
      },
    );

    await test.step(
      "TPL-S08 初始读取中可只保存元数据，新建来源中禁止保存",
      async () => {
        const beforeA = await readAdminUiTemplate(page, fixtureA.id);
        const beforeDb = readPublicTemplateDbRow(dataDirectory, fixtureA.id);
        const originalBody = await adminGraphListPayload(page);
        const gate = await installAdminGraphReadGate(page, originalBody);
        const patchBodies: Array<Record<string, unknown>> = [];
        const onRequest = (request: any) => {
          const url = new URL(request.url());
          if (
            request.method() === "PATCH" &&
            url.pathname === `/api/admin/templates/${fixtureA.id}`
          ) {
            patchBodies.push(requestBody(request));
          }
        };
        page.on("request", onRequest);
        await cardFor(fixtureA.id).getByRole("button", { name: "编辑" }).click();
        await expect.poll(() => gate.pending.length).toBe(1);
        await isolationModal.getByLabel(/模板标题/).fill("S08 A 读中改名");
        await isolationModal.getByRole("button", { name: "保存" }).click();
        await expect.poll(() => patchBodies.length).toBe(1);
        expect(Object.hasOwn(patchBodies[0], "graph")).toBe(false);
        await expect(isolationModal).toHaveCount(0);
        await gate.release(0);
        await waitForUiRender(page);
        fixtureA.title = "S08 A 读中改名";
        const afterA = await readAdminUiTemplate(page, fixtureA.id);
        expect(afterA.title).toBe("S08 A 读中改名");
        expect(afterA.graph).toEqual(beforeA.graph);
        const afterDb = readPublicTemplateDbRow(dataDirectory, fixtureA.id);
        expect(afterDb.title).toBe("S08 A 读中改名");
        expect(afterDb.graph).toBe(beforeDb.graph);
        await gate.dispose();
        page.off("request", onRequest);

        const pendingPosts: string[] = [];
        const watchPendingPost = (request: any) => {
          if (request.method() === "POST" && new URL(request.url()).pathname === "/api/admin/templates") pendingPosts.push(request.url());
        };
        page.on("request", watchPendingPost);
        const sourceGate = await installAdminGraphReadGate(
          page,
          await adminGraphListPayload(page),
        );
        await newTemplateButton.click();
        const baseSelect = isolationModal
          .getByTestId("admin-template-base-select")
          .getByRole("combobox", { name: "基于现有模板（可选）" });
        await baseSelect.click();
        await isolationModal.getByRole("option", { name: fixtureC.title }).click();
        await expect.poll(() => sourceGate.pending.length).toBe(1);
        const saveButton = isolationModal.getByRole("button", { name: "保存" });
        await expect(saveButton).toBeDisabled();
        await saveButton.dispatchEvent("click");
        await waitForUiRender(page);
        expect(pendingPosts).toHaveLength(0);
        page.off("request", watchPendingPost);
        await isolationModal.getByRole("button", { name: "取消" }).click();
        await sourceGate.release(0);
        await sourceGate.dispose();

        const invalidPostRequests: string[] = [];
        const onInvalidRequest = (request: any) => {
          if (
            request.method() === "POST" &&
            new URL(request.url()).pathname === "/api/admin/templates"
          ) {
            invalidPostRequests.push(request.url());
          }
        };
        page.on("request", onInvalidRequest);
        await newTemplateButton.click();
        await isolationModal.getByLabel(/模板标题/).fill("S08 非法 JSON");
        await isolationModal.getByLabel(/模板图 JSON/).fill("{bad-json");
        await isolationModal.getByRole("button", { name: "保存" }).click();
        await expect(isolationModal.getByRole("alert")).toContainText("JSON 无法解析");
        expect(invalidPostRequests).toHaveLength(0);
        await expect(isolationModal.getByLabel(/模板标题/)).toHaveValue("S08 非法 JSON");
        await expect(isolationModal.getByLabel(/模板图 JSON/)).toHaveValue("{bad-json");
        await isolationModal.getByRole("button", { name: "取消" }).click();
        page.off("request", onInvalidRequest);
      },
    );

    await test.step(
      "TPL-S09 新建和编辑快速双击都只产生一次真实写入",
      async () => {
        const createGate = await installTemplatePostGate(page);
        const createTitle = "S09 双击新建";
        expect(countPublicTemplateRows(dataDirectory, createTitle)).toBe(0);
        await newTemplateButton.click();
        const createGraph = JSON.stringify(markedUploadPlaceholderGraph("S09-CREATE"));
        await isolationModal.getByLabel(/模板标题/).fill(createTitle);
        await isolationModal.getByLabel(/模板图 JSON/).fill(createGraph);
        const createSave = isolationModal.getByRole("button", { name: "保存" });
        await createSave.evaluate((button: HTMLElement) => {
          button.click();
          button.click();
        });
        await expect.poll(() => createGate.pending.length).toBe(1);
        await createGate.release(0);
        await createGate.dispose();
        expect(countPublicTemplateRows(dataDirectory, createTitle)).toBe(1);
        await expect(
          page.locator(".admin-template-card").filter({ hasText: createTitle }),
        ).toBeVisible();
        expect(
          (
            (await (
              await page.request.get(
                "/api/admin/templates?limit=100&offset=0&includeGraph=false",
              )
            ).json()) as { items: Array<{ title: string }> }
          ).items.filter((item) => item.title === "S09 双击新建"),
        ).toHaveLength(1);

        // 用行 data-testid 解析 ID，避免用标题作为写入目标。
        const createdS09Card = page
          .locator(".admin-template-card")
          .filter({ hasText: createTitle });
        const createdS09TestId = await createdS09Card.getAttribute("data-testid");
        if (!createdS09TestId) throw new Error("S09 created card has no test id");
        const createdS09Id = createdS09TestId.replace("admin-template-", "");
        const beforeEditRow = readPublicTemplateDbRow(dataDirectory, createdS09Id);
        const editGate = await installTemplatePatchGate(page, createdS09Id);
        await createdS09Card.getByRole("button", { name: "编辑" }).click();
        await expect(isolationModal.getByLabel(/模板图 JSON/)).toHaveValue(
          /S09-CREATE/,
        );
        await isolationModal.getByLabel(/模板标题/).fill("S09 双击编辑");
        const editSave = isolationModal.getByRole("button", { name: "保存" });
        await editSave.evaluate((button: HTMLElement) => {
          button.click();
          button.click();
        });
        await expect.poll(() => editGate.seen()).toBe(true);
        expect(editGate.extraPatchCount()).toBe(0);
        await editGate.release();
        await editGate.dispose();
        await expect(
          page.locator(".admin-template-card").filter({ hasText: "S09 双击编辑" }),
        ).toBeVisible();
        const afterEditRow = readPublicTemplateDbRow(dataDirectory, createdS09Id);
        expect(afterEditRow.id).toBe(createdS09Id);
        expect(afterEditRow.title).toBe("S09 双击编辑");
        expect(afterEditRow.graph).toBe(beforeEditRow.graph);
        expect(countPublicTemplateRows(dataDirectory, createTitle)).toBe(0);
        expect(countPublicTemplateRows(dataDirectory, "S09 双击编辑")).toBe(1);
      },
    );

    await test.step(
      "TPL-S10 A 保存中冻结 A，B 可编辑且等待上一项保存",
      async () => {
        const gate = await installTemplatePatchGate(page, fixtureA.id);
        await cardFor(fixtureA.id).getByRole("button", { name: "编辑" }).click();
        await expect(isolationModal).toBeVisible();
        await expect(isolationModal.getByLabel(/模板图 JSON/)).toHaveValue(
          /TPL-A/,
        );
        await isolationModal.getByLabel(/模板标题/).fill("S10 A 保存中");
        await isolationModal.getByRole("button", { name: "保存" }).click();
        await expect.poll(() => gate.seen()).toBe(true);
        await expect(isolationModal.getByLabel(/模板标题/)).toBeDisabled();
        await expect(isolationModal.getByLabel("说明（可选）", { exact: true })).toBeDisabled();
        await expect(
          isolationModal
            .getByTestId("admin-template-status-select")
            .getByRole("combobox", { name: "状态" }),
        ).toBeDisabled();
        await expect(isolationModal.getByRole("checkbox", { name: "工具" }))
          .toBeDisabled();
        await expect(isolationModal.getByLabel(/封面路径/)).toBeDisabled();
        await expect(isolationModal.getByLabel(/模板图 JSON/)).toBeDisabled();
        // 即使 DOM 禁用属性被移除，保存期间的两个输入 handler 仍必须拒绝修改。
        for (const field of [isolationModal.getByLabel(/模板标题/), isolationModal.getByLabel(/模板图 JSON/)]) {
          const before = await field.inputValue();
          await field.evaluate((element: HTMLInputElement | HTMLTextAreaElement) => { element.disabled = false; });
          await field.fill("S10 不应接受的在途改动");
          await expect(field).toHaveValue(before);
          await field.evaluate((element: HTMLInputElement | HTMLTextAreaElement) => { element.disabled = true; });
        }
        await isolationModal
          .getByRole("button", { name: "关闭公共模板弹窗" })
          .click();
        await cardFor(fixtureB.id).getByRole("button", { name: "编辑" }).click();
        await expect(isolationModal).toBeVisible();
        await expect(isolationModal.getByRole("button", { name: "等待上一项保存" }))
          .toBeDisabled();
        await isolationModal.getByLabel(/模板标题/).fill("S10 B 等待后保存");
        await gate.release();
        await gate.dispose();
        await expect(isolationModal).toBeVisible();
        await expect(isolationModal.getByLabel(/模板标题/)).toHaveValue(
          "S10 B 等待后保存",
        );
        await isolationModal.getByRole("button", { name: "保存" }).click();
        await expect(isolationModal).toHaveCount(0);
        expect((await readAdminUiTemplate(page, fixtureA.id)).title).toBe(
          "S10 A 保存中",
        );
        expect((await readAdminUiTemplate(page, fixtureB.id)).title).toBe(
          "S10 B 等待后保存",
        );
        fixtureA.title = "S10 A 保存中";
        fixtureB.title = "S10 B 等待后保存";

        await test.step(
          "TPL-S10 A 关闭后迟到失败不污染 B，失败后可继续保存",
          async () => {
            const beforeA = await readAdminUiTemplate(page, fixtureA.id);
            const failedGate = await installRetryableTemplatePatchGate(
              page,
              fixtureA.id,
            );
            await cardFor(fixtureA.id)
              .getByRole("button", { name: "编辑" })
              .click();
            await isolationModal.getByLabel(/模板标题/).fill("S10 A 迟到失败");
            await isolationModal.getByRole("button", { name: "保存" }).click();
            await expect.poll(() => failedGate.pending.length).toBe(1);
            await expect(isolationModal.getByLabel(/模板标题/)).toBeDisabled();
            await expect(isolationModal.getByLabel("说明（可选）", { exact: true })).toBeDisabled();
            await expect(
              isolationModal
                .getByTestId("admin-template-status-select")
                .getByRole("combobox", { name: "状态" }),
            ).toBeDisabled();
            await expect(isolationModal.getByRole("checkbox", { name: "工具" }))
              .toBeDisabled();
            await expect(isolationModal.getByLabel(/封面路径/)).toBeDisabled();
            await expect(isolationModal.getByLabel(/模板图 JSON/)).toBeDisabled();
            await isolationModal
              .getByRole("button", { name: "关闭公共模板弹窗" })
              .click();

            await cardFor(fixtureB.id)
              .getByRole("button", { name: "编辑" })
              .click();
            await expect(isolationModal).toBeVisible();
            await expect(
              isolationModal.getByRole("button", { name: "等待上一项保存" }),
            ).toBeDisabled();
            const bTitle = "S10 B A失败后可保存";
            await isolationModal.getByLabel(/模板标题/).fill(bTitle);
            await failedGate.release(0, {
              body: JSON.stringify({ error: "模拟 A 保存失败" }),
              status: 500,
            });
            await waitForUiRender(page);
            await expect(isolationModal).toBeVisible();
            await expect(isolationModal.getByRole("alert")).toHaveCount(0);
            await expect(isolationModal.getByLabel(/模板标题/)).toHaveValue(bTitle);
            await expect(
              isolationModal.getByRole("button", { name: "保存", exact: true }),
            ).toBeEnabled();
            await isolationModal
              .getByRole("button", { name: "保存", exact: true })
              .click();
            await expect(isolationModal).toHaveCount(0);
            await failedGate.dispose();

            expect((await readAdminUiTemplate(page, fixtureA.id)).title).toBe(
              beforeA.title,
            );
            expect((await readAdminUiTemplate(page, fixtureB.id)).title).toBe(
              bTitle,
            );
            fixtureB.title = bTitle;
          },
        );

        // 同一会话的失败必须留住草稿并允许重试，且失败发生时不能把窗口状态
        // 或错误传播给另一个仍可编辑的模板。
        const retryGate = await installRetryableTemplatePatchGate(
          page,
          fixtureC.id,
        );
        await cardFor(fixtureC.id).getByRole("button", { name: "编辑" }).click();
        await expect(isolationModal).toBeVisible();
        await isolationModal.getByLabel(/模板标题/).fill("S10 C 首次提交");
        await isolationModal.getByRole("button", { name: "保存" }).click();
        await expect.poll(() => retryGate.pending.length).toBe(1);
        await expect(isolationModal).toContainText("保存中");
        await expect(isolationModal).toContainText("关闭窗口后仍会继续保存");
        await expect(isolationModal.getByLabel(/模板标题/)).toBeDisabled();
        await expect(isolationModal.getByLabel("说明（可选）", { exact: true })).toBeDisabled();
        await expect(isolationModal.getByLabel(/模板图 JSON/)).toBeDisabled();
        await retryGate.release(0, {
          body: JSON.stringify({ error: "模拟保存失败" }),
          status: 500,
        });
        await waitForUiRender(page);
        await expect(isolationModal).toBeVisible();
        await expect(isolationModal.getByRole("alert")).toContainText("模拟保存失败");
        await expect(isolationModal.getByLabel(/模板标题/)).toHaveValue(
          "S10 C 首次提交",
        );
        await expect(isolationModal.getByRole("button", { name: "保存" }))
          .toBeEnabled();
        await isolationModal.getByLabel(/模板标题/).fill("S10 C 重试成功");
        await isolationModal.getByRole("button", { name: "保存" }).click();
        await expect.poll(() => retryGate.pending.length).toBe(2);
        await retryGate.release(1);
        await expect(isolationModal).toHaveCount(0);
        await retryGate.dispose();
        expect((await readAdminUiTemplate(page, fixtureC.id)).title).toBe(
          "S10 C 重试成功",
        );
        fixtureC.title = "S10 C 重试成功";
      },
    );

    await test.step(
      "TPL-S11 只改元数据不发图，图和元数据同一次提交，空白编辑保留原图",
      async () => {
        const before = await readAdminUiTemplate(page, fixtureA.id);
        const beforeRow = readPublicTemplateDbRow(dataDirectory, fixtureA.id);
        const metadataBodies: Array<Record<string, unknown>> = [];
        const onMetadataRequest = (request: any) => {
          const url = new URL(request.url());
          if (
            request.method() === "PATCH" &&
            url.pathname === `/api/admin/templates/${fixtureA.id}`
          ) {
            metadataBodies.push(requestBody(request));
          }
        };
        page.on("request", onMetadataRequest);
        await cardFor(fixtureA.id).getByRole("button", { name: "编辑" }).click();
        await expect(isolationModal.getByLabel(/模板图 JSON/)).toHaveValue(
          /TPL-A/,
        );
        await isolationModal.getByLabel(/模板标题/).fill("S11 A 只改元数据");
        await isolationModal.getByRole("button", { name: "保存" }).click();
        await expect.poll(() => metadataBodies.length).toBe(1);
        expect(Object.hasOwn(metadataBodies[0], "graph")).toBe(false);
        await expect(isolationModal).toHaveCount(0);
        const afterMetadata = await readAdminUiTemplate(page, fixtureA.id);
        expect(JSON.stringify(afterMetadata.graph)).toBe(JSON.stringify(before.graph));
        const afterMetadataRow = readPublicTemplateDbRow(dataDirectory, fixtureA.id);
        expect(afterMetadataRow.title).toBe("S11 A 只改元数据");
        expect(afterMetadataRow.graph).toBe(beforeRow.graph);

        await cardFor(fixtureA.id).getByRole("button", { name: "编辑" }).click();
        const combinedGraph = markedUploadPlaceholderGraph("S11-COMBINED");
        const combinedBodies: Array<Record<string, unknown>> = [];
        const onCombinedRequest = (request: any) => {
          const url = new URL(request.url());
          if (
            request.method() === "PATCH" &&
            url.pathname === `/api/admin/templates/${fixtureA.id}`
          ) {
            combinedBodies.push(requestBody(request));
          }
        };
        page.on("request", onCombinedRequest);
        await isolationModal.getByLabel(/模板标题/).fill("S11 A 图和元数据");
        await isolationModal
          .getByLabel(/模板图 JSON/)
          .fill(JSON.stringify(combinedGraph));
        await isolationModal.getByRole("button", { name: "保存" }).click();
        await expect.poll(() => combinedBodies.length).toBe(1);
        expect(Object.hasOwn(combinedBodies[0], "graph")).toBe(true);
        await expect(isolationModal).toHaveCount(0);
        page.off("request", onCombinedRequest);
        const afterCombined = await readAdminUiTemplate(page, fixtureA.id);
        expect(afterCombined.title).toBe("S11 A 图和元数据");
        expect(JSON.stringify(afterCombined.graph)).toContain("S11-COMBINED");
        const afterCombinedRow = readPublicTemplateDbRow(dataDirectory, fixtureA.id);
        expect(afterCombinedRow.title).toBe("S11 A 图和元数据");
        expect(JSON.parse(afterCombinedRow.graph)).toMatchObject({
          nodes: expect.arrayContaining([
            expect.objectContaining({
              data: expect.objectContaining({
                textPrompt: expect.stringContaining("S11-COMBINED"),
              }),
            }),
          ]),
        });

        await cardFor(fixtureA.id).getByRole("button", { name: "编辑" }).click();
        await expect(isolationModal.getByLabel(/模板图 JSON/)).toHaveValue(/S11-COMBINED/);
        const preservedGraph = await isolationModal.getByLabel(/模板图 JSON/).inputValue();
        await isolationModal.getByLabel(/模板标题/).fill("S11 A 空白图");
        await isolationModal.getByLabel(/模板图 JSON/).fill("");
        const blankBodies: Array<Record<string, unknown>> = [];
        const onBlankRequest = (request: any) => {
          const url = new URL(request.url());
          if (
            request.method() === "PATCH" &&
            url.pathname === `/api/admin/templates/${fixtureA.id}`
          ) {
            blankBodies.push(requestBody(request));
          }
        };
        page.on("request", onBlankRequest);
        await isolationModal.getByRole("button", { name: "保存" }).click();
        await expect.poll(() => blankBodies.length).toBe(1);
        expect(Object.hasOwn(blankBodies[0], "graph")).toBe(false);
        await expect(isolationModal).toHaveCount(0);
        page.off("request", onBlankRequest);
        expect(
          JSON.stringify((await readAdminUiTemplate(page, fixtureA.id)).graph),
        ).toContain("S11-COMBINED");
        expect(preservedGraph).toContain("S11-COMBINED");
        const afterBlankRow = readPublicTemplateDbRow(dataDirectory, fixtureA.id);
        expect(afterBlankRow.title).toBe("S11 A 空白图");
        expect(afterBlankRow.graph).toBe(afterCombinedRow.graph);
        fixtureA.title = "S11 A 空白图";

        await newTemplateButton.click();
        await isolationModal.getByLabel(/模板标题/).fill("S11 新建空白");
        await isolationModal.getByRole("button", { name: "保存" }).click();
        await expect(isolationModal.getByRole("alert")).toContainText("请填写模板图 JSON");
        expect(countPublicTemplateRows(dataDirectory, "S11 新建空白")).toBe(0);
        await isolationModal.getByRole("button", { name: "取消" }).click();
      },
    );

    await test.step(
      "TPL-S12 原有公共模板 CRUD、发布和归档语义仍保持可用",
      async () => {
        await expect(page.getByTestId("admin-templates-page")).toBeVisible();
        await expect(page.getByTestId("admin-templates-list")).toContainText(
          "电商详情页工作流",
        );
        await expect(cardFor(fixtureA.id)).toBeVisible();
        await expect(cardFor(fixtureA.id).locator("[data-status='draft']"))
          .toBeVisible();
      },
    );

    await test.step(
      "TPL-S13 1280x720 和 720x900 下读取、等待和弹窗内容保持可达",
      async () => {
        for (const viewport of [
          { height: 720, width: 1280 },
          { height: 900, width: 720 },
        ]) {
          await page.setViewportSize(viewport);
          await page.goto("/admin/templates");
          await expect(page.getByTestId("admin-templates-page")).toBeVisible();
          await ignoreAdminGraphAbort(page);
          const dimensions = await page.evaluate(() => ({
            clientWidth: document.documentElement.clientWidth,
            scrollWidth: document.documentElement.scrollWidth,
          }));
          expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);

          const graphGate = await installAdminGraphReadGate(
            page,
            await adminGraphListPayload(page),
          );
          await cardFor(fixtureA.id).getByRole("button", { name: "编辑" }).click();
          await expect(isolationModal).toBeVisible();
          await expect(isolationModal).toContainText("正在读取模板内容");
          await isolationModal.getByLabel(/模板图 JSON/).focus();
          await captureTemplateUiEvidence(
            page,
            viewport.width,
            viewport.height,
            "reading",
          );
          await graphGate.release(0);
          await expect(isolationModal.getByLabel(/模板图 JSON/)).toBeFocused();
          await expect(isolationModal.getByLabel(/模板图 JSON/)).toHaveValue(
            /S11-COMBINED/,
          );
          const modalBox = await isolationModal.boundingBox();
          if (!modalBox) throw new Error("template modal has no bounding box");
          expect(modalBox.x).toBeGreaterThanOrEqual(0);
          expect(modalBox.x + modalBox.width).toBeLessThanOrEqual(viewport.width + 1);
          await isolationModal.getByLabel(/模板图 JSON/).scrollIntoViewIfNeeded();
          await expect(isolationModal.getByRole("button", { name: "保存" })).toBeVisible();
          await expect(
            isolationModal.getByRole("button", { name: "关闭公共模板弹窗" }),
          ).toBeVisible();
          await isolationModal.getByRole("button", { name: "取消" }).click();
          await graphGate.dispose();

          const errorGate = await installAdminGraphReadGate(
            page,
            await adminGraphListPayload(page),
          );
          await cardFor(fixtureA.id).getByRole("button", { name: "编辑" }).click();
          await expect.poll(() => errorGate.pending.length).toBe(1);
          await errorGate.release(0, {
            body: JSON.stringify({ error: "S13 graph read failure" }),
            status: 500,
          });
          await expect(isolationModal.getByRole("alert")).toContainText("读取失败");
          await captureTemplateUiEvidence(
            page,
            viewport.width,
            viewport.height,
            "error",
          );
          await isolationModal.getByRole("button", { name: "取消" }).click();
          await errorGate.dispose();

          const savingGate = await installTemplatePatchGate(page, fixtureA.id);
          await cardFor(fixtureA.id).getByRole("button", { name: "编辑" }).click();
          await expect(isolationModal.getByLabel(/模板图 JSON/)).toHaveValue(
            /S11-COMBINED/,
          );
          const viewportTitle = `S13 ${viewport.width} A 保存`;
          await isolationModal.getByLabel(/模板标题/).fill(viewportTitle);
          await isolationModal.getByRole("button", { name: "保存" }).click();
          await expect.poll(() => savingGate.seen()).toBe(true);
          await captureTemplateUiEvidence(
            page,
            viewport.width,
            viewport.height,
            "saving",
          );
          await isolationModal
            .getByRole("button", { name: "关闭公共模板弹窗" })
            .click();
          await cardFor(fixtureB.id).getByRole("button", { name: "编辑" }).click();
          await expect(isolationModal.getByRole("button", { name: "等待上一项保存" }))
            .toBeDisabled();
          await captureTemplateUiEvidence(
            page,
            viewport.width,
            viewport.height,
            "waiting",
          );
          await isolationModal.getByRole("button", { name: "取消" }).click();
          await savingGate.release();
          await savingGate.dispose();
          fixtureA.title = viewportTitle;
        }
        await page.setViewportSize({ height: 720, width: 1280 });
      },
    );

    await test.step(
      "TPL-S14 保存 A 时禁止同模板读取，解锁后重新读取真实新内容",
      async () => {
        await page.goto("/admin/templates");
        await ignoreAdminGraphAbort(page);
        const gate = await installTemplatePatchGate(page, fixtureA.id);
        await cardFor(fixtureA.id).getByRole("button", { name: "编辑" }).click();
        const newGraph = markedUploadPlaceholderGraph("S14-SAVED");
        await isolationModal.getByLabel(/模板标题/).fill("S14 A 新内容");
        await isolationModal.getByLabel(/模板图 JSON/).fill(JSON.stringify(newGraph));
        await isolationModal.getByRole("button", { name: "保存" }).click();
        await expect.poll(() => gate.seen()).toBe(true);
        await isolationModal
          .getByRole("button", { name: "关闭公共模板弹窗" })
          .click();

        const graphReads: string[] = [];
        const onGraphRead = (request: any) => {
          const url = new URL(request.url());
          if (
            request.method() === "GET" &&
            /^\/api\/admin\/templates\/[a-f0-9-]{36}$/i.test(url.pathname) &&
            request.method() === "GET"
          ) {
            graphReads.push(request.url());
          }
        };
        page.on("request", onGraphRead);
        await cardFor(fixtureA.id)
          .getByRole("button", { name: "编辑" })
          .click({ force: true });
        await expect.poll(() => graphReads.length).toBe(0);
        if (await isolationModal.isVisible()) {
          await isolationModal.getByRole("button", { name: "取消" }).click();
        }

        await newTemplateButton.click();
        const baseSelect = isolationModal
          .getByTestId("admin-template-base-select")
          .getByRole("combobox", { name: "基于现有模板（可选）" });
        await baseSelect.click();
        const sourceOption = isolationModal.getByRole("option", { name: fixtureA.title });
        await expect(sourceOption).toBeDisabled();
        await expect.poll(() => graphReads.length).toBe(0);
        await baseSelect.click();
        await isolationModal.getByRole("button", { name: "取消" }).click();
        await cardFor(fixtureB.id).getByRole("button", { name: "编辑" }).click();
        await expect(isolationModal.getByLabel(/模板图 JSON/)).toHaveValue(/TPL-B/);
        await expect.poll(() => graphReads.length).toBe(1);
        await expect(isolationModal.getByRole("button", { name: "等待上一项保存" })).toBeDisabled();
        await isolationModal.getByRole("button", { name: "取消" }).click();
        page.off("request", onGraphRead);
        await gate.release();
        await gate.dispose();

        await cardFor(fixtureA.id).getByRole("button", { name: "编辑" }).click();
        await expect(isolationModal.getByLabel(/模板图 JSON/)).toHaveValue(
          /S14-SAVED/,
        );
        await isolationModal.getByRole("button", { name: "取消" }).click();
        const saved = await readAdminUiTemplate(page, fixtureA.id);
        expect(saved.title).toBe("S14 A 新内容");
        expect(JSON.stringify(saved.graph)).toContain("S14-SAVED");
      },
    );

    await test.step(
      "TPL-S14 保存确认先更新行并解锁，保存前的迟到列表不能覆盖新记录",
      async () => {
        const beforeA = await readAdminUiTemplate(page, fixtureA.id);
        const beforeB = await readAdminUiTemplate(page, fixtureB.id);
        const staleList = JSON.stringify(await (
          await page.request.get(
            "/api/admin/templates?limit=100&offset=0&includeGraph=false",
          )
        ).json());
        const listGate = await installAdminListReadGate(page);
        // B 的正常状态写触发一次保存 A 之前的列表读取，将其暂停。
        await cardFor(fixtureB.id).getByRole("button", {
          name: beforeB.status === "published" ? "下架" : "发布",
          exact: true,
        }).click();
        await expect.poll(() => listGate.pending.length).toBe(1);

        const title = "S14 迟到列表后的新标题";
        const graph = markedUploadPlaceholderGraph("S14-LIST-COMMIT");
        await cardFor(fixtureA.id).getByRole("button", { name: "编辑" }).click();
        await isolationModal.getByLabel(/模板标题/).fill(title);
        await isolationModal
          .getByLabel(/模板图 JSON/)
          .fill(JSON.stringify(graph));
        await isolationModal
          .getByRole("button", { name: "保存", exact: true })
          .click();
        await expect(isolationModal).toHaveCount(0);
        await expect.poll(() => listGate.pending.length).toBe(2);
        // 连保存后的列表也尚未返回，界面必须已采用 PATCH 确认记录。
        await expect(cardFor(fixtureA.id).locator("strong")).toHaveText(title);
        await expect(
          cardFor(fixtureA.id).getByRole("button", { name: "编辑" }),
        ).toBeEnabled();
        const committedARow = readPublicTemplateDbRow(dataDirectory, fixtureA.id);
        expect(committedARow.id).toBe(fixtureA.id);
        expect(committedARow.title).toBe(title);
        expect(JSON.parse(committedARow.graph)).toMatchObject({
          nodes: expect.arrayContaining([
            expect.objectContaining({
              data: expect.objectContaining({
                textPrompt: expect.stringContaining("S14-LIST-COMMIT"),
              }),
            }),
          ]),
        });
        await listGate.release(0, staleList);
        await expect(cardFor(fixtureA.id).locator("strong")).toHaveText(title);

        const reads: Array<{ cache: string | null; url: string }> = [];
        const observe = (request: any) => {
          const url = new URL(request.url());
          if (
            /^\/api\/admin\/templates\/[a-f0-9-]{36}$/i.test(url.pathname) &&
            request.method() === "GET"
          ) {
            reads.push({
              cache: request.headers()["cache-control"] ?? null,
              url: request.url(),
            });
          }
        };
        page.on("request", observe);
        await cardFor(fixtureA.id).getByRole("button", { name: "编辑" }).click();
        await expect(isolationModal.getByLabel(/模板标题/)).toHaveValue(title);
        await expect(isolationModal.getByLabel(/模板图 JSON/)).toHaveValue(
          /S14-LIST-COMMIT/,
        );
        await expect.poll(() => reads.length).toBe(1);
        await isolationModal.getByRole("button", { name: "取消" }).click();
        await newTemplateButton.click();
        await isolationModal
          .getByTestId("admin-template-base-select")
          .getByRole("combobox")
          .click();
        await isolationModal.getByRole("option", { name: title, exact: true }).click();
        await expect(isolationModal.getByLabel(/模板图 JSON/)).toHaveValue(
          /S14-LIST-COMMIT/,
        );
        await expect.poll(() => reads.length).toBe(2);
        await isolationModal.getByRole("button", { name: "取消" }).click();
        page.off("request", observe);

        const saved = await readAdminUiTemplate(page, fixtureA.id);
        expect(beforeA.title).not.toBe(title);
        expect(saved.title).toBe(title);
        expect(JSON.stringify(saved.graph)).toContain("S14-LIST-COMMIT");
        expect(saved.id).toBe(beforeA.id);
        const freshList = JSON.stringify(await (
          await page.request.get(
            "/api/admin/templates?limit=100&offset=0&includeGraph=false",
          )
        ).json());
        await listGate.release(1, freshList);
        await listGate.dispose();
      },
    );

    await test.step(
      "TPL-S15 保存期间禁止同模板发布、下架、恢复和归档",
      async () => {
        const publishB = await page.request.patch(
          `/api/admin/templates/${fixtureB.id}`,
          { data: { status: "published" } },
        );
        expect(publishB.status()).toBe(200);
        const archiveC = await page.request.delete(
          `/api/admin/templates/${fixtureC.id}`,
        );
        expect(archiveC.status()).toBe(200);
        await page.reload();
        await ignoreAdminGraphAbort(page);

        await test.step(
          "TPL-S15-cross A 保存等待时 B 仍可下架并归档",
          async () => {
            const gate = await installTemplatePatchGate(page, fixtureA.id);
            await cardFor(fixtureA.id)
              .getByRole("button", { name: "编辑" })
              .click();
            await isolationModal.getByLabel(/模板标题/).fill("S15 A 等待中");
            await isolationModal.getByRole("button", { name: "保存" }).click();
            await expect.poll(() => gate.seen()).toBe(true);
            await isolationModal
              .getByRole("button", { name: "关闭公共模板弹窗" })
              .click();

            // B 的状态写入和归档必须穿过自己的 id 门禁，不能被 A 的保存全页锁住。
            await cardFor(fixtureB.id)
              .getByRole("button", { name: "下架" })
              .click();
            await expect(
              cardFor(fixtureB.id).locator("[data-status='draft']"),
            ).toBeVisible();
            await cardFor(fixtureB.id)
              .getByRole("button", { name: "归档" })
              .click();
            await expect(page.getByTestId("confirm-dialog")).toBeVisible();
            await page.getByTestId("confirm-dialog")
              .getByRole("button", { name: "归档" })
              .click();
            await expect(
              cardFor(fixtureB.id).locator("[data-status='archived']"),
            ).toBeVisible();

            await gate.release();
            await gate.dispose();
            await cardFor(fixtureB.id)
              .getByRole("button", { name: "恢复" })
              .click();
            await expect(
              cardFor(fixtureB.id).locator("[data-status='published']"),
            ).toBeVisible();
          },
        );

        await test.step(
          "TPL-S15-reverse A 发布先开始失败后解锁，B 仍可正常读取",
          async () => {
            const beforeA = await readAdminUiTemplate(page, fixtureA.id);
            expect(beforeA.status).toBe("draft");
            const beforeGraph = structuredClone(beforeA.graph);

            const retryGate = await installRetryableTemplatePatchGate(
              page,
              fixtureA.id,
            );
            let unexpectedDeleteCount = 0;
            const writes: string[] = [];
            const onWrite = (request: any) => {
              const url = new URL(request.url());
              if (
                url.pathname === `/api/admin/templates/${fixtureA.id}` &&
                (request.method() === "PATCH" || request.method() === "DELETE")
              ) {
                writes.push(request.method());
              }
            };
            const deleteGuard = async (route: any) => {
              if (route.request().method() === "DELETE") {
                unexpectedDeleteCount += 1;
                await route.fulfill({
                  body: JSON.stringify({ error: "unexpected same-row delete" }),
                  contentType: "application/json",
                  status: 409,
                });
                return;
              }
              await route.fallback();
            };
            page.on("request", onWrite);
            // 只保护本步骤的意外 DELETE；PATCH 继续交给 retryGate 暂停。
            await page.route(`**/api/admin/templates/${fixtureA.id}`, deleteGuard);
            try {
              const publish = cardFor(fixtureA.id).getByRole("button", {
                name: "发布",
                exact: true,
              });
              await expect(publish).toBeEnabled();
              await publish.click();
              await expect.poll(() => retryGate.pending.length).toBe(1);
              expect(writes).toEqual(["PATCH"]);

              // 发布 PATCH 已在途；同一行编辑和其余状态操作必须同步被挡住。
              const edit = cardFor(fixtureA.id).getByRole("button", {
                name: "编辑",
                exact: true,
              });
              await expect(edit).toBeDisabled();
              await edit.click({ force: true });
              await expect(page.getByTestId("admin-template-modal")).toHaveCount(0);

              const publishAgain = cardFor(fixtureA.id).getByRole("button", {
                name: "发布",
                exact: true,
              });
              await expect(publishAgain).toBeDisabled();
              const archive = cardFor(fixtureA.id).getByRole("button", {
                name: "归档",
                exact: true,
              });
              await expect(archive).toBeDisabled();
              await archive.click({ force: true });
              await expect(page.getByTestId("confirm-dialog")).toHaveCount(0);
              await expect.poll(() => retryGate.pending.length).toBe(1);
              expect(unexpectedDeleteCount).toBe(0);
              expect(writes).toEqual(["PATCH"]);

              // A 写入等待期间，B 仍可正常打开并完成自己的图读取。
              const graphGate = await installAdminGraphReadGate(
                page,
                await adminGraphListPayload(page),
              );
              try {
                const bEdit = cardFor(fixtureB.id).getByRole("button", {
                  name: "编辑",
                  exact: true,
                });
                await expect(bEdit).toBeEnabled();
                await bEdit.click();
                await expect(isolationModal).toBeVisible();
                await expect.poll(() => graphGate.pending.length).toBe(1);
                await graphGate.release(0);
                await expect(isolationModal.getByLabel(/模板标题/)).toHaveValue(
                  fixtureB.title,
                );
                await expect(isolationModal.getByLabel(/模板图 JSON/)).toHaveValue(
                  /TPL-B/,
                );
                await isolationModal.getByRole("button", { name: "取消" }).click();
              } finally {
                await graphGate.dispose();
              }

              // 原行 PATCH 明确失败：A 仍是 draft，行级门禁随后应恢复。
              await retryGate.release(0, {
                body: JSON.stringify({ error: "模拟 A 发布失败" }),
                status: 500,
              });
              await waitForUiRender(page);
              await expect(cardFor(fixtureA.id).locator("[data-status='draft']"))
                .toBeVisible();
              await expect(cardFor(fixtureA.id).getByRole("button", {
                name: "编辑",
                exact: true,
              })).toBeEnabled();
              await expect(cardFor(fixtureA.id).getByRole("button", {
                name: "发布",
                exact: true,
              })).toBeEnabled();

              await page.unroute(
                `**/api/admin/templates/${fixtureA.id}`,
                deleteGuard,
              );
              await retryGate.dispose();

              // 解锁后重新编辑并走真实 PATCH；图必须保持失败前的原图。
              await cardFor(fixtureA.id).getByRole("button", {
                name: "编辑",
                exact: true,
              }).click();
              await expect(isolationModal).toBeVisible();
              const graphInput = isolationModal.getByLabel(/模板图 JSON/);
              await expect(graphInput).toHaveValue(/^\s*\{/);
              expect(JSON.parse(await graphInput.inputValue())).toEqual(beforeGraph);
              const retryTitle = "S15 发布失败后真实重试";
              await isolationModal.getByLabel(/模板标题/).fill(retryTitle);
              await isolationModal
                .getByRole("button", { name: "保存", exact: true })
                .click();
              await expect(isolationModal).toHaveCount(0);

              const verifyStore = openAppDatabase(dataDirectory);
              try {
                const row = verifyStore.prepare(`
                  SELECT status, title, graph
                  FROM public_templates
                  WHERE id = ?
                `).get(fixtureA.id) as {
                  graph: string;
                  status: string;
                  title: string;
                };
                expect(row.status).toBe("draft");
                expect(row.title).toBe(retryTitle);
                expect(JSON.parse(row.graph)).toEqual(beforeGraph);
              } finally {
                verifyStore.close();
              }
              fixtureA.title = retryTitle;
            } finally {
              page.off("request", onWrite);
              await page.unroute(
                `**/api/admin/templates/${fixtureA.id}`,
                deleteGuard,
              ).catch(() => undefined);
              // 若前置断言失败仍有 gate，测试页 teardown 会负责清理；正常路径已在上面释放。
            }
          },
        );

        const collide = async (
          id: string,
          action: "发布" | "下架" | "恢复" | "归档",
          expectedStatus: string,
        ) => {
          const gate = await installTemplatePatchGate(page, id);
          await cardFor(id).getByRole("button", { name: "编辑" }).click();
          await isolationModal.getByLabel(/模板标题/).fill(`S15 ${action}门禁`);
          await isolationModal.getByRole("button", { name: "保存" }).click();
          await expect.poll(() => gate.seen()).toBe(true);
          await isolationModal
            .getByRole("button", { name: "关闭公共模板弹窗" })
            .click();
          const actionButton = cardFor(id).getByRole("button", { name: action });
          await expect(actionButton).toBeDisabled();
          let deleteCount = 0;
          const onDeleteRequest = (request: any) => {
            const url = new URL(request.url());
            if (
              request.method() === "DELETE" &&
              url.pathname === `/api/admin/templates/${id}`
            ) {
              deleteCount += 1;
            }
          };
          if (action === "归档") page.on("request", onDeleteRequest);
          await actionButton.click({ force: true });
          await expect.poll(() => gate.extraPatchCount()).toBe(0);
          if (action === "归档") {
            expect(deleteCount).toBe(0);
            page.off("request", onDeleteRequest);
          }
          await expect(page.getByTestId("confirm-dialog")).toHaveCount(0);
          await gate.release();
          await gate.dispose();
          expect((await readAdminUiTemplate(page, id)).status).toBe(expectedStatus);
        };

        await collide(fixtureA.id, "发布", "draft");
        await collide(fixtureB.id, "下架", "published");
        await collide(fixtureC.id, "恢复", "archived");
        // 归档没有单独的 PATCH，但同样必须在保存期间被行级门禁拦住。
        await collide(fixtureA.id, "归档", "draft");
      },
    );
    await test.step("UI04 100/101/201 templates, exact reads, revisions and cross-page sources", async () => {
      const store = openAppDatabase(dataDirectory);
      const ids: string[] = [];
      const prefix = "分页验收";
      const fixedTime = "2090-01-01T00:00:00.000Z";
      try {
        const owner = store.prepare("SELECT id FROM users WHERE login_name = 'owner'").get() as { id: string };
        for (let index = 0; index < 201; index += 1) {
          const row = savePublicTemplate(store, owner.id, {
            graph: markedUploadPlaceholderGraph(`PAGE-${index}`),
            title: `${prefix}${String(index).padStart(3, "0")}`,
          });
          ids.push(row.id);
          store.prepare("UPDATE public_templates SET updated_at = ? WHERE id = ?").run(fixedTime, row.id);
          if (index === 99 || index === 100 || index === 200) {
            const count = index + 1;
            const first = await page.request.get(`/api/admin/templates?q=${encodeURIComponent(prefix)}&limit=50&offset=0&includeGraph=false`);
            expect(first.status()).toBe(200);
            const firstBody = await first.json();
            expect(firstBody.pagination.total).toBe(count);
            expect(firstBody.pagination.revision).toMatch(/^[a-f0-9]{64}$/);
            expect(firstBody.items.every((item: any) => !Object.hasOwn(item, "graph"))).toBe(true);
            const seen = firstBody.items.map((item: any) => item.id);
            for (let offset = 50; offset < count; offset += 50) {
              const next = await page.request.get(`/api/admin/templates?q=${encodeURIComponent(prefix)}&limit=50&offset=${offset}&includeGraph=false&revision=${firstBody.pagination.revision}`);
              expect(next.status()).toBe(200);
              const nextBody = await next.json();
              expect(nextBody.pagination.revision).toBe(firstBody.pagination.revision);
              seen.push(...nextBody.items.map((item: any) => item.id));
            }
            expect(new Set(seen).size).toBe(count);
            expect([...seen].sort()).toEqual([...ids].sort());
          }
        }
        const first = await (await page.request.get(`/api/admin/templates?q=${encodeURIComponent(prefix)}&limit=50&offset=0`)).json();
        // This test process writes the SQLite file; the API server is a separate process.
        // Keep updated_at identical to prove MAX(updated_at) is insufficient.
        store.prepare("UPDATE public_templates SET title = ? WHERE id = ?").run(`${prefix}000已修改`, ids[0]);
        const stale = await page.request.get(`/api/admin/templates?q=${encodeURIComponent(prefix)}&limit=50&offset=50&revision=${first.pagination.revision}`);
        expect(stale.status()).toBe(409);
        expect(await stale.json()).toMatchObject({ code: "LIST_REVISION_STALE" });
        const exact = await page.request.get(`/api/admin/templates/${ids[0]}`);
        expect(exact.status()).toBe(200);
        expect(exact.headers()["cache-control"]).toBe("no-store");
        expect(JSON.stringify((await exact.json()).template.graph)).toContain("PAGE-0");
        expect((await page.request.get("/api/admin/templates/not-a-uuid")).status()).toBe(404);
        expect((await page.request.get(`/api/admin/templates/${randomUUID()}`)).status()).toBe(404);
        expect((await page.request.get("/api/admin/templates?revision=bad")).status()).toBe(400);

        await page.reload();
        const mainPager = page.getByRole("navigation", { name: "公共模板分页" });
        await page.getByLabel("搜索公共模板", { exact: true }).fill(prefix);
        await page.getByRole("button", { name: "搜索模板", exact: true }).click();
        await expect(mainPager).toContainText("共 201 个模板");
        for (let pageNumber = 2; pageNumber <= 5; pageNumber += 1) {
          await mainPager.getByRole("button", { name: "下一页" }).click();
          await expect(mainPager).toContainText(`第 ${pageNumber} 页`);
        }
        await expect(page.locator(".admin-template-card")).toHaveCount(1);
        await page.getByTestId(`admin-template-${ids[0]}`).getByRole("button", { name: "编辑" }).click();
        await expect(isolationModal.getByLabel(/模板图 JSON/)).toHaveValue(/PAGE-0/);
        await isolationModal.getByLabel(/模板标题/).fill(`${prefix}000保存`);
        await isolationModal.getByRole("button", { name: "保存", exact: true }).click();
        await expect(isolationModal).toHaveCount(0);
        await expect(mainPager).toContainText("第 1 页");
        expect(readPublicTemplateDbRow(dataDirectory, ids[0]).title).toBe(`${prefix}000保存`);
        expect(readPublicTemplateDbRow(dataDirectory, ids[0]).graph).toContain("PAGE-0");

        // The list revision changes in another process between page requests.
        store.prepare("UPDATE public_templates SET title = ? WHERE id = ?").run(`${prefix}001另一窗口`, ids[1]);
        await mainPager.getByRole("button", { name: "下一页" }).click();
        await expect(page.getByText("模板列表已变化，已返回第一页；编辑内容和已选来源保留。", { exact: true })).toBeVisible();
        await expect(mainPager).toContainText("第 1 页");

        await newTemplateButton.click();
        await isolationModal.getByLabel("搜索来源模板", { exact: true }).fill(prefix);
        await isolationModal.getByRole("button", { name: "搜索来源", exact: true }).click();
        const sourcePager = isolationModal.getByRole("navigation", { name: "来源模板分页" });
        await expect(sourcePager).toContainText("共 201 个模板");
        for (let pageNumber = 2; pageNumber <= 5; pageNumber += 1) {
          await sourcePager.getByRole("button", { name: "下一页" }).click();
          await expect(sourcePager).toContainText(`第 ${pageNumber} 页`);
        }
        const source = isolationModal.getByTestId("admin-template-base-select").getByRole("combobox");
        await source.click();
        await isolationModal.getByRole("option", { name: `${prefix}000保存`, exact: true }).click();
        await expect(isolationModal.getByLabel(/模板图 JSON/)).toHaveValue(/PAGE-0/);
        await sourcePager.getByRole("button", { name: "上一页" }).click();
        await expect(sourcePager).toContainText("第 4 页");
        await expect(source).toContainText(`${prefix}000保存`);
        await expect(isolationModal.getByLabel(/模板图 JSON/)).toHaveValue(/PAGE-0/);
        await isolationModal.getByLabel(/模板标题/).fill("跨页来源复制完成");
        await isolationModal.getByRole("button", { name: "保存", exact: true }).click();
        await expect(isolationModal).toHaveCount(0);
        const copied = store.prepare("SELECT graph FROM public_templates WHERE title = ?").get("跨页来源复制完成") as { graph: string };
        expect(copied.graph).toContain("PAGE-0");

        // The filtered final page disappears after its only item is archived.
        const statusFilter = page.getByRole("combobox", { name: "模板状态筛选", exact: true });
        const searchInput = page.getByLabel("搜索公共模板", { exact: true });
        await expect(statusFilter).toHaveCSS("height", "46px");
        await expect(statusFilter).toHaveCSS("min-height", "46px");
        await expect(statusFilter).toHaveCSS("border-radius", "12px");
        const filterBox = await statusFilter.boundingBox();
        const searchBox = await searchInput.boundingBox();
        if (!filterBox || !searchBox) throw new Error("template filter controls have no bounding box");
        expect(Math.abs(filterBox.height - searchBox.height)).toBeLessThanOrEqual(1);
        await statusFilter.focus();
        await page.keyboard.press("Enter");
        const allStatusOption = page.getByRole("option", { name: "全部状态", exact: true });
        await expect(allStatusOption).toHaveCSS("background-color", "rgb(62, 62, 66)");
        await page.keyboard.press("Escape");
        await expect(statusFilter).toBeFocused();
        await statusFilter.click();
        await page.getByRole("option", { name: "草稿", exact: true }).click();
        await expect(mainPager).toContainText("共 201 个模板");
        for (let pageNumber = 2; pageNumber <= 5; pageNumber += 1) {
          await mainPager.getByRole("button", { name: "下一页" }).click();
          await expect(mainPager).toContainText(`第 ${pageNumber} 页`);
        }
        await page.getByTestId(`admin-template-${ids[0]}`).getByRole("button", { name: "归档", exact: true }).click();
        await page.getByTestId("confirm-dialog").getByRole("button", { name: "归档", exact: true }).click();
        await expect(mainPager).toContainText("共 200 个模板");
        await expect(mainPager).toContainText("第 1 页");
        await expect(page.locator(".admin-template-card")).toHaveCount(50);

        // Archiving never prevents an authorized manager reading it for restore.
        const archived = await page.request.get(`/api/admin/templates/${ids[0]}`);
        expect(archived.status()).toBe(200);
        expect((await archived.json()).template.status).toBe("archived");
        await page.request.patch(`/api/admin/templates/${ids[0]}`, { data: { status: "draft" } });
        expect((await (await page.request.get(`/api/admin/templates/${ids[0]}`)).json()).template.status).toBe("draft");
      } finally { store.close(); }
    });
  } finally {
    if (server) await stopServer(server);
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("browse-all admin entry follows permissions and recent-used filters by account with silent skips", async ({
  page,
}) => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-public-recent-"));
  let server: ChildProcess | undefined;
  try {
    server = await startServer(dataDirectory);
    const bootstrap = await page.request.post("/api/auth/bootstrap", {
      data: {
        displayName: "Owner",
        loginName: "owner",
        password: "owner-password-123",
      },
    });
    expect(bootstrap.status()).toBe(201);
    await page.request.post("/api/admin/users", {
      data: {
        displayName: "Ordinary",
        loginName: "ordinary",
        password: "ordinary-pass-123",
      },
    });

    for (const title of ["最近使用A", "最近使用B"]) {
      const created = await page.request.post("/api/admin/templates", {
        data: {
          category: ["工具"],
          graph: uploadPlaceholderGraph(),
          status: "published",
          title,
        },
      });
      expect(created.status()).toBe(201);
    }

    // 管理员：浏览全部侧栏显示管理入口。
    await page.goto("/canvas");
    await page.getByTestId("templates").click();
    await page.getByRole("button", { name: "浏览全部" }).click();
    await expect(page.getByTestId("admin-templates-entry")).toBeVisible();
    await page.getByRole("button", { name: "关闭全部模板" }).click();

    // 普通账号：无管理入口。
    await page.request.post("/api/auth/logout");
    await page.request.post("/api/auth/login", {
      data: {
        loginName: "ordinary",
        password: "ordinary-pass-123",
      },
    });
    await page.goto("/canvas");
    await page.getByTestId("templates").click();
    await page.getByRole("button", { name: "浏览全部" }).click();
    await expect(page.getByTestId("admin-templates-entry")).toHaveCount(0);

    // 先导入 A，再导入 B；「最近使用」应倒序显示 B、A。
    const browser = page.getByTestId("template-browser");
    await browser
      .locator(".template-browser-card")
      .filter({ hasText: "最近使用A" })
      .click();
    await expect(browser).toHaveCount(0);
    await page.getByTestId("templates").click();
    await page.getByRole("button", { name: "浏览全部" }).click();
    await browser
      .locator(".template-browser-card")
      .filter({ hasText: "最近使用B" })
      .click();
    await expect(browser).toHaveCount(0);

    await page.getByTestId("templates").click();
    await page.getByRole("button", { name: "浏览全部" }).click();
    await browser
      .getByRole("button", { name: "最近使用", exact: true })
      .click();
    // 等待过滤请求生效：种子模板不再出现在「最近使用」里。
    await expect(
      browser
        .locator(".template-browser-card")
        .filter({ hasText: "电商详情页工作流" }),
    ).toHaveCount(0);
    const recentTitles = await browser
      .locator(".template-browser-card p")
      .allTextContents();
    expect(recentTitles.map((title) => title.trim())).toEqual([
      "最近使用B",
      "最近使用A",
    ]);

    // 管理员归档 A 后，普通账号「最近使用」静默跳过失效模板。
    await page.request.post("/api/auth/logout");
    await page.request.post("/api/auth/login", {
      data: {
        loginName: "owner",
        password: "owner-password-123",
      },
    });
    const adminList = await (
      await page.request.get("/api/admin/templates?q=最近使用A")
    ).json() as { items: Array<{ id: string }> };
    const archive = await page.request.delete(
      `/api/admin/templates/${adminList.items[0].id}`,
    );
    expect(archive.status()).toBe(200);
    await page.request.post("/api/auth/logout");
    await page.request.post("/api/auth/login", {
      data: {
        loginName: "ordinary",
        password: "ordinary-pass-123",
      },
    });
    await page.reload();
    await page.getByTestId("templates").click();
    await page.getByRole("button", { name: "浏览全部" }).click();
    await browser
      .getByRole("button", { name: "最近使用", exact: true })
      .click();
    await expect(
      browser
        .locator(".template-browser-card")
        .filter({ hasText: "电商详情页工作流" }),
    ).toHaveCount(0);
    await expect(
      browser.locator(".template-browser-card").filter({ hasText: "最近使用A" }),
    ).toHaveCount(0);
    await expect(
      browser.locator(".template-browser-card").filter({ hasText: "最近使用B" }),
    ).toBeVisible();
  } finally {
    if (server) await stopServer(server);
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("ordinary canvas group save stays private and hides the public destination", async ({
  page,
}) => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-public-canvas-"));
  let server: ChildProcess | undefined;
  try {
    server = await startServer(dataDirectory);
    const bootstrap = await page.request.post("/api/auth/bootstrap", {
      data: {
        displayName: "Owner",
        loginName: "owner",
        password: "owner-password-123",
      },
    });
    expect(bootstrap.status()).toBe(201);
    const createdUser = await page.request.post("/api/admin/users", {
      data: {
        displayName: "Ordinary",
        loginName: "ordinary",
        password: "ordinary-pass-123",
      },
    });
    expect(createdUser.status()).toBe(201);
    await page.request.post("/api/auth/logout");
    const login = await page.request.post("/api/auth/login", {
      data: {
        loginName: "ordinary",
        password: "ordinary-pass-123",
      },
    });
    expect(login.status()).toBe(200);

    const project = (
      (await (await page.request.post("/api/projects", { data: {} })).json()) as {
        id: string;
      }
    );
    const baseline = (await (
      await page.request.get(`/api/canvas/${project.id}`)
    ).json()) as { loadToken: string; revision: number };
    const saved = await page.request.put(`/api/canvas/${project.id}`, {
      data: {
        edges: [],
        nodes: [
          {
            data: { label: "Group", title: "普通用户组" },
            id: "group-user",
            position: { x: 80, y: 80 },
            style: { height: 348, width: 548 },
            type: "group",
            zIndex: 0,
          },
          {
            data: { label: "Text", title: "说明" },
            id: "child-text",
            parentId: "group-user",
            position: { x: 20, y: 20 },
            style: { height: 250, width: 250 },
            type: "text",
            zIndex: 1,
          },
        ],
        observedLoadToken: baseline.loadToken,
        observedRevision: baseline.revision,
        revision: baseline.revision,
        saveAttemptId: randomUUID(),
        saveSequence: 1,
        saveSessionId: randomUUID(),
        viewport: { x: 0, y: 0, zoom: 1 },
      },
    });
    expect(saved.ok()).toBeTruthy();

    await page.goto(`/canvas/${project.id}`);
    await expect(page.getByTestId("canvas-world")).toHaveAttribute(
      "data-persistence-ready",
      "true",
    );
    await page
      .locator('[data-testid="rf__node-group-user"]')
      .click({ position: { x: 5, y: 5 } });
    await page.getByTestId("group-template-button").click();
    await expect(page.getByTestId("group-template-destination")).toHaveCount(0);
    await page.getByLabel("模板标题").fill("普通用户只能存自己的");
    await page.getByTestId("group-template-submit").click();
    await expect(page.getByTestId("workflow-run-toast")).toContainText(
      "模板已保存到我的模板",
    );

    const mine = await page.request.get(
      "/api/templates?space=mine&q=普通用户只能存自己的&limit=20",
    );
    expect(mine.ok()).toBeTruthy();
    expect(
      ((await mine.json()) as { items: Array<{ title: string }> }).items.some(
        (item) => item.title === "普通用户只能存自己的",
      ),
    ).toBe(true);

    const forbidden = await page.request.post("/api/admin/templates", {
      data: {
        graph: uploadPlaceholderGraph(),
        status: "published",
        title: "越权公共",
      },
    });
    expect(forbidden.status()).toBe(403);
  } finally {
    if (server) await stopServer(server);
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

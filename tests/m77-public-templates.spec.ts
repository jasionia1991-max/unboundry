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
    await modal.getByLabel(/说明/).fill("通过管理页创建");
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

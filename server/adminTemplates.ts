import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { DatabaseSync } from "node:sqlite";
import {
  AccountMutationBlockedError,
  assertAccountMutationAllowed,
} from "./accountMutationFence";
import { recordAudit } from "./audit";
import { requestIdentity } from "./auth";
import { appDataDirectory, openAppDatabase } from "./database";
import {
  decodedRequestPath,
  HttpRequestError,
  readJsonBody,
} from "./httpRequest";
import { hasPermission } from "./permissions";
import {
  accountDeletionBlocksTemplateMutation,
  listPublicTemplates,
  parseTemplateGraph,
  parsePublicCategory,
  publicTemplateCard,
  validTemplateGraph,
  type PublicTemplateCard,
  type PublicTemplateRow,
  type PublicTemplateStatus,
} from "./templateCatalog";
import {
  assertPublicTemplatePublishable,
  auditPublicTemplateCompatibility,
  PublicTemplateCompatibilityError,
} from "./templateCompatibility";
import {
  isRealCategory,
  REAL_CATEGORIES,
} from "../types/templateCategories";

const publicStatusSet = new Set<PublicTemplateStatus>([
  "draft",
  "published",
  "archived",
]);

let database: DatabaseSync | undefined;
let databaseDirectory = "";

function db() {
  const directory = appDataDirectory();
  if (database && databaseDirectory === directory) return database;
  database?.close();
  database = openAppDatabase();
  databaseDirectory = directory;
  return database;
}

function json(response: ServerResponse, status: number, body: unknown) {
  response.statusCode = status;
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

function respondAccountDeleteConflict(
  response: ServerResponse,
  error: unknown,
) {
  if (
    !(error instanceof AccountMutationBlockedError) &&
    !accountDeletionBlocksTemplateMutation(error)
  ) {
    return false;
  }
  const code = error instanceof AccountMutationBlockedError
    ? error.code
    : "ACCOUNT_DELETE_ACTIVE";
  json(response, 409, {
    code,
    error: code === "ACCOUNT_DELETE_ACTIVE"
      ? "账号删除正在进行，不能再修改公共模板"
      : "账号不可用，不能再修改公共模板",
  });
  return true;
}

function accountMutation<T>(
  store: DatabaseSync,
  actorId: string,
  mutation: () => T,
) {
  store.exec("BEGIN IMMEDIATE");
  try {
    assertAccountMutationAllowed(store, actorId);
    const result = mutation();
    store.exec("COMMIT");
    return result;
  } catch (error) {
    if (store.isTransaction) store.exec("ROLLBACK");
    throw error;
  }
}

function boundedInteger(value: string | null, fallback: number, maximum: number) {
  if (value === null || value === "") return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= maximum
    ? parsed
    : undefined;
}

function publicTemplateRow(store: DatabaseSync, id: string) {
  return store
    .prepare(`
      SELECT
        id, title, description, category, graph, cover_asset_id,
        preview_image, status, created_by, created_at,
        updated_by, updated_at, archived_at
      FROM public_templates
      WHERE id = ?
    `)
    .get(id) as PublicTemplateRow | undefined;
}

function validatedCategory(input: unknown): string[] | null {
  if (input === undefined || input === null) return null;
  if (!Array.isArray(input)) throw new Error("模板分类无效");
  const unique = [...new Set(input)];
  if (
    unique.length > REAL_CATEGORIES.length ||
    unique.some((item) => typeof item !== "string" || !isRealCategory(item))
  ) {
    throw new Error("模板分类无效");
  }
  return unique;
}

function validatedTitle(input: unknown): string {
  const title = typeof input === "string" ? input.trim() : "";
  if (title.length < 1 || title.length > 40) {
    throw new Error("模板标题需为 1–40 个字符");
  }
  return title;
}

function validatedStatus(input: unknown): PublicTemplateStatus | undefined {
  if (input === undefined) return undefined;
  if (
    typeof input !== "string" ||
    !publicStatusSet.has(input as PublicTemplateStatus)
  ) {
    throw new Error("模板状态无效");
  }
  return input as PublicTemplateStatus;
}

function validatedDescription(input: unknown): string | null {
  if (input === undefined || input === null) return null;
  if (typeof input !== "string" || input.length > 200) {
    throw new Error("模板说明需为 200 字符以内");
  }
  return input.trim();
}

function validatedPreviewImage(input: unknown): string | null {
  if (input === undefined || input === null) return null;
  if (typeof input !== "string" || input.length > 500) {
    throw new Error("模板封面路径无效");
  }
  const value = input.trim();
  return value || null;
}

function adminTemplateItem(
  store: DatabaseSync,
  row: PublicTemplateRow,
  includeGraph: boolean,
) {
  const graph = parseTemplateGraph(row.graph);
  return {
    ...publicTemplateCard(store, row, includeGraph),
    archivedAt: row.archived_at ?? undefined,
    compatibility: graph
      ? auditPublicTemplateCompatibility(store, graph)
      : {
          issues: [{ message: "模板图 JSON 无法安全解析" }],
          status: "INVALID",
        },
    status: row.status,
  };
}

function templateErrorBody(error: unknown, fallback: string) {
  return error instanceof PublicTemplateCompatibilityError
    ? {
        code: error.code,
        error: error.message,
        issues: error.audit.issues,
      }
    : { error: error instanceof Error ? error.message : fallback };
}

export function savePublicTemplate(
  store: DatabaseSync,
  actorId: string,
  input: Record<string, unknown>,
): PublicTemplateRow {
  const title = validatedTitle(input.title);
  const category = validatedCategory(input.category);
  const description = validatedDescription(input.description);
  const previewImage = validatedPreviewImage(input.previewImage);
  const status = validatedStatus(input.status) ?? "draft";
  const templateGraph = input.graph;
  if (!validTemplateGraph(templateGraph)) {
    throw new Error("模板图结构无效");
  }
  const graph = JSON.stringify(templateGraph);
  const id = randomUUID();
  const timestamp = new Date().toISOString();
  return accountMutation(store, actorId, () => {
    if (status === "published") {
      assertPublicTemplatePublishable(store, templateGraph);
    }
    store.prepare(`
        INSERT INTO public_templates (
          id, title, description, category, graph, cover_asset_id,
          preview_image, status, created_by, created_at,
          updated_by, updated_at, archived_at
        )
        VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, NULL)
      `).run(
      id,
      title,
      description,
      category ? JSON.stringify(category) : null,
      graph,
      previewImage,
      status,
      actorId,
      timestamp,
      actorId,
      timestamp,
    );
    recordAudit(store, actorId, "public_template.create", null, {
      id,
      status,
      title,
    });
    return publicTemplateRow(store, id)!;
  });
}

export function updatePublicTemplate(
  store: DatabaseSync,
  actorId: string,
  id: string,
  input: Record<string, unknown>,
): PublicTemplateRow {
  const title = input.title === undefined
    ? undefined
    : validatedTitle(input.title);
  const category = input.category === undefined
    ? undefined
    : validatedCategory(input.category);
  const description = input.description === undefined
    ? undefined
    : validatedDescription(input.description);
  const previewImage = input.previewImage === undefined
    ? undefined
    : validatedPreviewImage(input.previewImage);
  const status = input.status === undefined
    ? undefined
    : validatedStatus(input.status)!;
  if (input.graph !== undefined && !validTemplateGraph(input.graph)) {
    throw new Error("模板图结构无效");
  }
  const graph = input.graph === undefined
    ? undefined
    : JSON.stringify(input.graph);
  const timestamp = new Date().toISOString();
  return accountMutation(store, actorId, () => {
    const existing = publicTemplateRow(store, id);
    if (!existing) throw new Error("公共模板不存在");
    const nextTitle = title ?? existing.title;
    const nextCategory = category === undefined
      ? parsePublicCategory(existing.category)
      : category;
    const nextDescription = description === undefined
      ? existing.description
      : description;
    const nextPreviewImage = previewImage === undefined
      ? existing.preview_image
      : previewImage;
    const nextStatus = status ?? existing.status;
    const nextGraph = graph ?? existing.graph;
    if (nextStatus === "published") {
      const parsedGraph = parseTemplateGraph(nextGraph);
      if (!parsedGraph) throw new Error("模板图结构无效");
      assertPublicTemplatePublishable(store, parsedGraph);
    }
    store.prepare(`
        UPDATE public_templates
        SET
          title = ?,
          description = ?,
          category = ?,
          graph = ?,
          preview_image = ?,
          status = ?,
          updated_by = ?,
          updated_at = ?,
          archived_at = CASE WHEN ? = 'archived' THEN COALESCE(archived_at, ?) ELSE NULL END
        WHERE id = ?
      `).run(
      nextTitle,
      nextDescription,
      nextCategory ? JSON.stringify(nextCategory) : null,
      nextGraph,
      nextPreviewImage,
      nextStatus,
      actorId,
      timestamp,
      nextStatus,
      timestamp,
      id,
    );
    recordAudit(store, actorId, "public_template.update", null, {
      id,
      status: nextStatus,
      title: nextTitle,
    });
    return publicTemplateRow(store, id)!;
  });
}

export function archivePublicTemplate(
  store: DatabaseSync,
  actorId: string,
  id: string,
) {
  const timestamp = new Date().toISOString();
  return accountMutation(store, actorId, () => {
    const existing = publicTemplateRow(store, id);
    if (!existing) throw new Error("公共模板不存在");
    store.prepare(`
        UPDATE public_templates
        SET status = 'archived', updated_by = ?, updated_at = ?, archived_at = ?
        WHERE id = ?
      `).run(actorId, timestamp, timestamp, id);
    recordAudit(store, actorId, "public_template.archive", null, {
      id,
      title: existing.title,
    });
    return publicTemplateRow(store, id)!;
  });
}

export function restorePublicTemplate(
  store: DatabaseSync,
  actorId: string,
  id: string,
) {
  const timestamp = new Date().toISOString();
  return accountMutation(store, actorId, () => {
    const existing = publicTemplateRow(store, id);
    if (!existing) throw new Error("公共模板不存在");
    const graph = parseTemplateGraph(existing.graph);
    if (!graph) throw new Error("模板图结构无效");
    assertPublicTemplatePublishable(store, graph);
    store.prepare(`
        UPDATE public_templates
        SET status = 'published', updated_by = ?, updated_at = ?, archived_at = NULL
        WHERE id = ?
      `).run(actorId, timestamp, id);
    recordAudit(store, actorId, "public_template.restore", null, {
      id,
      title: existing.title,
    });
    return publicTemplateRow(store, id)!;
  });
}

/** 物理删除仅对非种子模板开放；种子（created_by 为 NULL）不可物理删除。 */
export function deletePublicTemplate(
  store: DatabaseSync,
  actorId: string,
  id: string,
) {
  return accountMutation(store, actorId, () => {
    const existing = publicTemplateRow(store, id);
    if (!existing) throw new Error("公共模板不存在");
    if (existing.created_by === null) {
      throw new Error("种子模板不可物理删除");
    }
    store.prepare("DELETE FROM public_templates WHERE id = ?").run(id);
    recordAudit(store, actorId, "public_template.delete", null, {
      id,
      title: existing.title,
    });
    return true;
  });
}

export async function adminTemplatesApi(
  request: IncomingMessage,
  response: ServerResponse,
) {
  const identity = requestIdentity(request);
  if (!identity || !hasPermission(identity, "manage_public_templates")) {
    json(response, 403, { error: "需要公共模板管理权限" });
    return;
  }
  const store = db();
  const path = decodedRequestPath(request).replace(
    /^\/+/,
    "",
  );

  if (request.method === "GET" && !path) {
    const url = new URL(request.url ?? "", "http://127.0.0.1");
    const limit = boundedInteger(url.searchParams.get("limit"), 20, 100);
    const offset = boundedInteger(url.searchParams.get("offset"), 0, 100_000);
    if (limit === undefined || offset === undefined || limit === 0) {
      json(response, 400, { error: "模板分页参数无效" });
      return;
    }
    const statusParam = (url.searchParams.get("status") ?? "").trim() as
      | PublicTemplateStatus
      | "";
    if (statusParam && !publicStatusSet.has(statusParam)) {
      json(response, 400, { error: "模板状态无效" });
      return;
    }
    const query = (url.searchParams.get("q") ?? "").trim().toLocaleLowerCase();
    const category = (url.searchParams.get("category") ?? "全部").trim();
    const includeGraph = url.searchParams.get("includeGraph") === "true";
    const expectedRevision = url.searchParams.get("revision");
    if (expectedRevision !== null && !/^[a-f0-9]{64}$/.test(expectedRevision)) {
      json(response, 400, { error: "模板列表版本无效" });
      return;
    }
    // The revision, count and page must describe one database read snapshot.
    store.exec("BEGIN");
    try {
      const { rows, total, revision } = listPublicTemplates(store, {
        category, includeGraph, includeRevision: true, limit, offset,
        query, status: statusParam,
      });
      if (expectedRevision !== null && expectedRevision !== revision) {
        json(response, 409, {
          code: "LIST_REVISION_STALE",
          error: "模板列表已变化，请刷新后继续浏览",
        });
      } else {
        json(response, 200, {
          items: rows.map((row) => adminTemplateItem(store, row, includeGraph)),
          pagination: {
            hasMore: offset + rows.length < total,
            limit, offset, revision, total,
          },
        });
      }
    } finally {
      store.exec("COMMIT");
    }
    return;
  }

  if (request.method === "POST" && !path) {
    try {
      const input = await readJsonBody<Record<string, unknown>>(
        request,
        512 * 1_024,
      );
      const row = savePublicTemplate(store, identity.userId, input);
      json(response, 201, {
        template: adminTemplateItem(store, row, true),
      });
    } catch (error) {
      if (error instanceof HttpRequestError) throw error;
      if (respondAccountDeleteConflict(response, error)) return;
      json(response, 400, templateErrorBody(error, "公共模板保存失败"));
    }
    return;
  }

  if (!/^[a-f0-9-]{36}$/i.test(path)) {
    response.setHeader("Allow", "GET, POST, PATCH, DELETE");
    json(response, 404, { error: "公共模板接口不存在" });
    return;
  }
  const templateId = path.toLocaleLowerCase();

  if (request.method === "GET") {
    if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(templateId)) {
      json(response, 404, { error: "公共模板不存在" });
      return;
    }
    const row = store.prepare("SELECT * FROM public_templates WHERE id = ?")
      .get(templateId) as PublicTemplateRow | undefined;
    if (!row) {
      json(response, 404, { error: "公共模板不存在" });
      return;
    }
    json(response, 200, { template: adminTemplateItem(store, row, true) });
    return;
  }

  if (request.method === "PATCH") {
    try {
      const input = await readJsonBody<Record<string, unknown>>(
        request,
        512 * 1_024,
      );
      const row = updatePublicTemplate(store, identity.userId, templateId, input);
      json(response, 200, {
        template: adminTemplateItem(store, row, true),
      });
    } catch (error) {
      if (error instanceof HttpRequestError) throw error;
      if (respondAccountDeleteConflict(response, error)) return;
      const message = error instanceof Error ? error.message : "公共模板更新失败";
      json(
        response,
        message === "公共模板不存在" ? 404 : 400,
        templateErrorBody(error, "公共模板更新失败"),
      );
    }
    return;
  }

  if (request.method === "DELETE") {
    try {
      // 决策 3/14：删除 = 软归档 + 可恢复；种子模板同样只归档不物理删除。
      const row = archivePublicTemplate(store, identity.userId, templateId);
      json(response, 200, {
        archived: true,
        id: templateId,
        status: row.status,
      });
    } catch (error) {
      if (respondAccountDeleteConflict(response, error)) return;
      const message = error instanceof Error ? error.message : "公共模板归档失败";
      json(response, message === "公共模板不存在" ? 404 : 400, {
        error: message,
      });
    }
    return;
  }

  response.setHeader("Allow", "GET, POST, PATCH, DELETE");
  json(response, 404, { error: "公共模板接口不存在" });
}

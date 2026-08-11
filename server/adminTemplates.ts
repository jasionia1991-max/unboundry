import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { DatabaseSync } from "node:sqlite";
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
  parsePublicCategory,
  publicTemplateCard,
  validTemplateGraph,
  type PublicTemplateCard,
  type PublicTemplateRow,
  type PublicTemplateStatus,
} from "./templateCatalog";
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
  if (!accountDeletionBlocksTemplateMutation(error)) return false;
  json(response, 409, {
    code: "ACCOUNT_DELETE_ACTIVE",
    error: "账号删除正在进行，不能再修改公共模板",
  });
  return true;
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
  return {
    ...publicTemplateCard(store, row, includeGraph),
    archivedAt: row.archived_at ?? undefined,
    status: row.status,
  };
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
  if (!validTemplateGraph(input.graph)) {
    throw new Error("模板图结构无效");
  }
  const id = randomUUID();
  const timestamp = new Date().toISOString();
  store
    .prepare(`
      INSERT INTO public_templates (
        id, title, description, category, graph, cover_asset_id,
        preview_image, status, created_by, created_at,
        updated_by, updated_at, archived_at
      )
      VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, NULL)
    `)
    .run(
      id,
      title,
      description,
      category ? JSON.stringify(category) : null,
      JSON.stringify(input.graph),
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
}

export function updatePublicTemplate(
  store: DatabaseSync,
  actorId: string,
  id: string,
  input: Record<string, unknown>,
): PublicTemplateRow {
  const existing = publicTemplateRow(store, id);
  if (!existing) throw new Error("公共模板不存在");
  const title =
    input.title !== undefined ? validatedTitle(input.title) : existing.title;
  const category =
    input.category !== undefined
      ? validatedCategory(input.category)
      : parsePublicCategory(existing.category);
  const description =
    input.description !== undefined
      ? validatedDescription(input.description)
      : existing.description;
  const previewImage =
    input.previewImage !== undefined
      ? validatedPreviewImage(input.previewImage)
      : existing.preview_image;
  const status =
    input.status !== undefined
      ? validatedStatus(input.status)!
      : existing.status;
  if (input.graph !== undefined && !validTemplateGraph(input.graph)) {
    throw new Error("模板图结构无效");
  }
  const timestamp = new Date().toISOString();
  store
    .prepare(`
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
    `)
    .run(
      title,
      description,
      category ? JSON.stringify(category) : null,
      input.graph !== undefined ? JSON.stringify(input.graph) : existing.graph,
      previewImage,
      status,
      actorId,
      timestamp,
      status,
      timestamp,
      id,
    );
  recordAudit(store, actorId, "public_template.update", null, {
    id,
    status,
    title,
  });
  return publicTemplateRow(store, id)!;
}

export function archivePublicTemplate(
  store: DatabaseSync,
  actorId: string,
  id: string,
) {
  const existing = publicTemplateRow(store, id);
  if (!existing) throw new Error("公共模板不存在");
  const timestamp = new Date().toISOString();
  store
    .prepare(`
      UPDATE public_templates
      SET status = 'archived', updated_by = ?, updated_at = ?, archived_at = ?
      WHERE id = ?
    `)
    .run(actorId, timestamp, timestamp, id);
  recordAudit(store, actorId, "public_template.archive", null, {
    id,
    title: existing.title,
  });
  return publicTemplateRow(store, id)!;
}

export function restorePublicTemplate(
  store: DatabaseSync,
  actorId: string,
  id: string,
) {
  const existing = publicTemplateRow(store, id);
  if (!existing) throw new Error("公共模板不存在");
  const timestamp = new Date().toISOString();
  store
    .prepare(`
      UPDATE public_templates
      SET status = 'published', updated_by = ?, updated_at = ?, archived_at = NULL
      WHERE id = ?
    `)
    .run(actorId, timestamp, id);
  recordAudit(store, actorId, "public_template.restore", null, {
    id,
    title: existing.title,
  });
  return publicTemplateRow(store, id)!;
}

/** 物理删除仅对非种子模板开放；种子（created_by 为 NULL）不可物理删除。 */
export function deletePublicTemplate(
  store: DatabaseSync,
  actorId: string,
  id: string,
) {
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
    const { rows, total } = listPublicTemplates(store, {
      category,
      includeGraph,
      limit,
      offset,
      query,
      status: statusParam,
    });
    json(response, 200, {
      items: rows.map((row) => adminTemplateItem(store, row, includeGraph)),
      pagination: {
        hasMore: offset + rows.length < total,
        limit,
        offset,
        total,
      },
    });
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
      json(response, 400, {
        error: error instanceof Error ? error.message : "公共模板保存失败",
      });
    }
    return;
  }

  if (!/^[a-f0-9-]{36}$/i.test(path)) {
    response.setHeader("Allow", "GET, POST, PATCH, DELETE");
    json(response, 404, { error: "公共模板接口不存在" });
    return;
  }
  const templateId = path.toLocaleLowerCase();

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
      json(response, message === "公共模板不存在" ? 404 : 400, {
        error: message,
      });
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

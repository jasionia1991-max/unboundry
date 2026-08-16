import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { DatabaseSync } from "node:sqlite";
import { requestIdentity } from "./auth";
import { appDataDirectory, openAppDatabase } from "./database";
import {
  decodedRequestPath,
  HttpRequestError,
  readJsonBody,
} from "./httpRequest";
import { cancelCanvasGenerationTasks } from "./generationTasks";

const projectIdPattern = /^[a-z0-9._-]+$/i;
const defaultProjectTitle = "未命名项目";
const defaultViewport = JSON.stringify({ x: 0, y: 0, zoom: 1 });

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

type ProjectRow = {
  created_at: number | null;
  id: string;
  title: string;
  updated_at: number;
};

type ProjectCover = {
  assetId: string | null;
  kind: "image" | "video" | null;
};

export function projectCover(
  store: DatabaseSync,
  row: ProjectRow,
  ownerId: string,
) {
  const generated = store.prepare(`
    SELECT tasks.result_asset_id, tasks.kind
    FROM generation_tasks AS tasks
    JOIN media_assets AS media
      ON media.id = tasks.result_asset_id
      AND media.kind = tasks.kind
      AND media.owner_id = tasks.owner_id
      AND media.storage_status = 'ready'
    WHERE
      tasks.canvas_id = ?
      AND tasks.owner_id = ?
      AND tasks.state = 'success'
      AND tasks.kind IN ('image', 'video')
      AND tasks.result_asset_id IS NOT NULL
    ORDER BY tasks.updated_at DESC, tasks.rowid DESC
    LIMIT 1
  `).get(row.id, ownerId) as
    | { kind: "image" | "video"; result_asset_id: string }
    | undefined;
  if (generated?.result_asset_id) {
    return {
      assetId: generated.result_asset_id,
      kind: generated.kind,
    } satisfies ProjectCover;
  }

  const canvas = (
    ownerId === "__test__"
      ? store.prepare(`
          SELECT nodes
          FROM canvas_documents
          WHERE id = ?
          ORDER BY owner_id IS NULL DESC
          LIMIT 1
        `).get(row.id)
      : store.prepare(`
          SELECT nodes
          FROM canvas_documents
          WHERE owner_id = ? AND id = ?
        `).get(ownerId, row.id)
  ) as { nodes: string } | undefined;
  if (canvas) {
    try {
      const nodes = JSON.parse(canvas.nodes) as Array<{
        data?: { assetId?: unknown };
        type?: string;
      }>;
      for (const node of nodes) {
        const kind = node.type === "image"
          ? "image"
          : node.type === "video"
            ? "video"
            : undefined;
        const assetId = node.data?.assetId;
        if (kind && typeof assetId === "string" && assetId) {
          const media = store.prepare(`
            SELECT 1
            FROM media_assets
            WHERE
              owner_id = ?
              AND kind = ?
              AND id = ?
              AND storage_status = 'ready'
          `).get(ownerId, kind, assetId);
          if (media) return { assetId, kind } satisfies ProjectCover;
        }
      }
    } catch {
      // Malformed canvas JSON falls through to the gradient placeholder.
    }
  }
  return { assetId: null, kind: null } satisfies ProjectCover;
}

function projectRowFor(
  store: DatabaseSync,
  ownerId: string,
  id: string,
): ProjectRow | undefined {
  return (
    ownerId === "__test__"
      ? store.prepare(`
          SELECT id, title, created_at, updated_at
          FROM project_metadata
          WHERE id = ? AND is_project = 1 AND deleted_at IS NULL
          ORDER BY owner_id IS NULL DESC
          LIMIT 1
        `).get(id)
      : store.prepare(`
          SELECT id, title, created_at, updated_at
          FROM project_metadata
          WHERE owner_id = ? AND id = ? AND is_project = 1 AND deleted_at IS NULL
        `).get(ownerId, id)
) as ProjectRow | undefined;
}

export function deleteProjectRows(
  store: DatabaseSync,
  ownerId: string,
  id: string,
  now: number,
  bypass: boolean,
) {
  if (bypass) {
    store.prepare(`
      UPDATE project_metadata
      SET is_project = 0, deleted_at = ?
      WHERE id = ? AND is_project = 1 AND deleted_at IS NULL
    `).run(now, id);
    store.prepare("DELETE FROM canvas_documents WHERE id = ?").run(id);
  } else {
    store.prepare(`
      UPDATE project_metadata
      SET is_project = 0, deleted_at = ?
      WHERE owner_id = ? AND id = ? AND is_project = 1 AND deleted_at IS NULL
    `).run(now, ownerId, id);
    store.prepare(
      "DELETE FROM canvas_documents WHERE owner_id = ? AND id = ?",
    ).run(ownerId, id);
  }
  if (bypass) {
    store.prepare(`
      DELETE FROM generation_provider_attempts
      WHERE task_id IN (SELECT id FROM generation_tasks WHERE canvas_id = ?)
    `).run(id);
    store.prepare(`
      DELETE FROM generation_task_events
      WHERE task_id IN (SELECT id FROM generation_tasks WHERE canvas_id = ?)
    `).run(id);
    store.prepare("DELETE FROM generation_tasks WHERE canvas_id = ?").run(id);
  } else {
    store.prepare(`
      DELETE FROM generation_provider_attempts
      WHERE task_id IN (
        SELECT id FROM generation_tasks WHERE owner_id = ? AND canvas_id = ?
      )
    `).run(ownerId, id);
    store.prepare(`
      DELETE FROM generation_task_events
      WHERE task_id IN (
        SELECT id FROM generation_tasks WHERE owner_id = ? AND canvas_id = ?
      )
    `).run(ownerId, id);
    store.prepare(`
      DELETE FROM generation_tasks WHERE owner_id = ? AND canvas_id = ?
    `).run(ownerId, id);
  }
}

export function hasActiveProjectMediaPublications(
  store: DatabaseSync,
  ownerId: string,
  canvasId: string,
  bypass: boolean,
) {
  return Boolean(
    bypass
      ? store.prepare(`
          SELECT 1
          FROM media_publication_attempts AS publication
          JOIN generation_tasks AS task ON task.id = publication.task_id
          WHERE task.canvas_id = ?
            AND publication.state IN (
              'reserved', 'staged', 'external-ready', 'compensating'
            )
          LIMIT 1
        `).get(canvasId)
      : store.prepare(`
          SELECT 1
          FROM media_publication_attempts AS publication
          JOIN generation_tasks AS task ON task.id = publication.task_id
          WHERE task.owner_id = ? AND task.canvas_id = ?
            AND publication.owner_id = ?
            AND publication.state IN (
              'reserved', 'staged', 'external-ready', 'compensating'
            )
          LIMIT 1
        `).get(ownerId, canvasId, ownerId),
  );
}

function activePublicationDeleteError(error: unknown) {
  return error instanceof Error &&
    error.message.includes("active media publication blocks task deletion");
}

export async function projectsApi(
  request: IncomingMessage,
  response: ServerResponse,
) {
  const id = decodedRequestPath(request).replace(
    /^\/+/,
    "",
  );
  const cloneSuffix = id.match(/^([a-z0-9._-]+)\/clone$/i);
  if (
    id &&
    !projectIdPattern.test(id) &&
    !(request.method === "POST" && cloneSuffix)
  ) {
    json(response, 400, { error: "Invalid project ID" });
    return;
  }
  const identity = requestIdentity(request);
  if (!identity) {
    json(response, 401, { error: "Please sign in" });
    return;
  }
  const store = db();
  const ownerId = identity.bypass ? "__test__" : identity.userId;

  if (request.method === "GET" && !id) {
    const rows = (
      identity.bypass
        ? store.prepare(`
            SELECT id, title, created_at, updated_at
            FROM project_metadata
            WHERE is_project = 1 AND deleted_at IS NULL
            ORDER BY updated_at DESC
          `).all()
        : store.prepare(`
            SELECT id, title, created_at, updated_at
            FROM project_metadata
            WHERE owner_id = ? AND is_project = 1 AND deleted_at IS NULL
            ORDER BY updated_at DESC
          `).all(identity.userId)
    ) as ProjectRow[];
    const items = rows.map((row) => ({
      cover: projectCover(store, row, ownerId),
      createdAt: row.created_at,
      id: row.id,
      title: row.title,
      updatedAt: row.updated_at,
    }));
    if (!items.some((item) => item.id === "default")) {
      // 默认画布始终作为固定卡片出现在工作空间，避免账号在默认画布里的
      // 内容“有画布却没有入口”而看起来像丢失。
      const defaultCanvas = (
        identity.bypass
          ? store
              .prepare(`
                SELECT updated_at
                FROM canvas_documents
                WHERE id = 'default'
                ORDER BY owner_id IS NULL DESC
                LIMIT 1
              `)
              .get()
          : store
              .prepare(`
                SELECT updated_at
                FROM canvas_documents
                WHERE owner_id = ? AND id = 'default'
              `)
              .get(identity.userId)
      ) as { updated_at: string } | undefined;
      items.unshift({
        cover: projectCover(
          store,
          {
            created_at: null,
            id: "default",
            title: "默认画布",
            updated_at: defaultCanvas
              ? Date.parse(defaultCanvas.updated_at)
              : 0,
          },
          ownerId,
        ),
        createdAt: null,
        id: "default",
        title: "默认画布",
        updatedAt: defaultCanvas ? Date.parse(defaultCanvas.updated_at) : 0,
      });
    }
    json(response, 200, {
      projects: items.map((item) => ({
        cover: item.cover,
        createdAt: item.createdAt,
        id: item.id,
        title: item.title,
        updatedAt: item.updatedAt,
      })),
    });
    return;
  }

  if (request.method === "POST" && !id) {
    try {
      const input = await readJsonBody<{ title?: unknown }>(
        request,
        64 * 1_024,
      );
      const title = typeof input.title === "string"
        ? input.title.trim()
        : "";
      if (title.length > 120) {
        json(response, 400, { error: "Invalid project title" });
        return;
      }
      const projectId = randomUUID();
      const now = Date.now();
      store.exec("BEGIN IMMEDIATE");
      try {
        store.prepare(`
          INSERT INTO project_metadata (
            owner_id, id, title, updated_at, is_project, created_at
          )
          VALUES (?, ?, ?, ?, 1, ?)
        `).run(ownerId, projectId, title || defaultProjectTitle, now, now);
        store.prepare(`
          INSERT INTO canvas_documents (
            owner_id, id, revision, graph_revision, nodes, edges, viewport,
            updated_at, save_sequence
          )
          VALUES (?, ?, 1, 1, '[]', '[]', ?, ?, 0)
        `).run(
          ownerId,
          projectId,
          defaultViewport,
          new Date(now).toISOString(),
        );
        store.exec("COMMIT");
      } catch (error) {
        store.exec("ROLLBACK");
        throw error;
      }
      json(response, 201, {
        createdAt: now,
        id: projectId,
        title: title || defaultProjectTitle,
        updatedAt: now,
      });
    } catch (error) {
      if (error instanceof HttpRequestError) throw error;
      json(response, 400, { error: "Project could not be created" });
    }
    return;
  }

  const cloneMatch = id.match(/^([a-z0-9._-]+)\/clone$/i);
  if (request.method === "POST" && cloneMatch) {
    const sourceId = cloneMatch[1];
    const row = projectRowFor(store, ownerId, sourceId);
    if (!row) {
      json(response, 404, { error: "Project not found" });
      return;
    }
    const canvas = (
      identity.bypass
        ? store.prepare(`
            SELECT nodes, edges, viewport
            FROM canvas_documents
            WHERE id = ?
            ORDER BY owner_id IS NULL DESC
            LIMIT 1
          `).get(sourceId)
        : store.prepare(`
            SELECT nodes, edges, viewport
            FROM canvas_documents
            WHERE owner_id = ? AND id = ?
          `).get(ownerId, sourceId)
    ) as
      | { edges: string; nodes: string; viewport: string }
      | undefined;
    const projectId = randomUUID();
    const now = Date.now();
    const title = `${row.title} 副本`.slice(0, 120);
    store.exec("BEGIN IMMEDIATE");
    try {
      store.prepare(`
        INSERT INTO project_metadata (
          owner_id, id, title, updated_at, is_project, created_at
        )
        VALUES (?, ?, ?, ?, 1, ?)
      `).run(ownerId, projectId, title, now, now);
      store.prepare(`
        INSERT INTO canvas_documents (
          owner_id, id, revision, graph_revision, nodes, edges, viewport,
          updated_at, save_sequence
        )
        VALUES (?, ?, 1, 1, ?, ?, ?, ?, 0)
      `).run(
        ownerId,
        projectId,
        canvas?.nodes ?? "[]",
        canvas?.edges ?? "[]",
        canvas?.viewport ?? defaultViewport,
        new Date(now).toISOString(),
      );
      store.exec("COMMIT");
    } catch (error) {
      store.exec("ROLLBACK");
      throw error;
    }
    json(response, 201, {
      createdAt: now,
      id: projectId,
      title,
      updatedAt: now,
    });
    return;
  }

  if (request.method === "DELETE" && id) {
    if (id === "default") {
      json(response, 409, { error: "默认项目不能删除" });
      return;
    }
    const row = projectRowFor(store, ownerId, id);
    if (!row) {
      json(response, 404, { error: "Project not found" });
      return;
    }
    if (hasActiveProjectMediaPublications(store, ownerId, id, identity.bypass)) {
      json(response, 409, {
        code: "MEDIA_PUBLICATION_ACTIVE",
        error: "项目仍有媒体结果正在收口，请稍后再删除",
      });
      return;
    }
    try {
      await cancelCanvasGenerationTasks(id, identity.bypass ? undefined : identity.userId);
    } catch {
      json(response, 409, {
        error: "项目还有运行中的生成任务，请先取消任务或等待完成后再删除",
      });
      return;
    }
    if (hasActiveProjectMediaPublications(store, ownerId, id, identity.bypass)) {
      json(response, 409, {
        code: "MEDIA_PUBLICATION_ACTIVE",
        error: "项目仍有媒体结果正在收口，请稍后再删除",
      });
      return;
    }
    const now = Date.now();
    store.exec("BEGIN IMMEDIATE");
    try {
      deleteProjectRows(store, ownerId, id, now, identity.bypass);
      store.exec("COMMIT");
    } catch (error) {
      store.exec("ROLLBACK");
      if (activePublicationDeleteError(error)) {
        json(response, 409, {
          code: "MEDIA_PUBLICATION_ACTIVE",
          error: "项目仍有媒体结果正在收口，请稍后再删除",
        });
        return;
      }
      throw error;
    }
    json(response, 204, {});
    return;
  }

  response.setHeader("Allow", "GET, POST, DELETE");
  json(response, 405, { error: "Method not allowed" });
}

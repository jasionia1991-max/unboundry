import type { IncomingMessage, ServerResponse } from "node:http";
import type { DatabaseSync } from "node:sqlite";
import { appDataDirectory, openAppDatabase } from "./database";
import { requestIdentity } from "./auth";
import { normalizePersistedMediaNodes } from "../types/persistedMediaSources";
import { canvasGraphFingerprint } from "../types/canvasFingerprint";

type CanvasDocument = {
  edges: unknown[];
  nodes: unknown[];
  revision: number;
  saveSequence?: number;
  saveSessionId?: string;
  viewport: { x: number; y: number; zoom: number };
};

type HistoryAsset = {
  createdAt?: string;
  id: string;
  kind: "image" | "video" | "audio" | "world3d";
  label: string;
  preview: string;
};

type ProjectTitle = {
  title: string;
  updatedAt: number;
};

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

async function readBody<T>(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > 5_000_000) throw new Error("Payload too large");
    chunks.push(bytes);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
}

function valid(document: CanvasDocument) {
  const { viewport } = document;
  return (
    Number.isInteger(document.revision) &&
    document.revision >= 0 &&
    Array.isArray(document.nodes) &&
    document.nodes.length <= 5_000 &&
    Array.isArray(document.edges) &&
    document.edges.length <= 10_000 &&
    viewport &&
    [viewport.x, viewport.y, viewport.zoom].every(Number.isFinite) &&
    viewport.zoom > 0 &&
    ((document.saveSessionId === undefined && document.saveSequence === undefined) ||
      (typeof document.saveSessionId === "string" &&
        /^[a-z0-9-]{8,80}$/i.test(document.saveSessionId) &&
        Number.isSafeInteger(document.saveSequence) &&
        Number(document.saveSequence) > 0))
  );
}

export async function canvasPersistence(
  request: IncomingMessage,
  response: ServerResponse,
) {
  const id = decodeURIComponent((request.url ?? "").split("?")[0]).replace(
    /^\/+/,
    "",
  );
  if (!/^[a-z0-9._-]+$/i.test(id)) {
    json(response, 400, { error: "Invalid canvas ID" });
    return;
  }

  const store = db();
  const identity = requestIdentity(request);
  if (!identity) {
    json(response, 401, { error: "Please sign in" });
    return;
  }
  if (request.method === "DELETE") {
    if (identity.bypass) {
      store.prepare("DELETE FROM canvas_documents WHERE id = ?").run(id);
    } else {
      store
        .prepare("DELETE FROM canvas_documents WHERE owner_id = ? AND id = ?")
        .run(identity.userId, id);
    }
    json(response, 204, {});
    return;
  }

  const row = (
    identity.bypass
      ? store
          .prepare(`
            SELECT revision, graph_revision, nodes, edges, viewport,
                   save_session_id, save_sequence
            FROM canvas_documents
            WHERE id = ?
            ORDER BY owner_id IS NULL DESC
            LIMIT 1
          `)
          .get(id)
      : store
          .prepare(`
            SELECT revision, graph_revision, nodes, edges, viewport,
                   save_session_id, save_sequence
            FROM canvas_documents
            WHERE owner_id = ? AND id = ?
          `)
          .get(identity.userId, id)
  ) as
    | {
        edges: string;
        graph_revision: number;
        nodes: string;
        revision: number;
        save_sequence: number;
        save_session_id: string | null;
        viewport: string;
      }
    | undefined;

  if (request.method === "GET") {
    if (!row) {
      json(response, 404, { error: "Canvas not found" });
      return;
    }
    json(response, 200, {
      edges: JSON.parse(row.edges),
      graphRevision: row.graph_revision,
      nodes: JSON.parse(row.nodes),
      revision: row.revision,
      viewport: JSON.parse(row.viewport),
    });
    return;
  }

  if (request.method !== "PUT") {
    response.setHeader("Allow", "GET, PUT, DELETE");
    json(response, 405, { error: "Method not allowed" });
    return;
  }

  try {
    const document = await readBody<CanvasDocument>(request);
    if (!valid(document)) {
      json(response, 400, { error: "Invalid canvas document" });
      return;
    }
    const currentRevision = row?.revision ?? 0;
    const sameSessionOlderSave = Boolean(
      row &&
      document.saveSessionId &&
      row.save_session_id === document.saveSessionId &&
      Number(document.saveSequence) <= row.save_sequence,
    );
    if (sameSessionOlderSave) {
      json(response, 409, {
        error: "Superseded same-session save",
        graphRevision: row?.graph_revision ?? 0,
        revision: currentRevision,
        saveSequence: row?.save_sequence ?? 0,
        saveSessionId: row?.save_session_id ?? null,
      });
      return;
    }
    const revision = currentRevision + 1;
    const nodes = normalizePersistedMediaNodes(document.nodes);
    const edges = document.edges;
    const graphChanged = !row || canvasGraphFingerprint({
      edges,
      nodes,
    }) !== canvasGraphFingerprint({
      edges: JSON.parse(row.edges) as unknown[],
      nodes: JSON.parse(row.nodes) as unknown[],
    });
    const graphRevision = row
      ? row.graph_revision + (graphChanged ? 1 : 0)
      : 1;
    const ownerId = identity.bypass ? "__test__" : identity.userId;
    store
      .prepare(`
        INSERT INTO canvas_documents (
          owner_id, id, revision, graph_revision, nodes, edges, viewport, updated_at,
          save_session_id, save_sequence
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(owner_id, id) DO UPDATE SET
          revision = excluded.revision,
          graph_revision = excluded.graph_revision,
          nodes = excluded.nodes,
          edges = excluded.edges,
          viewport = excluded.viewport,
          updated_at = excluded.updated_at,
          save_session_id = excluded.save_session_id,
          save_sequence = excluded.save_sequence
      `)
      .run(
        ownerId,
        id,
        revision,
        graphRevision,
        JSON.stringify(nodes),
        JSON.stringify(edges),
        JSON.stringify(document.viewport),
        new Date().toISOString(),
        document.saveSessionId ?? null,
        document.saveSequence ?? 0,
      );
    json(response, 200, { graphRevision, revision });
  } catch (error) {
    json(response, 400, {
      error: error instanceof Error ? error.message : "Invalid request",
    });
  }
}

export async function accountHistory(
  request: IncomingMessage,
  response: ServerResponse,
) {
  const accountId = decodeURIComponent((request.url ?? "").split("?")[0]).replace(
    /^\/+/,
    "",
  );
  if (!/^[a-z0-9._-]+$/i.test(accountId)) {
    json(response, 400, { error: "Invalid account ID" });
    return;
  }

  const store = db();
  const identity = requestIdentity(request);
  if (!identity) {
    json(response, 401, { error: "Please sign in" });
    return;
  }
  const effectiveAccountId = identity.bypass ? accountId : identity.userId;
  if (request.method === "GET") {
    const items = (
      identity.bypass
        ? store
            .prepare(`
              SELECT id, kind, label, preview, created_at AS createdAt
              FROM asset_history
              WHERE account_id = ?
              ORDER BY created_at DESC, rowid DESC
            `)
            .all(effectiveAccountId)
        : store
            .prepare(`
              SELECT id, kind, label, preview, created_at AS createdAt
              FROM asset_history
              WHERE owner_id = ?
              ORDER BY created_at DESC, rowid DESC
            `)
            .all(identity.userId)
    ) as HistoryAsset[];
    json(response, 200, { items });
    return;
  }

  if (request.method === "DELETE") {
    if (identity.bypass) {
      store
        .prepare("DELETE FROM asset_history WHERE account_id = ?")
        .run(effectiveAccountId);
    } else {
      store
        .prepare("DELETE FROM asset_history WHERE owner_id = ?")
        .run(identity.userId);
    }
    json(response, 204, {});
    return;
  }

  if (request.method !== "POST") {
    response.setHeader("Allow", "GET, POST, DELETE");
    json(response, 405, { error: "Method not allowed" });
    return;
  }

  try {
    const item = await readBody<HistoryAsset>(request);
    if (
      !/^[a-z0-9._-]+$/i.test(item.id) ||
      !["image", "video", "audio", "world3d"].includes(item.kind) ||
      typeof item.label !== "string" ||
      item.label.length < 1 ||
      item.label.length > 120 ||
      typeof item.preview !== "string" ||
      item.preview.length > 1_000
    ) {
      json(response, 400, { error: "Invalid history asset" });
      return;
    }
    store
      .prepare(`
        INSERT INTO asset_history (
          account_id, id, kind, label, preview, created_at, owner_id
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(account_id, id) DO UPDATE SET
          kind = excluded.kind,
          label = excluded.label,
          preview = excluded.preview,
          owner_id = excluded.owner_id
      `)
      .run(
        effectiveAccountId,
        item.id,
        item.kind,
        item.label,
        item.preview,
        new Date().toISOString(),
        identity.bypass ? "__test__" : identity.userId,
      );
    json(response, 201, { item });
  } catch (error) {
    json(response, 400, {
      error: error instanceof Error ? error.message : "Invalid request",
    });
  }
}

export async function projectTitle(
  request: IncomingMessage,
  response: ServerResponse,
) {
  const id = decodeURIComponent((request.url ?? "").split("?")[0]).replace(
    /^\/+/,
    "",
  );
  if (!/^[a-z0-9._-]+$/i.test(id)) {
    json(response, 400, { error: "Invalid project ID" });
    return;
  }

  const store = db();
  const identity = requestIdentity(request);
  if (!identity) {
    json(response, 401, { error: "Please sign in" });
    return;
  }
  if (request.method === "DELETE") {
    if (identity.bypass) {
      store.prepare("DELETE FROM project_metadata WHERE id = ?").run(id);
    } else {
      store
        .prepare("DELETE FROM project_metadata WHERE owner_id = ? AND id = ?")
        .run(identity.userId, id);
    }
    json(response, 204, {});
    return;
  }

  const read = () =>
    (identity.bypass
      ? store
          .prepare(`
            SELECT title, updated_at AS updatedAt
            FROM project_metadata
            WHERE id = ?
            ORDER BY owner_id IS NULL DESC
            LIMIT 1
          `)
          .get(id)
      : store
          .prepare(`
            SELECT title, updated_at AS updatedAt
            FROM project_metadata
            WHERE owner_id = ? AND id = ?
          `)
          .get(identity.userId, id)) as ProjectTitle | undefined;

  if (request.method === "GET") {
    const row = read();
    if (!row) {
      json(response, 404, { error: "Project title not found" });
      return;
    }
    json(response, 200, row);
    return;
  }

  if (request.method !== "PUT") {
    response.setHeader("Allow", "GET, PUT, DELETE");
    json(response, 405, { error: "Method not allowed" });
    return;
  }

  try {
    const item = await readBody<ProjectTitle>(request);
    if (
      typeof item.title !== "string" ||
      item.title.length > 120 ||
      !Number.isSafeInteger(item.updatedAt) ||
      item.updatedAt < 1
    ) {
      json(response, 400, { error: "Invalid project title" });
      return;
    }
    const ownerId = identity.bypass ? "__test__" : identity.userId;
    store
      .prepare(`
        INSERT INTO project_metadata (owner_id, id, title, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(owner_id, id) DO UPDATE SET
          title = excluded.title,
          updated_at = excluded.updated_at
        WHERE excluded.updated_at >= project_metadata.updated_at
      `)
      .run(ownerId, id, item.title, item.updatedAt);
    json(response, 200, read());
  } catch (error) {
    json(response, 400, {
      error: error instanceof Error ? error.message : "Invalid request",
    });
  }
}

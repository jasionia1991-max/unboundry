import type { IncomingMessage, ServerResponse } from "node:http";
import type { DatabaseSync } from "node:sqlite";
import { appDataDirectory, openAppDatabase } from "./database";

const agentConfiguration = {
  executionEnabled: false,
  skills: [
    {
      description: "整理人物、动机与关系，但真实Agent执行尚未开放。",
      enabled: false,
      id: "brainstorm",
      label: "头脑风暴",
    },
    {
      description: "读取已选择的画布引用，但不会发送给外部模型。",
      enabled: false,
      id: "canvas-context",
      label: "画布内容整理",
    },
    {
      description: "优化提示词结构，待真实Agent协议接入后开放。",
      enabled: false,
      id: "prompt-polish",
      label: "提示词优化",
    },
  ],
  suggestions: [
    {
      category: "头脑风暴",
      description: "梳理角色、动机与彼此之间的联系",
      icon: "✣",
      id: "character-relations",
      title: "体验 Brainstorm 模式设计人物关系",
    },
    {
      category: "头脑风暴",
      description: "补充地点、规则、背景与故事线索",
      icon: "▦",
      id: "world-building",
      title: "体验 Brainstorm 模式扩展世界观",
    },
  ],
} as const;

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

function textModels() {
  const rows = db().prepare(`
    SELECT
      model_profiles.id,
      model_profiles.display_name AS label,
      node_model_bindings.is_default
    FROM model_profiles
    JOIN node_model_bindings
      ON node_model_bindings.model_id = model_profiles.id
      AND node_model_bindings.node_type = 'text'
    WHERE
      model_profiles.capability = 'text'
      AND model_profiles.status = 'published'
      AND node_model_bindings.enabled = 1
      AND node_model_bindings.is_default = 1
    ORDER BY
      node_model_bindings.is_default DESC,
      node_model_bindings.sort_order ASC,
      model_profiles.created_at ASC
  `).all() as Array<{ id: string; is_default: number; label: string }>;
  return rows.map((row) => ({
    id: row.id,
    isDefault: Boolean(row.is_default),
    label: row.label,
    status: "ready" as const,
  }));
}

export function agentConfigurationApi(
  request: IncomingMessage,
  response: ServerResponse,
) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  if (request.method !== "GET") {
    response.statusCode = 405;
    response.setHeader("Allow", "GET");
    response.end(JSON.stringify({ error: "Agent配置只支持读取" }));
    return;
  }
  const models = textModels();
  response.statusCode = 200;
  response.end(JSON.stringify({
    ...agentConfiguration,
    defaultModelId: models.find((model) => model.isDefault)?.id ?? models[0]?.id ?? "",
    models: models.map(({ isDefault: _isDefault, ...model }) => model),
  }));
}

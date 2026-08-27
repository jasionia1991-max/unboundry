import { createHash } from "node:crypto";
import type {
  ModelContractBinding,
  ModelContractConnectorFamily,
  ModelContractRuntimeInput,
  ModelExecutionContract,
  ModelExecutionMode,
} from "../types/modelExecutionContracts";

const connectorFamilies = new Set<ModelContractConnectorFamily>([
  "openai-chat",
  "openai-responses",
  "claude-messages",
  "gemini-generate-content",
  "gpt-image",
  "generic-async-media",
  "ark-native",
  "mureka-native",
  "specialized-code",
]);
const dangerousPathPart = /(?:^|\.)(?:__proto__|constructor|prototype)(?:\.|$)/i;
const identifier = /^[a-z][a-z0-9._-]{0,79}$/i;
const relativeEndpoint = /^\/(?!\/)[a-z0-9._~!$&'()*+,;=:@/-]{1,240}$/i;
const safeConstant = /^[a-z0-9._:-]{1,80}$/i;
const resultPaths = new Set([
  "result_url",
  "data.0.b64_json",
  "output.0.content.0.text",
  "content.0.text",
  "candidates.0.content.parts.0.text",
]);
const taskIdPaths = new Set(["task_id"]);
const statePaths = new Set(["state"]);

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (record(value)) {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonical(value[key])}`
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], label: string) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new Error(`${label}包含不允许的字段`);
  }
}

function contractPath(value: unknown, label: string) {
  if (typeof value !== "string" || !identifier.test(value) || dangerousPathPart.test(value)) {
    throw new Error(`${label}不在白名单`);
  }
  return value;
}

function endpoint(value: unknown, label: string) {
  if (typeof value !== "string" || !relativeEndpoint.test(value) || value.includes("..")) {
    throw new Error(`${label}必须是受限相对路径`);
  }
  return value;
}

function binding(value: unknown, roleIds: ReadonlySet<string>): ModelContractBinding {
  if (!record(value) || !record(value.source) || !record(value.target)) {
    throw new Error("请求绑定无效");
  }
  exactKeys(value, ["source", "target", "transform"], "请求绑定");
  exactKeys(value.target, ["location", "path"], "绑定目标");
  if (!["json", "query", "form"].includes(String(value.target.location))) {
    throw new Error("绑定目标位置不受支持");
  }
  const targetPath = contractPath(value.target.path, "绑定目标");
  const targetRoot = targetPath.split(".")[0];
  if (!["model", "prompt", "params", "task_id", "image", "mask"].includes(targetRoot)) {
    throw new Error("绑定目标超出connector白名单");
  }
  const transform = value.transform;
  if (transform !== undefined && ![
    "array", "boolean", "number", "omit-empty", "string",
  ].includes(String(transform))) throw new Error("绑定转换不受支持");
  const sourceKind = value.source.kind;
  if (![
    "model-id", "prompt", "parameter", "role", "constant", "task-id",
  ].includes(String(sourceKind))) throw new Error("绑定来源不受支持");
  if (sourceKind === "parameter") {
    exactKeys(value.source, ["kind", "key"], "参数来源");
    contractPath(value.source.key, "参数来源");
  } else if (sourceKind === "role") {
    exactKeys(value.source, ["kind", "roleId"], "角色来源");
    const roleId = contractPath(value.source.roleId, "角色来源");
    if (!roleIds.has(roleId)) throw new Error("请求绑定引用了未知角色");
  } else if (sourceKind === "constant") {
    exactKeys(value.source, ["kind", "value"], "常量来源");
    if (!["boolean", "number", "string"].includes(typeof value.source.value)) {
      throw new Error("常量来源类型无效");
    }
    if (
      typeof value.source.value === "string" &&
      (
        !safeConstant.test(value.source.value) ||
        /(?:secret|token|api[-_]?key|authorization|bearer)/i.test(value.source.value)
      )
    ) throw new Error("字符串常量只允许短枚举值，不得承载凭据");
  } else {
    exactKeys(value.source, ["kind"], "绑定来源");
  }
  if (sourceKind === "task-id" && targetRoot !== "task_id") {
    throw new Error("task ID只能进入受限查询槽位");
  }
  return value as unknown as ModelContractBinding;
}

function mode(value: unknown): ModelExecutionMode {
  if (!record(value) || !Array.isArray(value.roles) || !Array.isArray(value.bindings)) {
    throw new Error("输入模式无效");
  }
  exactKeys(value, ["id", "prompt", "roles", "bindings", "evidence", "runtime"], "输入模式");
  const id = contractPath(value.id, "模式ID");
  if (value.prompt !== "required" && value.prompt !== "optional") {
    throw new Error("Prompt规则无效");
  }
  const evidence = value.evidence as ModelExecutionMode["evidence"];
  const runtime = value.runtime as ModelExecutionMode["runtime"];
  if ((evidence === undefined) !== (runtime === undefined)) {
    throw new Error("模式证据与运行状态必须同时声明");
  }
  if (
    evidence !== undefined &&
    !["EXACT", "GENERIC_GUESS", "SPECIALIZED", "UNKNOWN"].includes(String(evidence))
  ) throw new Error("模式证据等级无效");
  if (runtime !== undefined && runtime !== "blocked" && runtime !== "declarative") {
    throw new Error("模式运行状态无效");
  }
  if (
    (evidence === "UNKNOWN" && runtime !== "blocked") ||
    (runtime === "blocked" && evidence !== "UNKNOWN") ||
    (runtime === "declarative" && evidence !== "EXACT")
  ) throw new Error("模式证据与运行状态不一致");
  const roleIds = new Set<string>();
  const roles = value.roles.map((item) => {
    if (!record(item)) throw new Error("素材角色无效");
    exactKeys(item, ["id", "kind", "minItems", "maxItems", "ordered", "shape"], "素材角色");
    const roleId = contractPath(item.id, "角色ID");
    if (roleIds.has(roleId)) throw new Error("角色ID重复");
    roleIds.add(roleId);
    if (!["text", "image", "video", "audio"].includes(String(item.kind)) ||
        !Number.isSafeInteger(item.minItems) || !Number.isSafeInteger(item.maxItems) ||
        Number(item.minItems) < 0 || Number(item.maxItems) < Number(item.minItems) ||
        Number(item.maxItems) > 32 || typeof item.ordered !== "boolean" ||
        !["url", "file-id"].includes(String(item.shape))) {
      throw new Error("素材角色数量或shape无效");
    }
    return {
      id: roleId,
      kind: item.kind as "audio" | "image" | "text" | "video",
      maxItems: Number(item.maxItems),
      minItems: Number(item.minItems),
      ordered: item.ordered,
      shape: item.shape as "file-id" | "url",
    };
  });
  const bindings = value.bindings.map((item) => binding(item, roleIds));
  const targets = bindings.map((item) => `${item.target.location}:${item.target.path}`);
  if (new Set(targets).size !== targets.length) throw new Error("请求目标存在多个来源");
  if (!bindings.some((item) => item.source.kind === "model-id") ||
      !bindings.some((item) => item.source.kind === "prompt")) {
    throw new Error("模式缺少model或Prompt绑定");
  }
  for (const role of roles) {
    const roleBindings = bindings.filter((item) =>
      item.source.kind === "role" && item.source.roleId === role.id
    );
    if (roleBindings.length !== 1) throw new Error(`角色 ${role.id} 必须且只能绑定一次`);
  }
  return {
    bindings,
    ...(evidence !== undefined ? { evidence } : {}),
    id,
    prompt: value.prompt,
    roles,
    ...(runtime !== undefined ? { runtime } : {}),
  };
}

function modeSignature(value: ModelExecutionMode) {
  return canonical({
    prompt: value.prompt,
    roles: [...value.roles].map((role) => ({
      id: role.id,
      kind: role.kind,
      maxItems: role.maxItems,
      minItems: role.minItems,
      ordered: role.ordered,
      shape: role.shape,
    })).sort((left, right) => left.id.localeCompare(right.id)),
  });
}

function modesOverlap(left: ModelExecutionMode, right: ModelExecutionMode) {
  const leftRoles = new Map(left.roles.map((role) => [role.id, role]));
  const rightRoles = new Map(right.roles.map((role) => [role.id, role]));
  for (const roleId of new Set([...leftRoles.keys(), ...rightRoles.keys()])) {
    const leftRole = leftRoles.get(roleId);
    const rightRole = rightRoles.get(roleId);
    if (!leftRole) {
      if (rightRole!.minItems > 0) return false;
      continue;
    }
    if (!rightRole) {
      if (leftRole.minItems > 0) return false;
      continue;
    }
    if (
      leftRole.kind !== rightRole.kind ||
      leftRole.shape !== rightRole.shape ||
      Math.max(leftRole.minItems, rightRole.minItems) >
        Math.min(leftRole.maxItems, rightRole.maxItems)
    ) return false;
  }
  return true;
}

export function compileModelExecutionContract(input: unknown) {
  if (!record(input)) throw new Error("模型执行合同无效");
  exactKeys(input, [
    "connectorFamily", "connectorVersion", "create", "modes", "poll", "result", "version",
  ], "模型执行合同");
  if (!connectorFamilies.has(input.connectorFamily as ModelContractConnectorFamily) ||
      !Number.isSafeInteger(input.connectorVersion) || Number(input.connectorVersion) < 1 ||
      ![1, 2].includes(Number(input.version)) || !record(input.create) || !record(input.result) ||
      !Array.isArray(input.modes) || input.modes.length < 1 || input.modes.length > 16) {
    throw new Error("模型执行合同版本或connector无效");
  }
  exactKeys(input.create, ["method", "path", "taskIdPath"], "创建合同");
  if (input.create.method !== "POST") throw new Error("创建合同只允许POST");
  endpoint(input.create.path, "创建路径");
  if (input.create.taskIdPath !== undefined && !taskIdPaths.has(String(input.create.taskIdPath))) {
    throw new Error("task ID路径不在白名单");
  }
  exactKeys(input.result, ["resultPath", "states"], "结果合同");
  if (!resultPaths.has(String(input.result.resultPath))) throw new Error("结果路径不在白名单");
  if (input.result.states !== undefined) {
    if (!record(input.result.states)) throw new Error("状态合同无效");
    exactKeys(input.result.states, ["failed", "running", "succeeded"], "状态合同");
    const seen = new Set<string>();
    for (const key of ["failed", "running", "succeeded"] as const) {
      const values = input.result.states[key];
      if (!Array.isArray(values) || values.length < 1 || values.length > 16) {
        throw new Error("状态枚举无效");
      }
      for (const state of values) {
        if (typeof state !== "string" || !identifier.test(state) || seen.has(state)) {
          throw new Error("状态枚举重复或无效");
        }
        seen.add(state);
      }
    }
    if (!statePaths.has("state")) throw new Error("状态路径不受支持");
  }
  if (input.poll !== undefined) {
    if (!record(input.poll) || !record(input.poll.taskIdTarget)) throw new Error("轮询合同无效");
    exactKeys(input.poll, ["method", "path", "taskIdTarget"], "轮询合同");
    if (input.poll.method !== "GET" && input.poll.method !== "POST") throw new Error("轮询方法无效");
    endpoint(input.poll.path, "轮询路径");
    if (input.poll.taskIdTarget.location !== "query" || input.poll.taskIdTarget.path !== "task_id") {
      throw new Error("轮询task ID目标不受支持");
    }
  }
  const modes = input.modes.map(mode);
  if (input.connectorFamily === "generic-async-media") {
    if (
      input.create.method !== "POST" ||
      input.create.path !== "/v1/media/generate" ||
      input.create.taskIdPath !== "task_id" ||
      !record(input.poll) ||
      input.poll.method !== "GET" ||
      input.poll.path !== "/v1/media/status" ||
      input.result.resultPath !== "result_url" ||
      !record(input.result.states)
    ) throw new Error("通用异步媒体connector必须使用已验证的创建、轮询、状态和结果协议");
    for (const executionMode of modes) {
      for (const role of executionMode.roles) {
        if (role.shape !== "url") throw new Error("通用异步媒体connector只接受URL素材角色");
      }
      for (const item of executionMode.bindings) {
        if (item.target.location !== "json" || item.source.kind === "task-id") {
          throw new Error("通用异步媒体创建请求只允许受限JSON绑定");
        }
        const target = item.target.path;
        if (
          (item.source.kind === "model-id" && target !== "model") ||
          (item.source.kind === "prompt" && target !== "prompt") ||
          (item.source.kind === "role" && !target.startsWith("params.")) ||
          (!["model-id", "prompt", "role", "parameter", "constant"].includes(item.source.kind)) ||
          (["parameter", "constant"].includes(item.source.kind) && !target.startsWith("params."))
        ) throw new Error("通用异步媒体绑定没有进入connector拥有的槽位");
      }
    }
  }
  if (new Set(modes.map((item) => item.id)).size !== modes.length ||
      new Set(modes.map(modeSignature)).size !== modes.length) {
    throw new Error("输入模式重叠或ID重复");
  }
  for (let left = 0; left < modes.length; left += 1) {
    for (let right = left + 1; right < modes.length; right += 1) {
      if (modesOverlap(modes[left], modes[right])) {
        throw new Error("输入模式在有效输入上存在重叠");
      }
    }
  }
  const contract = { ...input, modes } as unknown as ModelExecutionContract;
  const serialized = canonical(contract);
  return Object.freeze({
    contract,
    hash: createHash("sha256").update(serialized).digest("hex"),
    preview: Object.freeze({ method: contract.create.method, path: contract.create.path }),
    serialized,
  });
}

function matchesMode(mode: ModelExecutionMode, input: {
  prompt: string;
  inputs: readonly ModelContractRuntimeInput[];
}) {
  if (mode.prompt === "required" && !input.prompt.trim()) return false;
  const allowed = new Map(mode.roles.map((role) => [role.id, role]));
  const counts = new Map<string, number>();
  const orders = new Set<number>();
  for (const item of input.inputs) {
    const role = allowed.get(item.roleId);
    if (!role || role.kind !== item.kind || !Number.isSafeInteger(item.order) ||
        item.order < 1 || orders.has(item.order) || !item.value.trim()) return false;
    orders.add(item.order);
    counts.set(item.roleId, (counts.get(item.roleId) ?? 0) + 1);
  }
  return mode.roles.every((role) => {
    const count = counts.get(role.id) ?? 0;
    return count >= role.minItems && count <= role.maxItems;
  });
}

export function selectExecutionMode(contract: ModelExecutionContract, input: {
  prompt: string;
  inputs: readonly ModelContractRuntimeInput[];
}) {
  const matches = contract.modes.filter((candidate) => matchesMode(candidate, input));
  if (matches.length !== 1) throw new Error("无法确定唯一输入模式，已在Provider前阻断");
  if (matches[0].runtime === "blocked" || matches[0].evidence === "UNKNOWN") {
    throw new Error("该输入模式缺少精确Provider证据，已在Provider前阻断");
  }
  return matches[0];
}

type CompiledRequest = Readonly<{
  body: Readonly<Record<string, unknown>>;
  method: "GET" | "POST";
  path: string;
  query: Readonly<Record<string, string>>;
}>;

function setPath(target: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.split(".");
  let cursor = target;
  for (const part of parts.slice(0, -1)) {
    const next = cursor[part];
    if (next === undefined) cursor[part] = {};
    if (!record(cursor[part])) throw new Error("绑定目标路径冲突");
    cursor = cursor[part] as Record<string, unknown>;
  }
  cursor[parts.at(-1)!] = value;
}

function transformed(value: unknown, transform: ModelContractBinding["transform"]) {
  if (transform === "array") return Array.isArray(value) ? value : [value];
  if (transform === "boolean") return Boolean(value);
  if (transform === "number") {
    const number = Number(value);
    if (!Number.isFinite(number)) throw new Error("参数不能转换为数字");
    return number;
  }
  if (transform === "string") {
    if (Array.isArray(value)) throw new Error("多值素材不能压平为字符串");
    return String(value);
  }
  return value;
}

/** Deterministically compiles a validated mode into connector-owned slots. */
export function compileModelContractRequest(
  contract: ModelExecutionContract,
  input: Readonly<{
    inputs: readonly ModelContractRuntimeInput[];
    modelId: string;
    parameters: Readonly<Record<string, unknown>>;
    prompt: string;
  }>,
): CompiledRequest {
  const mode = selectExecutionMode(contract, input);
  const body: Record<string, unknown> = {};
  const query: Record<string, string> = {};
  for (const item of mode.bindings) {
    let value: unknown;
    switch (item.source.kind) {
      case "model-id": value = input.modelId; break;
      case "prompt": value = input.prompt; break;
      case "parameter": value = input.parameters[item.source.key]; break;
      case "constant": value = item.source.value; break;
      case "task-id": throw new Error("创建请求不能读取task ID");
      case "role": {
        const roleId = item.source.roleId;
        const role = mode.roles.find((candidate) => candidate.id === roleId)!;
        const selected = input.inputs.filter((candidate) => candidate.roleId === roleId);
        const values = (role.ordered
          ? [...selected].sort((left, right) => left.order - right.order)
          : selected
        ).map((candidate) => candidate.value);
        value = values.length === 1 ? values[0] : values;
        break;
      }
    }
    if (value === undefined || value === "") {
      if (item.transform === "omit-empty") continue;
      throw new Error("合同绑定缺少必填值");
    }
    value = transformed(value, item.transform);
    if (item.target.location === "query") {
      query[item.target.path] = Array.isArray(value)
        ? value.map(String).join(",")
        : String(value);
    } else {
      setPath(body, item.target.path, value);
    }
  }
  return Object.freeze({
    body: Object.freeze(body),
    method: contract.create.method,
    path: contract.create.path,
    query: Object.freeze(query),
  });
}

export function compileModelContractPoll(
  contract: ModelExecutionContract,
  taskId: string,
) {
  if (!contract.poll || !taskId.trim()) throw new Error("合同不支持轮询或task ID为空");
  return Object.freeze({
    body: Object.freeze({}),
    method: contract.poll.method,
    path: contract.poll.path,
    query: Object.freeze({ [contract.poll.taskIdTarget.path]: taskId }),
  });
}

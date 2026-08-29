import {
  normalizeParameterValues,
  parameterConditionsMatch,
  type ModelInputRolePolicy,
  type ModelParameterSchema,
  type ModelParameterValue,
  type ModelUpstreamInputKind,
} from "./modelParameters";

export type ModelInputTransitionIntent =
  | "execute"
  | "load"
  | "mode-switch"
  | "model-switch";

export type ModelSemanticInput = Readonly<{
  kind: ModelUpstreamInputKind;
  order: number;
  role: string;
  semanticId: string;
}>;

export type ModelInputSemanticProblem = Readonly<{
  code:
    | "INPUT_ORDER_INVALID"
    | "MODE_AMBIGUOUS"
    | "MODE_UNSUPPORTED"
    | "ROLE_LIMIT_UNSATISFIED"
    | "ROLE_UNSUPPORTED";
  message: string;
  semanticId?: string;
}>;

export type ModelInputSemanticResult = Readonly<{
  blockingProblems: readonly ModelInputSemanticProblem[];
  contractFingerprint: string;
  normalizedParameters: Readonly<Record<string, ModelParameterValue>>;
  normalizedSemanticInputs: readonly ModelSemanticInput[];
  selectedExecutionMode: string;
  warnings: readonly string[];
}>;

function activeRolePolicy(
  schema: ModelParameterSchema,
  parameters: Record<string, ModelParameterValue>,
) {
  const exact = schema.inputPolicy?.rolePolicies?.find((policy) =>
    parameterConditionsMatch(policy.enabledWhen, parameters)
  );
  if (exact) return exact;
  return schema.inputPolicy
    ? { roles: schema.inputPolicy.roles ?? {} }
    : undefined;
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function semanticFingerprint(value: unknown) {
  const source = stable(value);
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index);
    left = Math.imul(left ^ code, 0x01000193) >>> 0;
    right = Math.imul(right ^ code, 0x85ebca6b) >>> 0;
  }
  return `mic2:${left.toString(16).padStart(8, "0")}${right.toString(16).padStart(8, "0")}`;
}

function mediaCounts(inputs: readonly ModelSemanticInput[]) {
  return {
    audio: inputs.filter((item) => item.kind === "audio").length,
    image: inputs.filter((item) => item.kind === "image").length,
    video: inputs.filter((item) => item.kind === "video").length,
  };
}

function roleFallback(
  kind: ModelUpstreamInputKind,
  current: string,
  allowed: readonly string[],
) {
  if (allowed.includes(current)) return current;
  const referenceRole = `reference-${kind}`;
  if (allowed.includes(referenceRole)) return referenceRole;
  if (allowed.length === 1) return allowed[0];
  return undefined;
}

function normalizeRolesForPolicy(
  inputs: readonly ModelSemanticInput[],
  policy: ModelInputRolePolicy | undefined,
) {
  const problems: ModelInputSemanticProblem[] = [];
  const normalized = inputs.map((item) => ({ ...item }));
  for (const kind of ["audio", "image", "text", "video"] as const) {
    const items = normalized.filter((item) => item.kind === kind);
    const allowed = policy && Object.prototype.hasOwnProperty.call(policy.roles, kind)
      ? policy.roles[kind] ?? []
      : undefined;
    if (!allowed) continue;
    const assignment = policy?.assignment?.[kind] ?? [];
    items.forEach((item, index) => {
      const nextRole = allowed.includes(item.role)
        ? item.role
        : assignment[index] ?? roleFallback(kind, item.role, allowed);
      if (!nextRole || !allowed.includes(nextRole)) {
        problems.push({
          code: "ROLE_UNSUPPORTED",
          message: `当前模式不能无损解释${kind}输入角色${item.role}`,
          semanticId: item.semanticId,
        });
        return;
      }
      item.role = nextRole;
    });
  }
  for (const limit of policy?.limits ?? []) {
    const count = normalized.filter((item) =>
      item.kind === limit.kind && item.role === limit.role
    ).length;
    if (count < limit.minCount || count > limit.maxCount) {
      problems.push({
        code: "ROLE_LIMIT_UNSATISFIED",
        message: `${limit.kind}角色${limit.role}需要${limit.minCount}至${limit.maxCount}个，当前为${count}个`,
      });
    }
  }
  return { inputs: normalized, problems };
}

function exactZeroMode(schema: ModelParameterSchema, mode: string) {
  return schema.referencePolicy?.modes[mode]?.sets.every((set) =>
    set.audio === 0 && set.image === 0 && set.video === 0
  ) ?? false;
}

function candidateForMode(input: {
  connectedInputs: readonly ModelSemanticInput[];
  mode: string;
  normalizedParameters: Record<string, ModelParameterValue>;
  schema: ModelParameterSchema;
}) {
  const policy = input.schema.referencePolicy!;
  const parameters = {
    ...input.normalizedParameters,
    [policy.modeKey]: input.mode,
  };
  const counts = mediaCounts(input.connectedInputs);
  const fits = policy.modes[input.mode]?.sets.some((set) =>
    counts.audio <= set.audio && counts.image <= set.image && counts.video <= set.video
  ) ?? false;
  if (!fits) return undefined;
  const roles = normalizeRolesForPolicy(
    input.connectedInputs,
    activeRolePolicy(input.schema, parameters),
  );
  return {
    inputs: roles.inputs,
    mode: input.mode,
    parameters,
    problems: roles.problems,
  };
}

/**
 * Provider-neutral, side-effect-free compiler shared by Canvas previews and
 * server-side admission. It never deletes or reorders an input.
 */
export function normalizeModelInputs(input: {
  connectedInputs: readonly ModelSemanticInput[];
  modelReleaseRevision: string;
  requestedParameters: unknown;
  schema: ModelParameterSchema;
  transitionIntent: ModelInputTransitionIntent;
}): ModelInputSemanticResult {
  const normalizedParameters = normalizeParameterValues(
    input.schema,
    input.requestedParameters,
  );
  const sortedInputs = input.connectedInputs
    .map((item) => ({ ...item }))
    .sort((left, right) => left.order - right.order || left.semanticId.localeCompare(right.semanticId));
  const blockingProblems: ModelInputSemanticProblem[] = [];
  const seenOrders = new Set<number>();
  for (const item of sortedInputs) {
    if (!Number.isSafeInteger(item.order) || item.order < 1 || seenOrders.has(item.order)) {
      blockingProblems.push({
        code: "INPUT_ORDER_INVALID",
        message: "输入顺序必须是唯一的正整数，所有引用已保留",
        semanticId: item.semanticId,
      });
    }
    seenOrders.add(item.order);
  }

  let selectedExecutionMode = "default";
  let normalizedSemanticInputs = sortedInputs;
  const warnings: string[] = [];
  const referencePolicy = input.schema.referencePolicy;
  if (referencePolicy) {
    const requestedMode = String(normalizedParameters[referencePolicy.modeKey] ?? "");
    const attempts = Object.keys(referencePolicy.modes)
      .map((mode) => candidateForMode({
        connectedInputs: sortedInputs,
        mode,
        normalizedParameters,
        schema: input.schema,
      }))
      .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate));
    const candidates = attempts.filter((candidate) => candidate.problems.length === 0);
    const counts = mediaCounts(sortedInputs);
    const hasMedia = counts.audio + counts.image + counts.video > 0;
    const requestedAttempt = attempts.find((candidate) =>
      candidate.mode === requestedMode &&
      (hasMedia || exactZeroMode(input.schema, candidate.mode))
    );
    const requested = requestedAttempt?.problems.length === 0
      ? requestedAttempt
      : undefined;
    let selected = requested;
    if (requestedAttempt && input.transitionIntent !== "model-switch") {
      selected = requestedAttempt;
      blockingProblems.push(...requestedAttempt.problems);
    }
    if (!selected) {
      const eligible = hasMedia
        ? candidates.filter((candidate) => !exactZeroMode(input.schema, candidate.mode))
        : candidates.filter((candidate) => exactZeroMode(input.schema, candidate.mode));
      if (eligible.length === 1) {
        [selected] = eligible;
      } else if (eligible.length > 1 && referencePolicy.normalizationPriority) {
        selected = referencePolicy.normalizationPriority
          .map((mode) => eligible.find((candidate) => candidate.mode === mode))
          .find(Boolean);
      } else if (eligible.length > 1) {
        blockingProblems.push({
          code: "MODE_AMBIGUOUS",
          message: "现有输入可匹配多个模式，但模型版本没有声明规范化优先级",
        });
      }
    }
    if (!selected && !blockingProblems.some((problem) => problem.code === "MODE_AMBIGUOUS")) {
      blockingProblems.push({
        code: "MODE_UNSUPPORTED",
        message: "现有输入无法无损匹配当前模型的任何输入模式，所有引用已保留",
      });
    }
    if (selected) {
      selectedExecutionMode = selected.mode;
      normalizedSemanticInputs = selected.inputs;
      Object.assign(normalizedParameters, selected.parameters);
      if (selected.mode !== requestedMode) {
        warnings.push(`输入模式已从${requestedMode || "未指定"}规范化为${selected.mode}`);
      }
      if (sortedInputs.some((item, index) => item.role !== normalizedSemanticInputs[index]?.role)) {
        warnings.push("输入角色已按当前模型合同无损规范化");
      }
    }
  } else {
    const roles = normalizeRolesForPolicy(
      sortedInputs,
      activeRolePolicy(input.schema, normalizedParameters),
    );
    normalizedSemanticInputs = roles.inputs;
    blockingProblems.push(...roles.problems);
  }

  const contractFingerprint = semanticFingerprint({
    inputs: normalizedSemanticInputs,
    parameters: normalizedParameters,
    revision: input.modelReleaseRevision,
    selectedExecutionMode,
  });
  return {
    blockingProblems,
    contractFingerprint,
    normalizedParameters,
    normalizedSemanticInputs,
    selectedExecutionMode,
    warnings,
  };
}

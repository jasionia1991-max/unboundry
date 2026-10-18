import {
  parameterOptionCatalog,
  textOnlyUpstreamInputs,
  type ModelCapability,
  type ModelInputRolePolicy,
  type ModelParameterAvailability,
  type ModelParameterField,
  type ModelNodeInputPolicy,
  type ModelParameterOption,
  type ModelReferenceMediaRule,
  type ModelParameterSchema,
  type ModelParameterValue,
  type ModelReferenceInputs,
  type ModelUpstreamInputKind,
} from "../../../types/modelParameters";
import { type ProviderProtocol } from "../../../types/relayProtocols";
import { AdminCustomParameterBuilder, AdminParameterDefaultSelect } from "./AdminCustomParameterBuilder";
import { AdminGptImageSizeMapEditor } from "./AdminGptImageSizeMapEditor";

export function AdminModelParameterEditor({
  capability,
  constraints,
  onChange,
  providerProtocol = "",
  schema,
}: {
  capability: ModelCapability;
  constraints?: ModelParameterSchema;
  onChange: (schema: ModelParameterSchema) => void;
  providerProtocol?: ProviderProtocol | "";
  schema: ModelParameterSchema;
}) {
  const groupLabels = {
    advanced: "高级设置",
    input: "输入区",
    main: "主参数",
    output: "输出",
  } as const;
  const availabilityOptions: ModelParameterOption[] = [
    { label: "可用", value: "available" },
    { label: "显示但禁用", value: "disabled" },
    { label: "显示为锁定", value: "locked" },
  ];
  const catalogEntries = Object.entries(parameterOptionCatalog).filter(
    ([key, item]) =>
      item.capability.includes(capability) &&
      (!constraints || constraints.fields.some((field) => field.key === key)),
  );
  const availableOptions = (key: string) =>
    constraints?.fields.find((field) => field.key === key)?.options ??
    parameterOptionCatalog[key]?.options ??
    [];
  const updateFields = (fields: ModelParameterField[]) =>
    onChange({ ...schema, fields });

  const setFieldEnabled = (key: string, enabled: boolean) => {
    if (!enabled && constraints?.referencePolicy?.modeKey === key) return;
    if (!enabled) {
      updateFields(schema.fields.filter((field) => field.key !== key));
      return;
    }
    const catalog = parameterOptionCatalog[key];
    if (!catalog || !catalog.capability.includes(capability)) return;
    const selectable = catalog.type === "select" || catalog.type === "boolean";
    const enabledOptions = selectable ? availableOptions(key) : [];
    const defaultValue: ModelParameterValue = selectable
      ? enabledOptions[0]?.value ?? ""
      : catalog.type === "number" ? 0 : "";
    updateFields([
      ...schema.fields,
      {
        defaultValue,
        group: catalog.group,
        key,
        label: catalog.label,
        maxLength: catalog.maxLength,
        options: enabledOptions,
        placeholder: catalog.placeholder,
        summary: catalog.summary,
        type: catalog.type,
      },
    ]);
  };

  const setOptionEnabled = (
    field: ModelParameterField,
    value: ModelParameterValue,
    enabled: boolean,
  ) => {
    const catalog = parameterOptionCatalog[field.key];
    if (!catalog) return;
    const allowedOptions = availableOptions(field.key);
    let options = enabled
      ? allowedOptions.filter((option) =>
          field.options.some((current) => current.value === option.value) ||
          option.value === value,
        )
      : field.options.filter((option) => option.value !== value);
    if (options.length === 0) return;
    const defaultValue = options.some(
      (option) => option.value === field.defaultValue,
    )
      ? field.defaultValue
      : options[0].value;
    options = allowedOptions.filter((option) =>
      options.some((current) => current.value === option.value),
    );
    updateFields(schema.fields.map((item) =>
      item.key === field.key ? { ...item, defaultValue, options } : item,
    ));
  };

  const setDefault = (field: ModelParameterField, value: ModelParameterValue) => {
    updateFields(schema.fields.map((item) =>
      item.key === field.key ? { ...item, defaultValue: value } : item,
    ));
  };

  const setOptionAvailability = (
    field: ModelParameterField,
    value: ModelParameterValue,
    availability: ModelParameterAvailability,
  ) => {
    const options = field.options.map((option) => option.value === value
      ? {
          ...option,
          availability: availability === "available" ? undefined : availability,
          disabledReason: availability === "available" ? undefined : "当前模型配置不可用",
        }
      : option);
    const available = options.filter((option) => (option.availability ?? "available") === "available");
    if (available.length === 0) return;
    const defaultValue = available.some((option) => option.value === field.defaultValue)
      ? field.defaultValue
      : available[0].value;
    updateFields(schema.fields.map((item) => item.key === field.key
      ? { ...item, defaultValue, options }
      : item));
  };

  const setVisibleSource = (field: ModelParameterField, sourceKey: ModelParameterValue) => {
    const source = schema.fields.find((item) => item.key === sourceKey);
    const visibleWhen = source?.options[0]
      ? [{ key: source.key, operator: "equals" as const, value: source.options[0].value }]
      : undefined;
    updateFields(schema.fields.map((item) => item.key === field.key
      ? { ...item, visibleWhen }
      : item));
  };

  const setVisibleValue = (field: ModelParameterField, value: ModelParameterValue) => {
    const condition = field.visibleWhen?.[0];
    if (!condition) return;
    updateFields(schema.fields.map((item) => item.key === field.key
      ? { ...item, visibleWhen: [{ ...condition, value }] }
      : item));
  };

  const inputKinds = ["text", "image", "video", "audio"] as const;
  const inputKindLabels: Record<ModelUpstreamInputKind, string> = {
    audio: "音频",
    image: "图片",
    text: "文字",
    video: "视频",
  };
  const inputMode = schema.fields.find((field) => field.key === "inputMode");
  const inputRoleOptions: Record<
    ModelUpstreamInputKind,
    Array<{ label: string; value: string }>
  > = {
    audio: capability === "text"
      ? [{ label: "音频上下文", value: "context-audio" }]
      : [{ label: "参考音频", value: "reference-audio" }],
    image: capability === "text"
      ? [{ label: "图片上下文", value: "context-image" }]
      : capability === "video"
        ? [
            { label: "普通参考", value: "reference-image" },
            { label: "首帧", value: "first-frame" },
            { label: "尾帧", value: "last-frame" },
            { label: "主体", value: "subject" },
          ]
        : [{ label: "参考图片", value: "reference-image" }],
    text: capability === "text"
      ? [{ label: "文字上下文", value: "context-text" }]
      : [{ label: "生成指令", value: "instruction" }],
    video: capability === "text"
      ? [{ label: "视频上下文", value: "context-video" }]
      : capability === "video"
        ? [
            { label: "普通参考", value: "reference-video" },
            { label: "主体", value: "subject" },
          ]
        : [{ label: "参考视频", value: "reference-video" }],
  };
  const productAllowsUpstream = (kind: ModelUpstreamInputKind) =>
    capability === "text" ||
    capability === "video" ||
    kind === "text" ||
    (capability === "image" && kind === "image");
  const implicitUpstreamInputs = Object.fromEntries(inputKinds.map((kind) => {
    if (capability === "text") {
      return [kind, { ...textOnlyUpstreamInputs[kind] }];
    }
    if (kind === "text") {
      return [kind, { limitMode: "context" as const, supported: true }];
    }
    const count = productAllowsUpstream(kind)
      ? schema.referenceInputs[kind as keyof ModelReferenceInputs]
      : 0;
    return [kind, {
      limitMode: "fixed" as const,
      maxCount: count,
      supported: count > 0,
    }];
  })) as NonNullable<ModelParameterSchema["upstreamInputs"]>;
  const upstreamInputs = schema.upstreamInputs ?? implicitUpstreamInputs;
  const inputPolicy: ModelNodeInputPolicy = schema.inputPolicy ?? {
    switchPolicy: "keep-edge",
  };
  const upstreamConstraint = (kind: ModelUpstreamInputKind) => {
    if (!productAllowsUpstream(kind)) {
      return { limitMode: "fixed" as const, maxCount: 0, supported: false };
    }
    const explicit = constraints?.upstreamInputs?.[kind];
    if (explicit) return explicit;
    if (constraints && capability !== "text" && kind !== "text") {
      const maximum = constraints.referenceInputs[kind];
      return {
        limitMode: "fixed" as const,
        maxCount: maximum,
        supported: maximum > 0,
      };
    }
    return undefined;
  };
  const maximumUpstreamCount = (kind: ModelUpstreamInputKind) => {
    const allowed = upstreamConstraint(kind);
    return allowed?.limitMode === "fixed"
      ? allowed.maxCount ?? 0
      : 16;
  };
  const effectiveRoles = (kind: ModelUpstreamInputKind) => {
    const configured = inputPolicy.roles?.[kind];
    return configured?.length
      ? configured
      : [inputRoleOptions[kind][0].value];
  };
  const updateInputPolicy = (next: ModelNodeInputPolicy) =>
    onChange({ ...schema, inputPolicy: next });

  const setReferenceLimit = (
    kind: keyof ModelParameterSchema["referenceInputs"],
    raw: string,
  ) => {
    const maximum = productAllowsUpstream(kind)
      ? constraints?.referenceInputs[kind] ?? 16
      : 0;
    const value = Math.max(0, Math.min(maximum, Math.round(Number(raw) || 0)));
    onChange({
      ...schema,
      referenceInputs: { ...schema.referenceInputs, [kind]: value },
    });
  };

  const referenceMediaKinds = ["image", "video", "audio"] as const;
  const referenceMediaKindLabels: Record<"audio" | "image" | "video", string> = {
    audio: "音频",
    image: "图片",
    video: "视频",
  };
  const defaultReferenceMediaRule = (
    kind: "audio" | "image" | "video",
  ): ModelReferenceMediaRule => {
    const allowed = constraints?.referenceMediaRules?.[kind];
    if (allowed) return { ...allowed, contentTypes: [...allowed.contentTypes] };
    return kind === "audio"
      ? { contentTypes: ["audio/mpeg", "audio/wav"], maxBytes: 15 * 1024 * 1024 }
      : kind === "video"
        ? { contentTypes: ["video/mp4"], maxBytes: 200 * 1024 * 1024 }
        : { contentTypes: ["image/png"], maxBytes: 20 * 1024 * 1024 };
  };
  const setReferenceMediaEnabled = (
    kind: "audio" | "image" | "video",
    enabled: boolean,
  ) => {
    const current = schema.referenceMediaRules ?? {};
    onChange({
      ...schema,
      referenceMediaRules: {
        ...current,
        [kind]: enabled ? defaultReferenceMediaRule(kind) : undefined,
      },
    });
  };
  const setReferenceMediaRule = (
    kind: "audio" | "image" | "video",
    patch: Partial<ModelReferenceMediaRule>,
  ) => {
    const current = schema.referenceMediaRules?.[kind];
    if (!current) return;
    onChange({
      ...schema,
      referenceMediaRules: {
        ...schema.referenceMediaRules,
        [kind]: { ...current, ...patch },
      },
    });
  };

  const maximumReferences = (sets: ModelReferenceInputs[]) => sets.reduce<ModelReferenceInputs>(
    (maximum, set) => ({
      audio: Math.max(maximum.audio, set.audio),
      image: Math.max(maximum.image, set.image),
      video: Math.max(maximum.video, set.video),
    }),
    { audio: 0, image: 0, video: 0 },
  );

  const saveReferencePolicy = (modes: NonNullable<ModelParameterSchema["referencePolicy"]>["modes"]) => {
    const referenceInputs = maximumReferences(
      Object.values(modes).flatMap((mode) => mode.sets),
    );
    onChange({
      ...schema,
      referenceInputs,
      referencePolicy: { modeKey: "inputMode", modes },
    });
  };

  const setModeReferenceEnabled = (enabled: boolean) => {
    if (!enabled && constraints?.referencePolicy) return;
    if (!enabled) {
      const { referencePolicy: _removed, ...rest } = schema;
      onChange({ ...rest, referenceInputs: schema.referenceInputs });
      return;
    }
    if (!inputMode) return;
    const modes = Object.fromEntries(inputMode.options.map((option) => {
      const constraintSets = constraints?.referencePolicy?.modes[String(option.value)]?.sets;
      return [String(option.value), {
        sets: constraintSets?.length
          ? constraintSets.map((set) => ({ ...set }))
          : [{ ...schema.referenceInputs }],
      }];
    }));
    saveReferencePolicy(modes);
  };

  const updateReferenceSet = (
    mode: string,
    index: number,
    kind: keyof ModelReferenceInputs,
    raw: string,
  ) => {
    if (!schema.referencePolicy) return;
    const constraintSets = constraints?.referencePolicy?.modes[mode]?.sets;
    const providerMaximum = constraintSets?.reduce(
      (value, set) => Math.max(value, set[kind]),
      0,
    ) ?? constraints?.referenceInputs[kind] ?? 16;
    const inputRule = upstreamInputs[kind];
    const inputMaximum = inputRule.supported && inputRule.limitMode === "fixed"
      ? inputRule.maxCount ?? 0
      : 16;
    const maximum = productAllowsUpstream(kind)
      ? Math.min(providerMaximum, inputMaximum)
      : 0;
    const value = Math.max(0, Math.min(maximum, Math.round(Number(raw) || 0)));
    const modes = Object.fromEntries(Object.entries(schema.referencePolicy.modes ?? {}).map(([key, entry]) => [
      key,
      key === mode
        ? { sets: entry.sets.map((set, setIndex) => setIndex === index ? { ...set, [kind]: value } : set) }
        : entry,
    ]));
    saveReferencePolicy(modes);
  };

  const addReferenceSet = (mode: string) => {
    if (!schema.referencePolicy) return;
    const current = schema.referencePolicy.modes?.[mode];
    if (!current || current.sets.length >= 4) return;
    saveReferencePolicy({
      ...schema.referencePolicy.modes,
      [mode]: { sets: [...current.sets, { audio: 0, image: 0, video: 0 }] },
    });
  };

  const removeReferenceSet = (mode: string, index: number) => {
    if (!schema.referencePolicy) return;
    const current = schema.referencePolicy.modes?.[mode];
    if (!current || current.sets.length <= 1) return;
    saveReferencePolicy({
      ...schema.referencePolicy.modes,
      [mode]: { sets: current.sets.filter((_, setIndex) => setIndex !== index) },
    });
  };

  const updateUpstreamInput = (
    kind: ModelUpstreamInputKind,
    patch: Partial<(typeof upstreamInputs)[ModelUpstreamInputKind]>,
  ) => {
    const current = upstreamInputs[kind];
    onChange({
      ...schema,
      upstreamInputs: {
        ...upstreamInputs,
        [kind]: { ...current, ...patch },
      },
    });
  };
  const setUpstreamSupported = (
    kind: ModelUpstreamInputKind,
    supported: boolean,
  ) => {
    const allowed = upstreamConstraint(kind);
    if (!productAllowsUpstream(kind) || (supported && allowed && !allowed.supported)) return;
    const current = upstreamInputs[kind];
    const nextPolicy = supported
      ? {
          ...inputPolicy,
          roles: {
            ...inputPolicy.roles,
            [kind]: effectiveRoles(kind),
          },
        }
      : {
          ...inputPolicy,
          required: { ...inputPolicy.required, [kind]: 0 },
          ...(!constraints?.inputPolicy
            ? {
                rolePolicies: inputPolicy.rolePolicies?.map((policy) => ({
                  ...policy,
                  assignment: policy.assignment
                    ? { ...policy.assignment, [kind]: [] }
                    : undefined,
                  limits: policy.limits?.filter((limit) => limit.kind !== kind),
                  roles: { ...policy.roles, [kind]: [] },
                })),
                roles: { ...inputPolicy.roles, [kind]: [] },
              }
            : {}),
        };
    onChange({
      ...schema,
      inputPolicy: nextPolicy,
      upstreamInputs: {
        ...upstreamInputs,
        [kind]: {
          ...current,
          supported,
          ...(supported && current.limitMode === "fixed"
            ? {
                maxCount: Math.max(
                  1,
                  Math.min(maximumUpstreamCount(kind), current.maxCount ?? 1),
                ),
              }
            : {}),
        },
      },
    });
  };
  const setUpstreamLimitMode = (
    kind: ModelUpstreamInputKind,
    limitMode: "context" | "fixed",
  ) => {
    const allowed = upstreamConstraint(kind);
    if (limitMode === "context" && allowed?.limitMode === "fixed") return;
    updateUpstreamInput(kind, {
      limitMode,
      ...(limitMode === "fixed"
        ? { maxCount: Math.max(1, upstreamInputs[kind].maxCount ?? 1) }
        : { maxCount: undefined }),
    });
  };
  const setUpstreamMaxCount = (kind: ModelUpstreamInputKind, raw: string) => {
    const value = Math.max(
      1,
      Math.min(maximumUpstreamCount(kind), Math.round(Number(raw) || 1)),
    );
    onChange({
      ...schema,
      inputPolicy: {
        ...inputPolicy,
        required: {
          ...inputPolicy.required,
          [kind]: Math.min(inputPolicy.required?.[kind] ?? 0, value),
        },
      },
      upstreamInputs: {
        ...upstreamInputs,
        [kind]: { ...upstreamInputs[kind], maxCount: value },
      },
    });
  };
  const roleUsedByModePolicy = (kind: ModelUpstreamInputKind, role: string) =>
    inputPolicy.rolePolicies?.some((policy) =>
      policy.roles[kind]?.includes(role)) ?? false;
  const modeRolePoliciesLocked = Boolean(constraints?.inputPolicy);
  const setModeRolePoliciesEnabled = (enabled: boolean) => {
    if (modeRolePoliciesLocked || !inputMode?.options.length) return;
    const configuredRoles = Object.fromEntries(inputKinds.map((kind) => [
      kind,
      upstreamInputs[kind].supported && productAllowsUpstream(kind)
        ? effectiveRoles(kind)
        : [],
    ])) as ModelInputRolePolicy["roles"];
    updateInputPolicy({
      ...inputPolicy,
      roles: enabled
        ? { ...inputPolicy.roles, ...configuredRoles }
        : inputPolicy.roles,
      rolePolicies: enabled
        ? inputMode.options.map((option): ModelInputRolePolicy => ({
            enabledWhen: [{
              key: inputMode.key,
              operator: "equals",
              value: option.value,
            }],
            roles: configuredRoles,
          }))
        : undefined,
    });
  };
  const updateModeRolePolicy = (
    index: number,
    update: (policy: ModelInputRolePolicy) => ModelInputRolePolicy,
  ) => {
    if (modeRolePoliciesLocked || !inputPolicy.rolePolicies?.[index]) return;
    updateInputPolicy({
      ...inputPolicy,
      rolePolicies: inputPolicy.rolePolicies.map((policy, policyIndex) =>
        policyIndex === index ? update(policy) : policy),
    });
  };
  const setModeRole = (
    policyIndex: number,
    kind: ModelUpstreamInputKind,
    role: string,
    enabled: boolean,
  ) => {
    const policies = inputPolicy.rolePolicies;
    const policy = policies?.[policyIndex];
    if (modeRolePoliciesLocked || !policy) return;
    const roles = policy.roles[kind] ?? [];
    const nextRoles = enabled
      ? [...new Set([...roles, role])]
      : roles.filter((candidate) => candidate !== role);
    const nextPolicy = {
      ...policy,
      assignment: policy.assignment
        ? {
            ...policy.assignment,
            [kind]: (policy.assignment[kind] ?? []).filter((candidate) =>
              candidate !== role),
          }
        : undefined,
      limits: enabled
        ? policy.limits
        : policy.limits?.filter((limit) =>
            limit.kind !== kind || limit.role !== role),
      roles: { ...policy.roles, [kind]: nextRoles },
    };
    const globalRoles = enabled
      ? [...new Set([...effectiveRoles(kind), role])]
      : effectiveRoles(kind);
    onChange({
      ...schema,
      inputPolicy: {
        ...inputPolicy,
        rolePolicies: policies!.map((candidate, index) =>
          index === policyIndex ? nextPolicy : candidate),
        roles: { ...inputPolicy.roles, [kind]: globalRoles },
      },
    });
  };
  const modeRoleLimit = (
    policy: ModelInputRolePolicy,
    kind: ModelUpstreamInputKind,
    role: string,
  ) => policy.limits?.find((limit) =>
    limit.kind === kind && limit.role === role) ?? {
      kind,
      maxCount: upstreamInputs[kind].limitMode === "fixed"
        ? upstreamInputs[kind].maxCount ?? 1
        : 16,
      minCount: 0,
      role,
    };
  const setModeRoleLimit = (
    policyIndex: number,
    kind: ModelUpstreamInputKind,
    role: string,
    key: "maxCount" | "minCount",
    raw: string,
  ) => updateModeRolePolicy(policyIndex, (policy) => {
    const current = modeRoleLimit(policy, kind, role);
    const maximum = upstreamInputs[kind].limitMode === "fixed"
      ? upstreamInputs[kind].maxCount ?? 1
      : 16;
    const requested = Math.max(0, Math.min(maximum, Math.round(Number(raw) || 0)));
    const next = key === "minCount"
      ? { ...current, maxCount: Math.max(current.maxCount, requested), minCount: requested }
      : { ...current, maxCount: Math.max(current.minCount, requested) };
    return {
      ...policy,
      limits: [
        ...(policy.limits ?? []).filter((limit) =>
          limit.kind !== kind || limit.role !== role),
        next,
      ],
    };
  });
  const setModeRoleAssignment = (
    policyIndex: number,
    kind: ModelUpstreamInputKind,
    role: string,
    enabled: boolean,
  ) => updateModeRolePolicy(policyIndex, (policy) => {
    const assigned = policy.assignment?.[kind] ?? [];
    const allowedOrder = inputRoleOptions[kind].map((option) => option.value);
    const nextAssigned = (enabled
      ? [...new Set([...assigned, role])]
      : assigned.filter((candidate) => candidate !== role))
      .sort((left, right) => allowedOrder.indexOf(left) - allowedOrder.indexOf(right));
    return {
      ...policy,
      assignment: { ...policy.assignment, [kind]: nextAssigned },
    };
  });

  return (
    <div className="admin-model-parameters">
      <div className="admin-model-parameters-heading">
        <strong>模型参数 · 第2版规则</strong>
        <span>可设置选项、默认值、显示条件和不可用状态；平台字段仍由安全适配器处理。</span>
      </div>
      {catalogEntries.map(([key, catalog]) => {
        const field = schema.fields.find((item) => item.key === key);
        const options = availableOptions(key);
        const conditionSources = schema.fields.filter((item) =>
          item.key !== key &&
          (item.type === "select" || item.type === "boolean") &&
          item.options.length > 0);
        const visibleCondition = field?.visibleWhen?.[0];
        const visibleSource = schema.fields.find((item) => item.key === visibleCondition?.key);
        return (
          <section
            data-enabled={field ? "true" : "false"}
            data-parameter-key={key}
            key={key}
          >
            <label className="admin-model-parameter-enable">
              <input
                className="admin-compact-checkbox"
                checked={Boolean(field)}
                disabled={constraints?.referencePolicy?.modeKey === key}
                onChange={(event) => setFieldEnabled(key, event.target.checked)}
                title={constraints?.referencePolicy?.modeKey === key
                  ? "Provider要求保留生成方式，以继续校验每种输入组合"
                  : undefined}
                type="checkbox"
              />
              <strong>{catalog.label}</strong>
              <span>{groupLabels[catalog.group]}</span>
            </label>
            {field && (
              <div className="admin-model-parameter-body">
                {(field.type === "select" || field.type === "boolean") && <div className="admin-model-parameter-options">
                  {options.map((option) => {
                    const selected = field.options.some(
                      (item) => item.value === option.value,
                    );
                    return (
                      <label data-selected={selected ? "true" : "false"} key={String(option.value)}>
                        <input
                          className="admin-compact-checkbox"
                          checked={selected}
                          onChange={(event) =>
                            setOptionEnabled(field, option.value, event.target.checked)
                          }
                          type="checkbox"
                        />
                        <span>{option.label}</span>
                      </label>
                    );
                  })}
                </div>}
                {(field.type === "text" || field.type === "textarea") && (
                  <div className="admin-model-parameter-text-note">
                    此项会在节点输入区显示独立{field.type === "textarea" ? "多行" : "单行"}输入框。
                  </div>
                )}
                {(field.type === "select" || field.type === "boolean") && <label className="admin-model-parameter-default">
                  <span>默认值</span>
                  <AdminParameterDefaultSelect
                    onChange={(value) => setDefault(field, value)}
                    options={field.options.filter((option) =>
                      (option.availability ?? "available") === "available")}
                    value={field.defaultValue}
                  />
                </label>}
                {(field.type === "select" || field.type === "boolean") && field.options.length > 1 && (
                  <div className="admin-model-option-states">
                    <span>选项状态</span>
                    {field.options.map((option) => (
                      <label key={String(option.value)}>
                        <span>{option.label}</span>
                        <AdminParameterDefaultSelect
                          onChange={(value) => setOptionAvailability(
                            field,
                            option.value,
                            value as ModelParameterAvailability,
                          )}
                          options={availabilityOptions}
                          value={option.availability ?? "available"}
                        />
                      </label>
                    ))}
                  </div>
                )}
                {conditionSources.length > 0 && (
                  <div className="admin-model-parameter-condition">
                    <span>显示条件</span>
                    <div>
                      <AdminParameterDefaultSelect
                        onChange={(value) => setVisibleSource(field, value)}
                        options={[
                          { label: "始终显示", value: "__always__" },
                          ...conditionSources.map((source) => ({ label: `当${source.label}为`, value: source.key })),
                        ]}
                        value={visibleCondition?.key ?? "__always__"}
                      />
                      {visibleSource && visibleCondition && (
                        <AdminParameterDefaultSelect
                          onChange={(value) => setVisibleValue(field, value)}
                          options={visibleSource.options}
                          value={visibleCondition.value ?? visibleSource.options[0].value}
                        />
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>
        );
      })}
      {capability === "image" && providerProtocol === "gpt-image" && (
        <AdminGptImageSizeMapEditor onChange={onChange} schema={schema} />
      )}
      <AdminCustomParameterBuilder onChange={onChange} schema={schema} />
      <section className="admin-model-upstream-inputs">
        <div className="admin-model-reference-heading">
          <strong>入参角色与必填条件</strong>
          <span>连线保留在画布，模型只决定当前能否提交</span>
        </div>
        <div className="admin-model-upstream-list">
          {inputKinds.map((kind) => {
            const roles = effectiveRoles(kind);
            const supported = upstreamInputs[kind].supported && productAllowsUpstream(kind);
            const requiredMaximum = upstreamInputs[kind].limitMode === "fixed"
              ? upstreamInputs[kind].maxCount ?? 0
              : 16;
            return (
              <div data-input-kind={kind} key={`policy-${kind}`}>
                <strong>{inputKindLabels[kind]}</strong>
                <label>
                  <span>最少数量</span>
                  <input
                    aria-label={`${kind}必填数量`}
                    disabled={!supported}
                    max={String(requiredMaximum)}
                    min="0"
                    onChange={(event) => updateInputPolicy({
                      ...inputPolicy,
                      required: {
                        ...inputPolicy.required,
                        [kind]: Math.max(
                          0,
                          Math.min(
                            requiredMaximum,
                            Math.round(Number(event.target.value) || 0),
                          ),
                        ),
                      },
                    })}
                    type="number"
                    value={supported ? inputPolicy.required?.[kind] ?? 0 : 0}
                  />
                </label>
                <div className="admin-model-parameter-options">
                  {inputRoleOptions[kind].map((role) => {
                    const selected = roles.includes(role.value);
                    const usedByMode = roleUsedByModePolicy(kind, role.value);
                    const providerRoles = constraints?.inputPolicy?.roles?.[kind];
                    const providerForbids = Boolean(
                      providerRoles && !providerRoles.includes(role.value),
                    );
                    const lastRole = selected && roles.length === 1;
                    return (
                      <label data-selected={supported && selected ? "true" : "false"} key={role.value}>
                        <input
                          className="admin-compact-checkbox"
                          checked={supported && selected}
                          disabled={
                            !supported ||
                            providerForbids ||
                            (selected && (lastRole || usedByMode))
                          }
                          onChange={(event) => updateInputPolicy({
                            ...inputPolicy,
                            roles: {
                              ...inputPolicy.roles,
                              [kind]: event.target.checked
                                ? [...new Set([...roles, role.value])]
                                : roles.filter((value) => value !== role.value),
                            },
                          })}
                          title={usedByMode
                            ? "该角色正在生成方式规则中使用，不能从全局规则单独删除"
                            : lastRole
                              ? "每种已启用的上游类型至少保留一个角色"
                              : undefined}
                          type="checkbox"
                        />
                        <span>{role.label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
        {inputPolicy.rolePolicies?.length ? (
          <small>已被某种生成方式使用的角色不能从全局单独删除，避免模式规则与全局规则冲突。</small>
        ) : null}
        <label className="admin-model-parameter-default">
          <span>切换模型遇到不兼容引用</span>
          <AdminParameterDefaultSelect
            ariaLabel="模型切换规则"
            onChange={(value) => updateInputPolicy({
              ...inputPolicy,
              switchPolicy: value as "block-switch" | "keep-edge",
            })}
            options={[
              { label: "保留连线并显示原因（默认）", value: "keep-edge" },
              { label: "有不兼容引用时禁止切换", value: "block-switch" },
            ]}
            value={inputPolicy.switchPolicy}
          />
        </label>
      </section>
      <section className="admin-model-upstream-inputs">
        <div className="admin-model-reference-heading">
          <strong>上游输入规则</strong>
          <span>统一设置节点可接收的类型和数量</span>
        </div>
        <div className="admin-model-upstream-list">
          {inputKinds.map((kind) => {
            const rule = upstreamInputs[kind];
            const allowed = upstreamConstraint(kind);
            const label = inputKindLabels[kind];
            const baselineAllowed = productAllowsUpstream(kind);
            const note = allowed?.note ?? rule.note;
            return (
              <div data-input-kind={kind} key={kind}>
                <label className="admin-model-upstream-enable">
                  <input
                    className="admin-compact-checkbox"
                    checked={baselineAllowed && rule.supported}
                    disabled={!baselineAllowed || Boolean(allowed && !allowed.supported)}
                    onChange={(event) => setUpstreamSupported(kind, event.target.checked)}
                    type="checkbox"
                  />
                  <strong>{label}</strong>
                </label>
                {baselineAllowed && rule.supported && (
                  <div className="admin-model-upstream-limit">
                    <AdminParameterDefaultSelect
                      ariaLabel={`${label}上游数量规则`}
                      onChange={(value) => setUpstreamLimitMode(
                        kind,
                        value as "context" | "fixed",
                      )}
                      options={[
                        ...(allowed?.limitMode === "fixed"
                          ? []
                          : [{ label: "按上下文动态计算", value: "context" }]),
                        { label: "固定画布数量", value: "fixed" },
                      ]}
                      value={rule.limitMode}
                    />
                    {rule.limitMode === "fixed" && (
                      <input
                        aria-label={`${label}上游输入上限`}
                        max={String(maximumUpstreamCount(kind))}
                        min="1"
                        onChange={(event) => setUpstreamMaxCount(kind, event.target.value)}
                        type="number"
                        value={rule.maxCount ?? 1}
                      />
                    )}
                  </div>
                )}
                {!baselineAllowed && <small>当前项目连线规则不允许该类型</small>}
                {baselineAllowed && rule.supported && note && <small>{note}</small>}
              </div>
            );
          })}
        </div>
        {capability === "text" && <label className="admin-model-parameter-default">
            <span>目标 Prompt 规则</span>
            <AdminParameterDefaultSelect
              ariaLabel="文字目标Prompt规则"
              onChange={(value) => updateInputPolicy({
                ...inputPolicy,
                promptPolicy: value as ModelNodeInputPolicy["promptPolicy"],
              })}
              options={[
                { label: "必须填写本节点 Prompt（默认）", value: "own-required" },
                { label: "允许上游文字替代空 Prompt", value: "own-or-upstream-text" },
              ]}
              value={inputPolicy.promptPolicy ?? "own-required"}
            />
          </label>}
        <small>“按上下文动态计算”表示平台没有固定素材数量，最终仍受模型输入长度限制。</small>
      </section>
      {inputMode?.options.length ? (
        <section className="admin-model-upstream-inputs">
          <div className="admin-model-reference-heading">
            <strong>按生成方式设置角色与必填</strong>
            <label>
              <input
                aria-label="按生成方式设置角色与必填"
                className="admin-compact-checkbox"
                checked={Boolean(inputPolicy.rolePolicies?.length)}
                disabled={modeRolePoliciesLocked}
                onChange={(event) => setModeRolePoliciesEnabled(event.target.checked)}
                title={modeRolePoliciesLocked
                  ? "Provider已固定这组生成方式规则"
                  : undefined}
                type="checkbox"
              />
              <span>{modeRolePoliciesLocked ? "Provider固定" : "分方式设置"}</span>
            </label>
          </div>
          {inputPolicy.rolePolicies?.length ? (
            <div className="admin-model-reference-modes">
              {inputPolicy.rolePolicies.map((policy, policyIndex) => {
                const condition = policy.enabledWhen?.[0];
                const option = inputMode.options.find((candidate) =>
                  candidate.value === condition?.value);
                const modeLabel = option?.label ?? `规则${policyIndex + 1}`;
                return (
                  <div data-role-policy={policyIndex} key={`${condition?.key ?? "rule"}-${String(condition?.value ?? policyIndex)}`}>
                    <strong>{modeLabel}</strong>
                    <div className="admin-model-upstream-list">
                      {inputKinds.map((kind) => {
                        const roles = policy.roles[kind] ?? [];
                        const supported = upstreamInputs[kind].supported &&
                          productAllowsUpstream(kind);
                        return (
                          <div data-input-kind={kind} key={`${policyIndex}-${kind}`}>
                            <strong>{inputKindLabels[kind]}</strong>
                            <div className="admin-model-parameter-options">
                              {inputRoleOptions[kind].map((role) => {
                                const selected = roles.includes(role.value);
                                return (
                                  <label data-selected={selected ? "true" : "false"} key={role.value}>
                                    <input
                                      className="admin-compact-checkbox"
                                      checked={selected}
                                      disabled={modeRolePoliciesLocked || !supported}
                                      onChange={(event) => setModeRole(
                                        policyIndex,
                                        kind,
                                        role.value,
                                        event.target.checked,
                                      )}
                                      type="checkbox"
                                    />
                                    <span>{role.label}</span>
                                  </label>
                                );
                              })}
                            </div>
                            {roles.map((role) => {
                              const roleOption = inputRoleOptions[kind].find((item) =>
                                item.value === role);
                              const limit = modeRoleLimit(policy, kind, role);
                              const assigned = policy.assignment?.[kind]?.includes(role) ?? false;
                              return (
                                <div className="admin-model-reference-set" data-input-role={role} key={`${kind}-${role}`}>
                                  <span>{roleOption?.label ?? role}</span>
                                  <label>
                                    <span>最少</span>
                                    <input
                                      aria-label={`${modeLabel}${inputKindLabels[kind]}${roleOption?.label ?? role}最少数量`}
                                      disabled={modeRolePoliciesLocked}
                                      max={String(limit.maxCount)}
                                      min="0"
                                      onChange={(event) => setModeRoleLimit(
                                        policyIndex,
                                        kind,
                                        role,
                                        "minCount",
                                        event.target.value,
                                      )}
                                      type="number"
                                      value={limit.minCount}
                                    />
                                  </label>
                                  <label>
                                    <span>最多</span>
                                    <input
                                      aria-label={`${modeLabel}${inputKindLabels[kind]}${roleOption?.label ?? role}最多数量`}
                                      disabled={modeRolePoliciesLocked}
                                      max={String(
                                        upstreamInputs[kind].limitMode === "fixed"
                                          ? upstreamInputs[kind].maxCount ?? 1
                                          : 16,
                                      )}
                                      min={String(limit.minCount)}
                                      onChange={(event) => setModeRoleLimit(
                                        policyIndex,
                                        kind,
                                        role,
                                        "maxCount",
                                        event.target.value,
                                      )}
                                      type="number"
                                      value={limit.maxCount}
                                    />
                                  </label>
                                  <label>
                                    <span>自动分配</span>
                                    <input
                                      aria-label={`${modeLabel}${inputKindLabels[kind]}${roleOption?.label ?? role}按顺序自动分配`}
                                      className="admin-compact-checkbox"
                                      checked={assigned}
                                      disabled={modeRolePoliciesLocked}
                                      onChange={(event) => setModeRoleAssignment(
                                        policyIndex,
                                        kind,
                                        role,
                                        event.target.checked,
                                      )}
                                      type="checkbox"
                                    />
                                  </label>
                                </div>
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <small>开启后，可分别设置每种生成方式允许的角色、必填数量和自动分配顺序。</small>
          )}
        </section>
      ) : null}
      <section className="admin-model-reference-limits">
        <div className="admin-model-reference-heading">
          <strong>参考素材组合</strong>
          {inputMode && (
            <label>
              <input
                aria-label="按生成方式分别设置素材组合"
                className="admin-compact-checkbox"
                checked={Boolean(schema.referencePolicy)}
                disabled={Boolean(constraints?.referencePolicy)}
                onChange={(event) => setModeReferenceEnabled(event.target.checked)}
                title={constraints?.referencePolicy
                  ? "Provider要求按生成方式校验素材组合"
                  : undefined}
                type="checkbox"
              />
              <span>按生成方式分别设置</span>
            </label>
          )}
        </div>
        {constraints?.referencePolicy && (
          <small>Provider要求保留分模式校验；可以在当前上限内继续收紧数量和组合。</small>
        )}
        {!schema.referencePolicy && <div className="admin-model-reference-global">
          {(["image", "video", "audio"] as const).map((kind) => (
            <label key={kind}>
              <span>{kind === "image" ? "图片" : kind === "video" ? "视频" : "音频"}</span>
              <input
                aria-label={`${kind}参考素材上限`}
                disabled={
                  !productAllowsUpstream(kind) ||
                  (constraints?.referenceInputs[kind] ?? 16) === 0
                }
                max={String(
                  productAllowsUpstream(kind)
                    ? constraints?.referenceInputs[kind] ?? 16
                    : 0,
                )}
                min="0"
                onChange={(event) => setReferenceLimit(kind, event.target.value)}
                type="number"
                value={schema.referenceInputs[kind]}
              />
            </label>
          ))}
        </div>}
        {schema.referencePolicy && (
          <div className="admin-model-reference-modes">
            {Object.entries(schema.referencePolicy.modes ?? {}).map(([mode, entry]) => {
              const modeLabel = inputMode?.options.find((option) => String(option.value) === mode)?.label ?? mode;
              return (
                <div key={mode}>
                  <strong>{modeLabel}</strong>
                  {entry.sets.map((set, index) => (
                    <div className="admin-model-reference-set" key={`${mode}-${index}`}>
                      <span>组合{index + 1}</span>
                      {(["image", "video", "audio"] as const).map((kind) => (
                        <label key={kind}>
                          <span>{kind === "image" ? "图片" : kind === "video" ? "视频" : "音频"}</span>
                          <input
                            aria-label={`${mode}组合${index + 1}${kind}上限`}
                            min="0"
                            onChange={(event) => updateReferenceSet(mode, index, kind, event.target.value)}
                            type="number"
                            value={set[kind]}
                          />
                        </label>
                      ))}
                      {entry.sets.length > 1 && (
                        <button onClick={() => removeReferenceSet(mode, index)} type="button">删除组合</button>
                      )}
                    </div>
                  ))}
                  {entry.sets.length < 4 && (
                    <button onClick={() => addReferenceSet(mode)} type="button">添加另一种组合</button>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <small>填0表示不接收；“另一种组合”用于表达不同素材搭配方案。</small>
      </section>
      <section className="admin-model-reference-file-rules">
        <div className="admin-model-reference-heading">
          <strong>参考素材文件规则</strong>
          <span>单段格式/大小/时长、总时长上限；Provider 上限内可自行收紧，模型升级时直接在这里调整。</span>
        </div>
        {constraints?.referenceMediaRules && (
          <small>Provider 要求保留文件规则；只能在当前上限内收紧。</small>
        )}
        <div className="admin-model-reference-media-grid">
          {referenceMediaKinds.map((kind) => {
            const constraint = constraints?.referenceMediaRules?.[kind];
            const rule = schema.referenceMediaRules?.[kind];
            const enabled = Boolean(rule) || Boolean(constraint);
            return (
              <div className="admin-model-reference-media-rule" data-kind={kind} key={kind}>
                <label className="admin-model-reference-media-enable">
                  <input
                    aria-label={`启用${referenceMediaKindLabels[kind]}素材规则`}
                    checked={enabled}
                    className="admin-compact-checkbox"
                    disabled={Boolean(constraint)}
                    onChange={(event) =>
                      setReferenceMediaEnabled(kind, event.target.checked)}
                    title={constraint
                      ? "Provider要求保留该素材规则"
                      : undefined}
                    type="checkbox"
                  />
                  <strong>{referenceMediaKindLabels[kind]}</strong>
                </label>
                {enabled && rule && (
                  <div className="admin-model-reference-media-fields">
                    <label>
                      <span>单段上限(MB)</span>
                      <input
                        aria-label={`${referenceMediaKindLabels[kind]}单段大小上限`}
                        max={String(
                          constraint
                            ? Math.floor(constraint.maxBytes / (1024 * 1024))
                            : 512,
                        )}
                        min="1"
                        onChange={(event) =>
                          setReferenceMediaRule(kind, {
                            maxBytes: Math.max(
                              1,
                              Math.round(
                                Number(event.target.value) || 1,
                              ),
                            ) * 1024 * 1024,
                          })}
                        type="number"
                        value={Math.round(rule.maxBytes / (1024 * 1024))}
                      />
                    </label>
                    {kind === "image" && (
                      <>
                        <label>
                          <span>最小宽(px)</span>
                          <input
                            aria-label="参考图片最小宽度"
                            min="1"
                            onChange={(event) =>
                              setReferenceMediaRule(kind, {
                                minWidth: event.target.value === ""
                                  ? undefined
                                  : Math.max(1, Math.round(Number(event.target.value) || 0)),
                              })}
                            placeholder="不限"
                            type="number"
                            value={rule.minWidth ?? ""}
                          />
                        </label>
                        <label>
                          <span>最大宽(px)</span>
                          <input
                            aria-label="参考图片最大宽度"
                            min="1"
                            onChange={(event) =>
                              setReferenceMediaRule(kind, {
                                maxWidth: event.target.value === ""
                                  ? undefined
                                  : Math.max(1, Math.round(Number(event.target.value) || 0)),
                              })}
                            placeholder="不限"
                            type="number"
                            value={rule.maxWidth ?? ""}
                          />
                        </label>
                        <label>
                          <span>最小高(px)</span>
                          <input
                            aria-label="参考图片最小高度"
                            min="1"
                            onChange={(event) =>
                              setReferenceMediaRule(kind, {
                                minHeight: event.target.value === ""
                                  ? undefined
                                  : Math.max(1, Math.round(Number(event.target.value) || 0)),
                              })}
                            placeholder="不限"
                            type="number"
                            value={rule.minHeight ?? ""}
                          />
                        </label>
                        <label>
                          <span>最大高(px)</span>
                          <input
                            aria-label="参考图片最大高度"
                            min="1"
                            onChange={(event) =>
                              setReferenceMediaRule(kind, {
                                maxHeight: event.target.value === ""
                                  ? undefined
                                  : Math.max(1, Math.round(Number(event.target.value) || 0)),
                              })}
                            placeholder="不限"
                            type="number"
                            value={rule.maxHeight ?? ""}
                          />
                        </label>
                        <label>
                          <span>宽高比下限</span>
                          <input
                            aria-label="参考图片宽高比下限"
                            min="0.1"
                            step="0.1"
                            onChange={(event) =>
                              setReferenceMediaRule(kind, {
                                minAspectRatio: event.target.value === ""
                                  ? undefined
                                  : Math.max(
                                      0.1,
                                      Math.round(Number(event.target.value) * 100) / 100,
                                    ),
                              })}
                            placeholder="不限"
                            type="number"
                            value={rule.minAspectRatio ?? ""}
                          />
                        </label>
                        <label>
                          <span>宽高比上限</span>
                          <input
                            aria-label="参考图片宽高比上限"
                            min="0.1"
                            step="0.1"
                            onChange={(event) =>
                              setReferenceMediaRule(kind, {
                                maxAspectRatio: event.target.value === ""
                                  ? undefined
                                  : Math.max(
                                      0.1,
                                      Math.round(Number(event.target.value) * 100) / 100,
                                    ),
                              })}
                            placeholder="不限"
                            type="number"
                            value={rule.maxAspectRatio ?? ""}
                          />
                        </label>
                      </>
                    )}
                    {kind === "video" && (
                      <>
                        <label>
                          <span>最小总像素</span>
                          <input
                            aria-label={`${referenceMediaKindLabels[kind]}最小总像素`}
                            min="1"
                            onChange={(event) =>
                              setReferenceMediaRule(kind, {
                                minPixelCount: event.target.value === ""
                                  ? undefined
                                  : Math.max(1, Math.round(Number(event.target.value) || 0)),
                              })}
                            placeholder="不限"
                            type="number"
                            value={rule.minPixelCount ?? ""}
                          />
                        </label>
                        <label>
                          <span>最大总像素</span>
                          <input
                            aria-label={`${referenceMediaKindLabels[kind]}最大总像素`}
                            min="1"
                            onChange={(event) =>
                              setReferenceMediaRule(kind, {
                                maxPixelCount: event.target.value === ""
                                  ? undefined
                                  : Math.max(1, Math.round(Number(event.target.value) || 0)),
                              })}
                            placeholder="不限"
                            type="number"
                            value={rule.maxPixelCount ?? ""}
                          />
                        </label>
                      </>
                    )}
                    {kind !== "image" && (
                      <>
                        <label>
                          <span>单段最短(秒)</span>
                          <input
                            aria-label={`${referenceMediaKindLabels[kind]}单段最短时长`}
                            min="0"
                            onChange={(event) =>
                              setReferenceMediaRule(kind, {
                                minDurationSeconds:
                                  event.target.value === ""
                                    ? undefined
                                    : Math.max(
                                        0,
                                        Math.round(Number(event.target.value) || 0),
                                      ),
                              })}
                            placeholder="不限"
                            type="number"
                            value={rule.minDurationSeconds ?? ""}
                          />
                        </label>
                        <label>
                          <span>单段最长(秒)</span>
                          <input
                            aria-label={`${referenceMediaKindLabels[kind]}单段最长时长`}
                            min="0"
                            onChange={(event) =>
                              setReferenceMediaRule(kind, {
                                maxDurationSeconds:
                                  event.target.value === ""
                                    ? undefined
                                    : Math.max(
                                        0,
                                        Math.round(Number(event.target.value) || 0),
                                      ),
                              })}
                            placeholder="不限"
                            type="number"
                            value={rule.maxDurationSeconds ?? ""}
                          />
                        </label>
                        <label>
                          <span>总时长上限(秒)</span>
                          <input
                            aria-label={`${referenceMediaKindLabels[kind]}参考素材总时长上限`}
                            min="0"
                            onChange={(event) =>
                              setReferenceMediaRule(kind, {
                                maxTotalDurationSeconds:
                                  event.target.value === ""
                                    ? undefined
                                    : Math.max(
                                        0,
                                        Math.round(Number(event.target.value) || 0),
                                      ),
                              })}
                            placeholder="不限"
                            type="number"
                            value={rule.maxTotalDurationSeconds ?? ""}
                          />
                        </label>
                      </>
                    )}
                    <label className="admin-model-reference-media-formats">
                      <span>格式(MIME,逗号分隔)</span>
                      <input
                        aria-label={`${referenceMediaKindLabels[kind]}允许格式`}
                        onChange={(event) => {
                          const contentTypes = event.target.value
                            .split(",")
                            .map((entry) => entry.trim())
                            .filter(Boolean);
                          if (contentTypes.length) {
                            setReferenceMediaRule(kind, { contentTypes });
                          }
                        }}
                        value={rule.contentTypes.join(",")}
                      />
                    </label>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {schema.referenceMediaRules?.audio && (
          <label className="admin-model-reference-audio-visual">
            <input
              checked={schema.referenceMediaRules.audioRequiresVisual === true}
              className="admin-compact-checkbox"
              disabled={Boolean(
                constraints?.referenceMediaRules?.audioRequiresVisual,
              )}
              onChange={(event) =>
                onChange({
                  ...schema,
                  referenceMediaRules: {
                    ...schema.referenceMediaRules,
                    audioRequiresVisual: event.target.checked,
                  },
                })}
              type="checkbox"
            />
            <span>参考音频必须搭配图片或视频</span>
          </label>
        )}
      </section>
    </div>
  );
}

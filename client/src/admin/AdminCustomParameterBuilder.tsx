import { useState } from "react";
import { GrayMenuSelect } from "../ui/GrayMenuSelect";
import {
  isCustomParameterField,
  type ModelParameterField,
  type ModelParameterOption,
  type ModelParameterSchema,
  type ModelParameterValue,
} from "../../../types/modelParameters";

export function AdminParameterDefaultSelect({
  ariaLabel,
  onChange,
  options,
  value,
}: {
  ariaLabel?: string;
  onChange: (value: ModelParameterValue) => void;
  options: ModelParameterOption[];
  value: ModelParameterValue;
}) {
  return (
    <GrayMenuSelect
      ariaLabel={ariaLabel}
      chevronClassName="admin-parameter-select-chevron"
      className="admin-parameter-select"
      menuClassName="admin-parameter-select-menu"
      onChange={(nextValue) => onChange(nextValue as ModelParameterValue)}
      optionClassName="admin-parameter-select-option"
      options={options.map((option) => ({
        label: option.label,
        value: String(option.value),
      }))}
      placeholder="未设置"
      triggerClassName="admin-parameter-select-trigger"
      value={String(value)}
    />
  );
}

export function AdminCustomParameterBuilder({
  onChange,
  schema,
}: {
  onChange: (schema: ModelParameterSchema) => void;
  schema: ModelParameterSchema;
}) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [type, setType] = useState<ModelParameterField["type"]>("select");
  const [group, setGroup] = useState<ModelParameterField["group"]>("main");
  const [optionText, setOptionText] = useState("低=low，中=medium，高=high");
  const [builderError, setBuilderError] = useState("");
  const customFields = schema.fields.filter(isCustomParameterField);
  const typeOptions: ModelParameterOption[] = [
    { label: "下拉选择", value: "select" },
    { label: "开关", value: "boolean" },
    { label: "数字", value: "number" },
    { label: "单行文字", value: "text" },
    { label: "多行文字", value: "textarea" },
  ];
  const groupOptions: ModelParameterOption[] = [
    { label: "输入区", value: "input" },
    { label: "主参数", value: "main" },
    { label: "高级设置", value: "advanced" },
    { label: "输出", value: "output" },
  ];
  const typeLabels = Object.fromEntries(
    typeOptions.map((option) => [String(option.value), option.label]),
  );
  const groupLabels = Object.fromEntries(
    groupOptions.map((option) => [String(option.value), option.label]),
  );

  const updateField = (key: string, update: Partial<ModelParameterField>) => {
    onChange({
      ...schema,
      fields: schema.fields.map((field) => field.key === key ? { ...field, ...update } : field),
    });
  };

  const addField = () => {
    const cleanLabel = label.trim();
    if (!cleanLabel) {
      setBuilderError("请填写参数名称");
      return;
    }
    if (schema.fields.length >= 24) {
      setBuilderError("单个模型最多配置24个参数");
      return;
    }
    const parsedOptions = optionText
      .split(/[，,\n]/)
      .map((entry) => entry.trim())
      .filter(Boolean)
      .slice(0, 16)
      .map((entry) => {
        const [optionLabel, ...rawValue] = entry.split("=");
        const value = rawValue.length ? rawValue.join("=").trim() : optionLabel.trim();
        return { label: optionLabel.trim(), value } satisfies ModelParameterOption;
      })
      .filter((option, index, items) =>
        option.label && option.value && items.findIndex((item) => item.value === option.value) === index,
      );
    if (type === "select" && parsedOptions.length < 1) {
      setBuilderError("下拉参数至少需要一个选项");
      return;
    }
    const options = type === "select"
      ? parsedOptions
      : type === "boolean"
        ? [{ label: "开启", value: true }, { label: "关闭", value: false }]
        : [];
    const defaultValue: ModelParameterValue = type === "select"
      ? options[0].value
      : type === "boolean"
        ? false
        : type === "number" ? 0 : "";
    const key = `custom_${crypto.randomUUID().replaceAll("-", "")}`;
    onChange({
      ...schema,
      fields: [
        ...schema.fields,
        {
          defaultValue,
          group,
          key,
          label: cleanLabel,
          ...(type === "number" ? { max: 100, min: 0, step: 1 } : {}),
          ...(type === "text" || type === "textarea" ? { maxLength: 2_000 } : {}),
          options,
          providerStatus: "pending",
          summary: true,
          type,
        },
      ],
    });
    setBuilderError("");
    setLabel("");
    setOpen(false);
  };

  return (
    <section className="admin-custom-parameters">
      <div className="admin-custom-parameters-heading">
        <div>
          <strong>未来模型参数</strong>
          <span>新增后会自动出现在对应节点；收费平台映射保持待适配。</span>
        </div>
        <button
          disabled={schema.fields.length >= 24}
          onClick={() => setOpen((current) => !current)}
          type="button"
        >
          {open ? "取消新增" : "新增参数"}
        </button>
      </div>
      {open && (
        <div className="admin-custom-parameter-builder">
          <label>
            <span>用户看到的参数名称</span>
            <input
              maxLength={40}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="例如：安全等级"
              value={label}
            />
          </label>
          <label>
            <span>参数形式</span>
            <AdminParameterDefaultSelect
              onChange={(value) => setType(value as ModelParameterField["type"])}
              options={typeOptions}
              value={type}
            />
          </label>
          <label>
            <span>显示位置</span>
            <AdminParameterDefaultSelect
              onChange={(value) => setGroup(value as ModelParameterField["group"])}
              options={groupOptions}
              value={group ?? "main"}
            />
          </label>
          {type === "select" && (
            <label className="admin-custom-parameter-options-input">
              <span>下拉选项</span>
              <input
                onChange={(event) => setOptionText(event.target.value)}
                placeholder="显示名称=平台值，用逗号分隔"
                value={optionText}
              />
              <small>例如：低=low，中=medium，高=high</small>
            </label>
          )}
          {builderError && <span className="admin-custom-parameter-error">{builderError}</span>}
          <button onClick={addField} type="button">添加到节点</button>
        </div>
      )}
      {customFields.length > 0 && (
        <div className="admin-custom-parameter-list">
          {customFields.map((field) => (
            <div className="admin-custom-parameter-card" key={field.key}>
              <div>
                <strong>{field.label}</strong>
                <span>{typeLabels[field.type]} · {groupLabels[field.group ?? "main"]}</span>
              </div>
              <b>待平台适配</b>
              {(field.type === "select" || field.type === "boolean") && (
                <label>
                  <span>默认值</span>
                  <AdminParameterDefaultSelect
                    onChange={(value) => updateField(field.key, { defaultValue: value })}
                    options={field.options}
                    value={field.defaultValue}
                  />
                </label>
              )}
              {field.type === "number" && (
                <label>
                  <span>默认值</span>
                  <input
                    max={field.max}
                    min={field.min}
                    onChange={(event) => updateField(field.key, {
                      defaultValue: Math.min(
                        field.max ?? Number.POSITIVE_INFINITY,
                        Math.max(field.min ?? Number.NEGATIVE_INFINITY, Number(event.target.value) || 0),
                      ),
                    })}
                    step={field.step}
                    type="number"
                    value={Number(field.defaultValue)}
                  />
                </label>
              )}
              {(field.type === "text" || field.type === "textarea") && (
                <label>
                  <span>默认内容</span>
                  <input
                    maxLength={field.maxLength}
                    onChange={(event) => updateField(field.key, { defaultValue: event.target.value })}
                    value={String(field.defaultValue)}
                  />
                </label>
              )}
              <button
                onClick={() => onChange({
                  ...schema,
                  fields: schema.fields.filter((item) => item.key !== field.key),
                })}
                type="button"
              >
                删除
              </button>
            </div>
          ))}
        </div>
      )}
      <small>“待平台适配”参数只负责节点显示和保存，不会直接发送到任何收费接口。</small>
    </section>
  );
}

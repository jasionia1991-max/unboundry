import { useId, useState } from "react";
import {
  gptImageSizeMapEntryError,
  gptImageSizeTiers,
  youchuangGptImageSizes,
  type GptImageSizeMap,
  type GptImageSizeTier,
  type ModelParameterSchema,
} from "../../../types/modelParameters";

function AdminGptImageSizeMapRowAdd({
  existing,
  listIdBase,
  onAdd,
  tier,
}: {
  existing: ReadonlySet<string>;
  listIdBase: string;
  onAdd: (ratio: string, pixel: string) => void;
  tier: GptImageSizeTier;
}) {
  const [ratio, setRatio] = useState("");
  const [pixel, setPixel] = useState("");
  const [error, setError] = useState("");
  const add = () => {
    const nextRatio = ratio.trim();
    const nextPixel = pixel.trim();
    if (existing.has(nextRatio)) {
      setError("这个比例已经加过了");
      return;
    }
    const message = gptImageSizeMapEntryError(nextRatio, nextPixel);
    if (message) {
      setError(message);
      return;
    }
    onAdd(nextRatio, nextPixel);
    setRatio("");
    setPixel("");
    setError("");
  };
  return (
    <div className="admin-gpt-image-size-row-add">
      <input
        aria-label={`新增${tier.toUpperCase()}比例`}
        onChange={(event) => setRatio(event.target.value)}
        placeholder="比例，如 9:16 或 auto"
        value={ratio}
        list={`${listIdBase}-${tier}`}
      />
      <input
        aria-label={`新增${tier.toUpperCase()}像素`}
        onChange={(event) => setPixel(event.target.value)}
        placeholder="像素，如 2160x3840 或 auto"
        value={pixel}
      />
      <button onClick={add} type="button">加一行</button>
      {error && (
        <span className="admin-gpt-image-size-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

export function AdminGptImageSizeMapEditor({
  onChange,
  schema,
}: {
  onChange: (schema: ModelParameterSchema) => void;
  schema: ModelParameterSchema;
}) {
  const listIdBase = useId();
  const sizeMap = schema.sizeMap ?? {};
  const ratioSuggestions = Array.from(new Set([
    "auto",
    ...(schema.fields.find((field) => field.key === "aspectRatio")?.options ?? [])
      .filter((option) => (option.availability ?? "available") === "available")
      .map((option) => String(option.value)),
  ]));
  const updateSizeMap = (next: GptImageSizeMap | undefined) =>
    onChange({ ...schema, sizeMap: next });
  const setEntry = (tier: GptImageSizeTier, ratio: string, pixel: string) => {
    const tierRows = { ...(sizeMap[tier] ?? {}) };
    tierRows[ratio] = pixel;
    updateSizeMap({ ...sizeMap, [tier]: tierRows });
  };
  const removeEntry = (tier: GptImageSizeTier, ratio: string) => {
    const tierRows = { ...(sizeMap[tier] ?? {}) };
    delete tierRows[ratio];
    const next = { ...sizeMap };
    if (Object.keys(tierRows).length === 0) {
      delete next[tier];
    } else {
      next[tier] = tierRows;
    }
    updateSizeMap(next);
  };
  const addEntry = (tier: GptImageSizeTier) => (
    ratio: string,
    pixel: string,
  ) => {
    const tierRows = { ...(sizeMap[tier] ?? {}) };
    tierRows[ratio] = pixel;
    updateSizeMap({ ...sizeMap, [tier]: tierRows });
  };
  const builtinRatios = Array.from(new Set(
    gptImageSizeTiers.flatMap((tier) =>
      Object.keys(youchuangGptImageSizes[tier]),
    ),
  ));
  return (
    <section
      className="admin-gpt-image-size-map"
      data-testid="admin-gpt-image-size-map"
    >
      <div className="admin-gpt-image-size-map-heading">
        <div>
          <strong>优创尺寸映射</strong>
          <span>这里一般不用动：空着就按下面的内置表出图；想改某个组合才点「加一行」。保存后只对之后新提交的格子生效。</span>
        </div>
        <button onClick={() => updateSizeMap(undefined)} type="button">
          全部恢复内置默认
        </button>
      </div>
      {gptImageSizeTiers.map((tier) => {
        const tierRows = sizeMap[tier] ?? {};
        const rows = Object.entries(tierRows);
        return (
          <div className="admin-gpt-image-size-tier" data-tier={tier} key={tier}>
            <strong>{tier.toUpperCase()}</strong>
            {rows.length === 0 ? (
              <small>没填 = 按内置表发</small>
            ) : (
              rows.map(([ratio, pixel]) => (
                <div className="admin-gpt-image-size-row" key={ratio}>
                  <span className="admin-gpt-image-size-ratio">{ratio}</span>
                  <input
                    aria-label={`${tier.toUpperCase()} ${ratio} 像素`}
                    onChange={(event) =>
                      setEntry(tier, ratio, event.target.value.trim())
                    }
                    value={pixel}
                  />
                  <button onClick={() => removeEntry(tier, ratio)} type="button">
                    删行
                  </button>
                </div>
              ))
            )}
            <AdminGptImageSizeMapRowAdd
              existing={new Set(rows.map(([ratio]) => ratio))}
              listIdBase={listIdBase}
              onAdd={addEntry(tier)}
              tier={tier}
            />
          </div>
        );
      })}
      {gptImageSizeTiers.map((tier) => (
        <datalist id={`${listIdBase}-${tier}`} key={`list-${tier}`}>
          {ratioSuggestions.map((ratio) => (
            <option key={ratio} value={ratio} />
          ))}
        </datalist>
      ))}
      <div className="admin-gpt-image-size-reference">
        <strong>文档内置表（参考）</strong>
        <table>
          <thead>
            <tr>
              <th>比例</th>
              {gptImageSizeTiers.map((tier) => (
                <th key={tier}>{tier.toUpperCase()}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {builtinRatios.map((ratio) => (
              <tr key={ratio}>
                <td>{ratio}</td>
                {gptImageSizeTiers.map((tier) => (
                  <td key={tier}>
                    {youchuangGptImageSizes[tier][ratio] ?? "—"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

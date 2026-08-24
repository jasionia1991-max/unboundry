import { useEffect, useState } from "react";
import type { SeedanceCharacterComplianceCapability } from
  "../../../types/seedanceCharacterCompliance";
import { ImageToolSurface } from "./ImageToolHost";

function parseCapability(value: unknown): SeedanceCharacterComplianceCapability {
  const source = value as Record<string, unknown>;
  if (
    source?.productName !== "角色风险预检" ||
    !["A", "B", "C"].includes(String(source.branch)) ||
    typeof source.available !== "boolean" ||
    typeof source.canCreateChecks !== "boolean" ||
    typeof source.formalSeedanceTicketAccepted !== "boolean" ||
    typeof source.reason !== "string" ||
    typeof source.reasonCode !== "string"
  ) throw new Error("角色风险预检能力状态无效");
  return source as unknown as SeedanceCharacterComplianceCapability;
}

export function SeedanceCharacterCompliancePanel({
  assetId,
  onBusyChange,
  onClose,
}: Readonly<{
  assetId: string;
  onBusyChange?(busy: boolean): void;
  onClose(): void;
}>) {
  const [capability, setCapability] = useState<SeedanceCharacterComplianceCapability>();
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    onBusyChange?.(true);
    void fetch("/api/seedance/character-compliance/capability", {
      cache: "no-store",
    }).then(async (response) => {
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error("角色风险预检能力读取失败");
      if (active) setCapability(parseCapability(body));
    }).catch((caught) => {
      if (active) setError(caught instanceof Error
        ? caught.message : "角色风险预检能力读取失败");
    }).finally(() => {
      if (active) onBusyChange?.(false);
    });
    return () => {
      active = false;
      onBusyChange?.(false);
    };
  }, [onBusyChange]);

  return (
    <ImageToolSurface className="seedance-trusted-asset-shell">
      <div
        className="seedance-trusted-asset-panel"
        data-testid="seedance-character-compliance-panel"
      >
        <header className="image-tool-panel-header">
          <span>
            <strong>角色风险预检</strong>
            <small>风险提示，不是 Seedance 验证、版权认证或法律结论</small>
          </span>
          <button aria-label="关闭角色风险预检" onClick={onClose} type="button">×</button>
        </header>
        <div className="image-tool-panel-body">
          {!capability && !error && <p role="status">正在读取可用能力…</p>}
          {capability && (
            <>
              <div className="seedance-trusted-status" data-status="NOT_STARTED">
                <span aria-hidden="true" />
                <div>
                  <strong>{capability.available ? "服务可用" : "入口已关闭"}</strong>
                  <small>{capability.reason}</small>
                </div>
              </div>
              <dl className="seedance-trusted-details">
                <div><dt>当前图片</dt><dd>{assetId}</dd></div>
                <div><dt>分支</dt><dd>{capability.branch}</dd></div>
                <div><dt>外部提交</dt><dd>{capability.canCreateChecks
                  ? "需确认数据处理说明后提交"
                  : "不会发送图片，不会产生费用"}</dd></div>
                <div><dt>Seedance 旁路</dt><dd>不提供</dd></div>
              </dl>
              {!capability.available && (
                <p>当前没有满足用途、隐私和全部风险分类要求的正式 Provider。工程接口已保留，但本版本不会伪造审核结果。</p>
              )}
            </>
          )}
          {error && <div role="alert">{error}</div>}
        </div>
        <footer className="image-tool-panel-footer">
          <button onClick={onClose} type="button">关闭</button>
        </footer>
      </div>
    </ImageToolSurface>
  );
}

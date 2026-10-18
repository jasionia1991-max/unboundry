import { useEffect, useState } from "react";
import {
  providerErrorParts,
  sanitizeProviderDiagnostic,
  type GenerationNoticeTone,
} from "./generationErrors";
import { recoveryStatusLabel } from "./generationRecoveryClient";
import type { RecoveryCaseSummary } from "../../../types/generationRecovery";
import {
  useGenerationRecovery,
  useGenerationRecoveryTask,
} from "./GenerationRecoveryContext";

export function ProviderErrorNotice({
  diagnostic,
  local = false,
  message,
  recoveryTaskId,
  tone = "failed",
}: {
  diagnostic?: string;
  /**
   * The message came from Unboundry itself (for example a media upload), not
   * from a model platform, so it is shown as-is without a platform summary.
   */
  local?: boolean;
  message: string;
  recoveryTaskId?: string;
  tone?: GenerationNoticeTone;
}) {
  const [diagnosticOpen, setDiagnosticOpen] = useState(false);
  const summary = local
    ? sanitizeProviderDiagnostic(message)
    : providerErrorParts(message).summary;
  const raw = local ? "" : providerErrorParts(diagnostic || message).raw;
  const recovery = useGenerationRecovery();
  const recoveryCase = useGenerationRecoveryTask(recoveryTaskId);
  useEffect(() => {
    setDiagnosticOpen(false);
  }, [diagnostic, message, recoveryTaskId]);
  if (!summary && !recoveryCase) return null;
  return (
    <span
      className="provider-error-notice"
      data-recovery-status={recoveryCase?.status}
      data-testid={recoveryTaskId ? `provider-error-notice-${recoveryTaskId}` : "provider-error-notice"}
      data-tone={recoveryCase ? "recovering" : tone}
    >
      {recoveryCase ? (
        <RecoveryStatus
          item={recoveryCase}
          onRead={() => void recovery.markRead(recoveryCase)}
        />
      ) : summary ? (
        <span className="provider-error-summary">{summary}</span>
      ) : null}
      {raw && (summary || recoveryCase) && (
        <>
          <button
            aria-expanded={diagnosticOpen}
            aria-label={diagnosticOpen ? "收起平台原文" : "查看平台原文"}
            onClick={() => setDiagnosticOpen((value) => !value)}
            type="button"
          >
            {diagnosticOpen ? "收起原文" : "查看原文"}
          </button>
          {diagnosticOpen && (
            <span className="provider-error-detail">
              <code>{raw}</code>
              <button
                aria-label="复制平台原文"
                onClick={() => {
                  if (typeof navigator !== "undefined") {
                    void navigator.clipboard?.writeText(raw);
                  }
                }}
                type="button"
              >
                复制
              </button>
            </span>
          )}
        </>
      )}
    </span>
  );
}

function RecoveryStatus({
  item,
  onRead,
}: {
  item: RecoveryCaseSummary;
  onRead: () => void;
}) {
  const [progressOpen, setProgressOpen] = useState(false);
  useEffect(() => {
    setProgressOpen(false);
  }, [item.taskId, item.caseEventId, item.progressVersion]);
  return (
    <span
      aria-live="polite"
      className="provider-recovery-status"
      data-status={item.status}
    >
      <span
        className="provider-recovery-summary"
        data-testid="generation-recovery-progress-summary"
      >
        {item.summary}
      </span>
      <button
        aria-expanded={progressOpen}
        className="provider-recovery-progress-toggle"
        data-testid="generation-recovery-progress-trigger"
        onClick={() => {
          const nextOpen = !progressOpen;
          setProgressOpen(nextOpen);
          if (nextOpen && item.unread) onRead();
        }}
        type="button"
      >
        {progressOpen ? "收起处理进度" : "查看处理进度"}
      </button>
      {progressOpen && (
        <span
          className="provider-recovery-progress-detail"
          data-testid="generation-recovery-progress-detail"
        >
          <span className="provider-recovery-meta">
            阶段：{recoveryPhaseLabel(item.phase)} · 最近更新：{formatRecoveryTime(item.updatedAt)}
          </span>
          {item.nextCheckAt &&
            (item.status === "scheduled" || item.status === "recovering") && (
              <span className="provider-recovery-next-check">
                系统会继续自动核对
              </span>
            )}
          {item.action === "view_result" && (
            <span className="provider-recovery-action-hint">
              原结果已找回，可在生成任务记录中查看
            </span>
          )}
          {item.action === "regenerate" && (
            <span className="provider-recovery-action-hint">
              当前节点可使用现有生成按钮继续
            </span>
          )}
        </span>
      )}
    </span>
  );
}

function recoveryPhaseLabel(phase: RecoveryCaseSummary["phase"]) {
  switch (phase) {
    case "queued": return "已登记待处理";
    case "claimed": return "维护人员已接手";
    case "waiting_provider": return "等待平台回复";
    case "result_recovered": return "结果已找回";
    case "ready_for_user": return "可以继续使用";
  }
}

function formatRecoveryTime(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString("zh-CN", { hour12: false })
    : "时间未确认";
}

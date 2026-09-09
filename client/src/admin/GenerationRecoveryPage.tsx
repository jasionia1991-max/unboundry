import { useCallback, useEffect, useRef, useState } from "react";
import {
  listAdminGenerationRecovery,
  readAdminGenerationRecovery,
  recoveryStatusLabel,
  runAdminGenerationRecoveryAction,
  type RecoveryAdminAction,
  type GenerationRecoveryRequestError,
} from "../generation/generationRecoveryClient";
import type {
  RecoveryCaseAdminDetail,
  RecoveryCaseAdminSummary,
  RecoveryCaseCorruptSummary,
} from "../../../types/generationRecovery";
import {
  SettingsPageHeader,
  settingsDestination,
} from "../navigation/SettingsPageHeader";

type AdminUser = Readonly<{
  displayName: string;
  id: string;
}>;

const kindLabels = {
  audio: "音频",
  image: "图片",
  text: "文字",
  video: "视频",
} as const;

const phaseLabels = {
  queued: "已登记待处理",
  claimed: "维护人员已接手",
  waiting_provider: "等待平台回复",
  result_recovered: "结果已找回",
  ready_for_user: "可以继续使用",
} as const;

const corruptReasonLabels = {
  invalid_event: "处理记录格式异常",
  unsupported_event: "处理记录版本暂不支持",
  task_missing: "原任务记录暂不可读取",
} as const;

const auditLabels: Record<string, string> = {
  "generation_recovery.case_acknowledged": "用户已查看进度",
  "generation_recovery.case_checked": "核对原请求",
  "generation_recovery.case_claimed": "接手维护事项",
  "generation_recovery.case_closed": "关闭维护事项",
  "generation_recovery.case_opened": "登记维护事项",
  "generation_recovery.case_progressed": "更新等待平台状态",
  "generation_recovery.original_attach_provider_task": "关联原平台任务",
  "generation_recovery.original_resume": "继续观察原任务",
  "generation_recovery.original_result_admit": "接纳原任务结果",
  "generation_recovery.original_settlement": "完成原任务结算",
};

function dateLabel(value: string | undefined) {
  if (!value) return "时间未确认";
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime())
    ? parsed.toLocaleString("zh-CN", { hour12: false })
    : "时间未确认";
}

function safeAdminError(error: unknown) {
  if (error && typeof error === "object" && "code" in error) {
    const code = String((error as GenerationRecoveryRequestError).code ?? "");
    if (code === "RECOVERY_ADMIN_REQUIRED") return "当前账号没有生成维护权限";
    if (code === "RECOVERY_DISABLED" || code === "RECOVERY_FROZEN") {
      return "生成维护暂未开放，原任务记录已保留";
    }
    if (code === "RECOVERY_CONFLICT" || code === "RECOVERY_CASE_CONFLICT") {
      return "处理进度已更新，请重新读取这项维护事项";
    }
  }
  return "生成维护服务暂不可用，原任务记录已保留";
}

function caseIsAdminSummary(
  value: RecoveryCaseAdminSummary | RecoveryCaseAdminDetail["case"] | null,
): value is RecoveryCaseAdminSummary {
  return Boolean(value && "ownerId" in value && "openedAt" in value);
}

function claimLeaseExpired(value: RecoveryCaseAdminSummary) {
  const claimLeaseUntil = value.claimLeaseUntil;
  const expiresAt = claimLeaseUntil ? Date.parse(claimLeaseUntil) : Number.NaN;
  return Number.isFinite(expiresAt) && expiresAt <= Date.now();
}

export function GenerationRecoveryPage({ currentUser }: { currentUser: AdminUser }) {
  const [items, setItems] = useState<RecoveryCaseAdminSummary[]>([]);
  const [corrupt, setCorrupt] = useState<RecoveryCaseCorruptSummary[]>([]);
  const [unavailableCount, setUnavailableCount] = useState(0);
  const [nextCursor, setNextCursor] = useState<string>();
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedTaskId, setSelectedTaskId] = useState<string>();
  const [detail, setDetail] = useState<RecoveryCaseAdminDetail>();
  const [detailLoading, setDetailLoading] = useState(false);
  const [busyAction, setBusyAction] = useState<RecoveryAdminAction>();
  const loadController = useRef<AbortController | undefined>(undefined);
  const detailController = useRef<AbortController | undefined>(undefined);
  const actionController = useRef<AbortController | undefined>(undefined);
  const selectionEpoch = useRef(0);
  const mounted = useRef(false);

  const load = useCallback(async (after?: string) => {
    loadController.current?.abort("generation-recovery-admin-refresh");
    const controller = new AbortController();
    loadController.current = controller;
    setLoading(true);
    setError("");
    try {
      const result = await listAdminGenerationRecovery({ after, limit: 50 }, controller.signal);
      if (controller.signal.aborted) return;
      setEnabled(result.enabled);
      setItems((current) => after ? [...current, ...result.cases] : [...result.cases]);
      setCorrupt((current) => after ? [...current, ...result.corrupt] : [...result.corrupt]);
      setUnavailableCount((current) => after ? current + result.unavailableCount : result.unavailableCount);
      setNextCursor(result.nextCursor);
    } catch (caught) {
      if (!controller.signal.aborted) setError(safeAdminError(caught));
    } finally {
      if (loadController.current === controller) {
        loadController.current = undefined;
        if (!controller.signal.aborted) setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
      selectionEpoch.current += 1;
      loadController.current?.abort("generation-recovery-admin-unmounted");
      detailController.current?.abort("generation-recovery-admin-unmounted");
      actionController.current?.abort("generation-recovery-admin-unmounted");
    };
  }, [load]);

  const select = useCallback(async (item: RecoveryCaseAdminSummary) => {
    const epoch = ++selectionEpoch.current;
    detailController.current?.abort("generation-recovery-admin-detail-superseded");
    actionController.current?.abort("generation-recovery-admin-action-superseded");
    actionController.current = undefined;
    const controller = new AbortController();
    detailController.current = controller;
    setSelectedTaskId(item.taskId);
    setDetail(undefined);
    setDetailLoading(true);
    setBusyAction(undefined);
    setError("");
    try {
      const result = await readAdminGenerationRecovery(item.taskId, controller.signal);
      if (!controller.signal.aborted && mounted.current &&
          selectionEpoch.current === epoch) {
        if (result.case && result.case.taskId !== item.taskId) {
          setError("维护详情与所选事项不一致，原任务记录已保留");
        } else {
          setDetail(result);
        }
      }
    } catch (caught) {
      if (!controller.signal.aborted && mounted.current &&
          selectionEpoch.current === epoch) {
        setError(safeAdminError(caught));
      }
    } finally {
      if (detailController.current === controller) {
        detailController.current = undefined;
        if (!controller.signal.aborted && mounted.current &&
            selectionEpoch.current === epoch) {
          setDetailLoading(false);
        }
      }
    }
  }, []);

  const act = useCallback(async (action: RecoveryAdminAction) => {
    const taskId = selectedTaskId;
    const selected = items.find((item) => item.taskId === taskId);
    const current = detail?.case;
    const epoch = selectionEpoch.current;
    if (!selected || !current || current.taskId !== taskId || busyAction ||
        !mounted.current) return;
    actionController.current?.abort("generation-recovery-admin-action-superseded");
    const controller = new AbortController();
    actionController.current = controller;
    setBusyAction(action);
    setError("");
    try {
      const result = await runAdminGenerationRecoveryAction(action, current, controller.signal);
      if (!controller.signal.aborted && mounted.current &&
          selectionEpoch.current === epoch && selectedTaskId === taskId &&
          (!result.case || result.case.taskId === taskId)) {
        setDetail(result);
        if (result.case && caseIsAdminSummary(result.case)) {
          setItems((currentItems) => currentItems.map((item) =>
            item.taskId === result.case!.taskId ? result.case as RecoveryCaseAdminSummary : item,
          ));
        }
      }
    } catch (caught) {
      if (!controller.signal.aborted && mounted.current &&
          selectionEpoch.current === epoch && selectedTaskId === taskId) {
        setError(safeAdminError(caught));
      }
    } finally {
      if (actionController.current === controller) {
        actionController.current = undefined;
        if (!controller.signal.aborted && mounted.current &&
            selectionEpoch.current === epoch && selectedTaskId === taskId) {
          setBusyAction(undefined);
        }
      }
    }
  }, [busyAction, detail?.case, items, selectedTaskId]);

  const selected = items.find((item) => item.taskId === selectedTaskId);
  const detailCase = detail?.case;
  const showInspect = Boolean(detailCase && detailCase.action !== "none" && enabled);
  const showProgress = Boolean(
    detailCase && enabled &&
      (detailCase.phase === "claimed" || detailCase.phase === "waiting_provider"),
  );
  const adminDetailCase = detailCase && caseIsAdminSummary(detailCase)
    ? detailCase
    : undefined;
  const ownExpiredClaim = Boolean(
    adminDetailCase &&
      adminDetailCase.claimedBy === currentUser.id &&
      claimLeaseExpired(adminDetailCase),
  );
  const showReclaim = Boolean(
    adminDetailCase &&
      (adminDetailCase.followUpDue || ownExpiredClaim),
  );
  const showClaim = Boolean(
    adminDetailCase && enabled && (
      (adminDetailCase.phase === "queued" && !adminDetailCase.claimedBy) ||
      showReclaim
    ),
  );

  return (
    <main className="admin-page generation-recovery-admin-page" data-testid="admin-generation-recovery-page">
      <SettingsPageHeader
        displayName={`管理员：${currentUser.displayName}`}
        pageTitle="生成维护"
        userId={currentUser.id}
      />
      <div className="generation-recovery-admin-layout">
        <section className="admin-card generation-recovery-admin-queue">
          <div className="generation-recovery-admin-heading">
            <div>
              <h1>生成维护队列</h1>
              <p>只处理已登记的异常事项；原任务和平台结果始终保留。</p>
            </div>
            <button
              aria-label="刷新生成维护队列"
              disabled={loading}
              onClick={() => {
                selectionEpoch.current += 1;
                detailController.current?.abort("generation-recovery-admin-refresh");
                actionController.current?.abort("generation-recovery-admin-refresh");
                setSelectedTaskId(undefined);
                setDetail(undefined);
                setDetailLoading(false);
                setBusyAction(undefined);
                setItems([]);
                setCorrupt([]);
                setUnavailableCount(0);
                setNextCursor(undefined);
                void load();
              }}
              type="button"
            >
              {loading ? "读取中…" : "刷新"}
            </button>
          </div>
          {!enabled && (
            <p className="generation-recovery-admin-disabled" data-testid="admin-recovery-disabled" role="status">
              生成维护当前关闭，不能执行处理操作；原任务记录已保留。
            </p>
          )}
          {error && <p className="auth-error" data-testid="admin-recovery-error" role="alert">{error}</p>}
          {loading && items.length === 0 ? (
            <p className="generation-recovery-admin-empty">正在读取维护事项…</p>
          ) : items.length > 0 ? (
            <ul className="generation-recovery-admin-list" data-testid="admin-recovery-list">
              {items.map((item) => (
                <li
                  className="generation-recovery-admin-row"
                  data-selected={item.taskId === selectedTaskId ? "true" : undefined}
                  data-status={item.status}
                  data-testid="admin-recovery-case"
                  key={item.taskId}
                >
                  <button onClick={() => void select(item)} type="button">
                    <span className="generation-recovery-admin-row-heading">
                      <strong>{kindLabels[item.kind]}</strong>
                      <span>{recoveryStatusLabel(item.status)}</span>
                      {item.overdue && <em>待接手超过 24 小时</em>}
                      {item.followUpDue && <em>跟进已到期</em>}
                    </span>
                    <span className="generation-recovery-admin-row-summary">{item.summary}</span>
                    <span className="generation-recovery-admin-row-meta">
                      {item.modelId ? `模型：${item.modelId}` : "模型：未确认"} · 登记于 {dateLabel(item.openedAt)}
                      {item.claimedBy ? ` · 当前认领：${item.claimedBy}` : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="generation-recovery-admin-empty" data-testid="admin-recovery-empty">
              当前没有待处理的维护事项。
            </p>
          )}
          {(corrupt.length > 0 || unavailableCount > 0) && (
            <section className="generation-recovery-admin-corrupt" data-testid="admin-recovery-unavailable">
              <strong>有记录需要维护核对</strong>
              <p>异常记录已保留并单独标记，系统不会据此创建新任务或解锁原请求。</p>
              <ul>
                {corrupt.map((item) => (
                  <li key={`${item.taskId}:${item.eventId}`}>
                    {corruptReasonLabels[item.reason] ?? "处理记录异常"}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {nextCursor && (
            <button
              className="generation-recovery-admin-more"
              data-testid="admin-recovery-load-more"
              disabled={loading}
              onClick={() => void load(nextCursor)}
              type="button"
            >
              读取下一页
            </button>
          )}
        </section>

        <section className="admin-card generation-recovery-admin-detail" data-testid="admin-recovery-detail">
          <h2>维护详情</h2>
          {!selectedTaskId ? (
            <p>选择一项维护事项查看安全状态与操作记录。</p>
          ) : detailLoading ? (
            <p>正在读取维护详情…</p>
          ) : detailCase ? (
            <>
              <div className="generation-recovery-admin-detail-status">
                <strong>{recoveryStatusLabel(detailCase.status)}</strong>
                <span>{detailCase.summary}</span>
              </div>
              <dl>
                {caseIsAdminSummary(detailCase) && (
                  <>
                    <div><dt>所有者</dt><dd>{detailCase.ownerId}</dd></div>
                    <div><dt>模型</dt><dd>{detailCase.modelId ?? "未确认"}</dd></div>
                    <div><dt>原任务创建</dt><dd>{dateLabel(detailCase.originalCreatedAt)}</dd></div>
                    <div><dt>首次登记</dt><dd>{dateLabel(detailCase.openedAt)}</dd></div>
                    {detailCase.claimedBy && (
                      <div><dt>当前认领</dt><dd>{detailCase.claimedBy}</dd></div>
                    )}
                  </>
                )}
                <div><dt>当前阶段</dt><dd>{phaseLabels[detailCase.phase]}</dd></div>
                <div><dt>最近更新</dt><dd>{dateLabel(detailCase.updatedAt)}</dd></div>
              </dl>
              <div className="generation-recovery-admin-actions">
                {showClaim && (
                  <button disabled={Boolean(busyAction)} onClick={() => void act("claim")} type="button">
                    {busyAction === "claim" ? "接手中…" : showReclaim ? "重新接手维护" : "接手维护"}
                  </button>
                )}
                {showInspect && (
                  <button disabled={Boolean(busyAction)} onClick={() => void act("inspect")} type="button">
                    {busyAction === "inspect" ? "核对中…" : "核对原请求"}
                  </button>
                )}
                {showProgress && (
                  <button disabled={Boolean(busyAction)} onClick={() => void act("progress")} type="button">
                    {busyAction === "progress" ? "更新中…" : "标记等待平台回复"}
                  </button>
                )}
              </div>
              <section className="generation-recovery-admin-audit">
                <h3>处理记录</h3>
                {detail?.audit.length ? (
                  <ol>
                    {detail.audit.map((entry) => (
                      <li key={entry.id}>
                        <span>{auditLabels[entry.action] ?? "处理状态更新"}</span>
                        <small>{dateLabel(entry.createdAt)} · {entry.actor}</small>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p>暂时没有可展示的处理记录。</p>
                )}
              </section>
            </>
          ) : (
            <p>这项维护事项当前无法读取，原任务记录已保留。</p>
          )}
        </section>
      </div>
    </main>
  );
}

export function generationRecoveryAdminDestination(userId: string) {
  return settingsDestination("/admin/generation-recovery", userId);
}

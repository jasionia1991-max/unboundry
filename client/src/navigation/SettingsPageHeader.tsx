import { useEffect, useRef, useState } from "react";
import { usePageTitle } from "../pageIdentity";
import {
  pathWithCurrentCanvasSource,
  preferredSourceProjectId,
  projectCanvasPath,
  projectWorkspacePath,
  resolveReturnProject,
  RETURN_PROJECT_LOOKUP_DEADLINE_MS,
} from "./canvasReturn";

export function settingsDestination(path: string, userId: string) {
  return pathWithCurrentCanvasSource(
    path,
    userId,
    window.location.search,
  );
}

export function SettingsPageHeader({
  browserTitle,
  displayName,
  pageTitle,
  userId,
}: {
  browserTitle?: string;
  displayName: string;
  pageTitle: string;
  userId: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lookup = useRef<AbortController | undefined>(undefined);
  const mounted = useRef(true);
  usePageTitle(browserTitle ?? pageTitle);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      lookup.current?.abort();
    };
  }, []);

  const returnToCanvas = async () => {
    if (lookup.current) return;
    const controller = new AbortController();
    lookup.current = controller;
    setBusy(true);
    setError("");
    let timedOut = false;
    const deadline = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, RETURN_PROJECT_LOOKUP_DEADLINE_MS);
    try {
      const projectId = await resolveReturnProject({
        search: window.location.search,
        signal: controller.signal,
        userId,
      });
      window.location.href = projectId
        ? projectCanvasPath(projectId)
        : "/canvas/projects";
    } catch (caught) {
      if (!mounted.current) return;
      setError(
        timedOut
          ? "原画布确认超时，请重试或返回工作空间"
          : caught instanceof Error
            ? `暂时无法确认原画布：${caught.message}`
            : "暂时无法确认原画布，请重试或返回工作空间",
      );
    } finally {
      window.clearTimeout(deadline);
      if (lookup.current === controller) lookup.current = undefined;
      if (mounted.current) setBusy(false);
    }
  };

  const returnToWorkspace = () => {
    window.location.href = projectWorkspacePath(
      preferredSourceProjectId(userId, window.location.search),
    );
  };

  return (
    <header>
      <div>
        <span aria-hidden="true" className="replica-mark" />
        <div>
          <strong>{pageTitle}</strong>
          <small>{displayName}</small>
        </div>
      </div>
      <div
        aria-label="页面返回操作"
        className="settings-header-actions"
        data-testid="settings-header-actions"
      >
        <button
          aria-busy={busy || undefined}
          disabled={busy}
          onClick={() => void returnToCanvas()}
          type="button"
        >
          {busy ? "正在确认…" : "返回画布"}
        </button>
        <button onClick={returnToWorkspace} type="button">
          返回工作空间
        </button>
        {error && (
          <span
            className="settings-return-error"
            data-testid="settings-return-error"
            role="status"
          >
            {error}
          </span>
        )}
      </div>
    </header>
  );
}

import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ModelCatalogProvider } from "./models/ModelCatalog";
import { type AccountPermission } from "../../types/accountPermissions";
import { pathWithCurrentCanvasSource } from "./navigation/canvasReturn";
import { createGroupRunSummaryScope } from "./generation/groupRunSummary";
import { confirmGroupRunNavigation } from "./generation/groupRunCheckpoint";
import { AdminAccounts } from "./admin/AdminAccounts";
import { AdminApiContract } from "./admin/AdminApiContract";
import { AdminGenerationSafety } from "./admin/AdminGenerationSafety";
import { AdminModelContractWorkbench } from "./admin/AdminModelContractWorkbench";
import { AdminModels } from "./admin/AdminModels";
import { AdminProviders } from "./admin/AdminProviders";
import { AdminStorage } from "./admin/AdminStorage";
import { AdminTemplatesPage } from "./admin/AdminTemplatesPage";
import { AccountForm } from "./app/AccountForm";
import { ChangeOwnPasswordDialog } from "./app/ChangeOwnPasswordDialog";
import { MyConnectionsPage } from "./app/MyConnectionsPage";
import {
  type AuthStatus,
  type AuthUser,
  hasClientPermission,
} from "./app/accountAuth";
import { jsonRequest } from "./app/jsonRequest";

const CanvasShell = lazy(async () => ({
  default: (await import("./canvas/CanvasShell")).CanvasShell,
}));
const WorkspacePage = lazy(async () => ({
  default: (await import("./projects/WorkspacePage")).WorkspacePage,
}));
const GenerationRecoveryPage = lazy(async () => ({
  default: (await import("./admin/GenerationRecoveryPage")).GenerationRecoveryPage,
}));

type Fixture = {
  id: string;
  kind: string;
  status: string;
};

type FixtureState =
  | { state: "idle" }
  | { state: "loading"; id: string }
  | { state: "ready"; fixture: Fixture }
  | { state: "error"; message: string };

function decodedRouteComponent(value: string) {
  try {
    const decoded = decodeURIComponent(value);
    return !decoded ||
        decoded.length > 200 ||
        decoded.includes("/") ||
        decoded.includes("\\") ||
        decoded.includes("\0")
      ? undefined
      : decoded;
  } catch {
    return undefined;
  }
}

const fixtureMatch = window.location.pathname.match(/^\/__fixture\/([^/]+)$/);
const fixtureRouteId = fixtureMatch
  ? decodedRouteComponent(fixtureMatch[1])
  : undefined;
const responsivePreviewMatch = window.location.pathname.match(
  /^\/__responsive-preview\/(1280x720|1440x900|1512x982|1920x1080)$/,
);
const projectWorkspaceMatch = window.location.pathname === "/canvas/projects";
const projectCanvasMatch = window.location.pathname.match(/^\/canvas\/([^/]+)$/);
const projectCanvasId = projectCanvasMatch
  ? decodedRouteComponent(projectCanvasMatch[1])
  : undefined;

function ResponsivePreview({
  height,
  width,
}: {
  height: number;
  width: number;
}) {
  const [dpr, setDpr] = useState<number>();
  const [scale, setScale] = useState(() =>
    Math.min(
      (window.innerWidth - 32) / width,
      (window.innerHeight - 86) / height,
      1,
    ),
  );

  useEffect(() => {
    const updateScale = () =>
      setScale(
        Math.min(
          (window.innerWidth - 32) / width,
          (window.innerHeight - 86) / height,
          1,
        ),
      );
    window.addEventListener("resize", updateScale);
    return () => window.removeEventListener("resize", updateScale);
  }, [height, width]);

  return (
    <main
      className="responsive-preview"
      data-preview-height={height}
      data-preview-dpr={dpr}
      data-preview-scale={scale}
      data-preview-width={width}
      data-testid="responsive-preview"
    >
      <header className="responsive-preview-header">
        <div className="responsive-preview-target">
          <strong>{width} × {height} 真实布局预览</strong>
          <small>
            当前 DPR {dpr ?? "读取中"} · 最小支持宽度 1280px
          </small>
        </div>
        <span>
          当前缩放至 {Math.round(scale * 100)}%，仅用于适应内置浏览器窗口
        </span>
      </header>
      <div
        className="responsive-preview-frame"
        style={{ height: height * scale, width: width * scale }}
      >
        <iframe
          aria-label={`${width}×${height}画布`}
          onLoad={(event) =>
            setDpr(event.currentTarget.contentWindow?.devicePixelRatio)
          }
          src={`/__fixture/shell.empty.primary?embedded=${width}x${height}`}
          style={{
            height,
            transform: `scale(${scale})`,
            width,
          }}
          title={`${width}×${height}画布`}
        />
      </div>
    </main>
  );
}

function EffectRedirect({ to }: { to: string }) {
  const redirectStarted = useRef(false);
  useEffect(() => {
    if (redirectStarted.current || window.location.pathname === to) return;
    redirectStarted.current = true;
    window.location.replace(to);
  }, [to]);
  return (
    <main className="system-message" data-testid="route-redirect">
      正在返回可访问页面…
    </main>
  );
}

function AdminRouteGuard({
  allowed,
  children,
}: {
  allowed: boolean;
  children: ReactNode;
}) {
  return allowed ? children : <EffectRedirect to="/" />;
}

function AuthenticatedApplication({
  fixtureId,
  projectId,
  workspace = false,
}: {
  fixtureId?: string;
  projectId?: string;
  workspace?: boolean;
}) {
  const [status, setStatus] = useState<AuthStatus>();
  const [loadError, setLoadError] = useState("");
  const [accountOpen, setAccountOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const accountPopover = useRef<HTMLElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    jsonRequest<AuthStatus>("/api/auth/status", { signal: controller.signal })
      .then(async (result) => {
        if (!result.authenticated || !result.user) {
          setStatus(result);
          return;
        }
        try {
          const context = await jsonRequest<{
            permissions: AccountPermission[];
          }>("/api/account-context", { signal: controller.signal });
          setStatus({ ...result, permissions: context.permissions });
        } catch {
          // 权限读取失败不阻塞画布；管理员仍按角色兜底显示全部入口。
          setStatus(result);
        }
      })
      .catch((caught) => {
        if (!controller.signal.aborted) {
          setLoadError(
            caught instanceof Error ? caught.message : "登录状态读取失败",
          );
        }
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!accountOpen) return;
    const closeAccount = (event: KeyboardEvent | MouseEvent) => {
      if (event instanceof KeyboardEvent) {
        if (event.key !== "Escape") return;
      } else {
        const target = event.target as Element | null;
        if (
          accountPopover.current?.contains(target) ||
          target?.closest('[data-testid="user-avatar"]')
        ) {
          return;
        }
      }
      setAccountOpen(false);
      if (event instanceof KeyboardEvent) {
        window.requestAnimationFrame(() => {
          (
            document.querySelector(
              '[data-testid="user-avatar"]',
            ) as HTMLButtonElement | null
          )?.focus();
        });
      }
    };
    window.addEventListener("keydown", closeAccount);
    window.addEventListener("mousedown", closeAccount, true);
    return () => {
      window.removeEventListener("keydown", closeAccount);
      window.removeEventListener("mousedown", closeAccount, true);
    };
  }, [accountOpen]);

  if (loadError) {
    return <main className="system-message" role="alert">{loadError}</main>;
  }
  if (!status) {
    return <main className="system-message">正在读取账号状态…</main>;
  }
  if (status.bootstrapRequired) {
    return (
      <AccountForm
        bootstrap
        onSuccess={(user) => {
          setStatus({ authenticated: true, bootstrapRequired: false, user });
          window.location.replace("/canvas/projects");
        }}
      />
    );
  }
  if (!status.authenticated || !status.user) {
    return (
      <AccountForm
        bootstrap={false}
        onSuccess={(user) => {
          setStatus({ authenticated: true, bootstrapRequired: false, user });
          window.location.replace("/canvas/projects");
        }}
      />
    );
  }
  const pathname = window.location.pathname;
  const fromCurrentCanvas = (path: string) =>
    pathWithCurrentCanvasSource(
      path,
      status.user!.id,
      window.location.search,
      projectId,
    );
  const currentGroupRunScope = createGroupRunSummaryScope(
    status.user.id,
    projectId ?? fixtureId ?? "default",
    fixtureId ?? "",
  );
  const navigateFromCurrentCanvas = (path: string) => {
    if (!confirmGroupRunNavigation(currentGroupRunScope)) return;
    window.location.href = fromCurrentCanvas(path);
  };
  if (pathname === "/admin/accounts") {
    return (
      <AdminRouteGuard
        allowed={hasClientPermission(
          status.permissions,
          "manage_accounts",
          status.user.role,
        )}
      >
        <AdminAccounts currentUser={status.user} />
      </AdminRouteGuard>
    );
  }
  if (pathname === "/admin/models") {
    return (
      <AdminRouteGuard
        allowed={hasClientPermission(
          status.permissions,
          "manage_models",
          status.user.role,
        )}
      >
        <AdminModels currentUser={status.user} />
      </AdminRouteGuard>
    );
  }
  const modelContractRoute = pathname.match(
    /^\/admin\/models\/([a-z0-9-]{3,80})\/contract$/i,
  );
  if (modelContractRoute) {
    return (
      <AdminRouteGuard
        allowed={hasClientPermission(
          status.permissions,
          "manage_models",
          status.user.role,
        )}
      >
        <AdminModelContractWorkbench
          currentUser={status.user}
          modelId={modelContractRoute[1]}
        />
      </AdminRouteGuard>
    );
  }
  if (pathname === "/admin/providers") {
    return (
      <AdminRouteGuard
        allowed={hasClientPermission(
          status.permissions,
          "manage_providers",
          status.user.role,
        )}
      >
        <AdminProviders currentUser={status.user} />
      </AdminRouteGuard>
    );
  }
  if (pathname === "/admin/storage") {
    return (
      <AdminRouteGuard
        allowed={hasClientPermission(
          status.permissions,
          "manage_storage",
          status.user.role,
        )}
      >
        <AdminStorage currentUser={status.user} />
      </AdminRouteGuard>
    );
  }
  if (pathname === "/admin/generation-safety") {
    return (
      <AdminRouteGuard
        allowed={hasClientPermission(
          status.permissions,
          "manage_generation_safety",
          status.user.role,
        )}
      >
        <AdminGenerationSafety currentUser={status.user} />
      </AdminRouteGuard>
    );
  }
  if (pathname === "/admin/generation-recovery") {
    return (
      <AdminRouteGuard
        allowed={hasClientPermission(
          status.permissions,
          "manage_generation_recovery",
          status.user.role,
        )}
      >
        <GenerationRecoveryPage currentUser={status.user} />
      </AdminRouteGuard>
    );
  }
  if (pathname === "/admin/api-contract") {
    return (
      <AdminRouteGuard
        allowed={hasClientPermission(
          status.permissions,
          "manage_accounts",
          status.user.role,
        )}
      >
        <AdminApiContract currentUser={status.user} />
      </AdminRouteGuard>
    );
  }
  if (pathname === "/admin/templates") {
    return (
      <AdminRouteGuard
        allowed={hasClientPermission(
          status.permissions,
          "manage_public_templates",
          status.user.role,
        )}
      >
        <AdminTemplatesPage currentUser={status.user} />
      </AdminRouteGuard>
    );
  }
  if (pathname === "/connections") {
    return <MyConnectionsPage currentUser={status.user} />;
  }

  return (
    <>
      <CanvasApplication
        accountOpen={accountOpen}
        fixtureId={fixtureId}
        onAccountOpenChange={setAccountOpen}
        permissions={status.permissions}
        projectId={projectId}
        role={status.user.role}
        userId={status.user.id}
        userInitial={status.user.displayName.trim().charAt(0).toLocaleUpperCase() || "M"}
        workspace={workspace || pathname === "/"}
      />
      {accountOpen && (
        <aside
          className="account-popover"
          data-testid="account-popover"
          ref={accountPopover}
        >
          <strong>{status.user.displayName}</strong>
          <span>@{status.user.loginName}</span>
          <button
            onClick={() => {
              navigateFromCurrentCanvas("/canvas/projects");
            }}
            type="button"
          >
            工作空间
          </button>
          <button
            onClick={() => {
              navigateFromCurrentCanvas("/connections");
            }}
            type="button"
          >
            我的连接
          </button>
          {hasClientPermission(
            status.permissions,
            "manage_models",
            status.user.role,
          ) && (
              <button
                onClick={() => {
                  navigateFromCurrentCanvas("/admin/models");
                }}
                type="button"
              >
                模型中心
              </button>
          )}
          {hasClientPermission(
            status.permissions,
            "manage_providers",
            status.user.role,
          ) && (
              <button
                onClick={() => {
                  navigateFromCurrentCanvas("/admin/providers");
                }}
                type="button"
              >
                平台连接
              </button>
          )}
          {hasClientPermission(
            status.permissions,
            "manage_accounts",
            status.user.role,
          ) && (
              <button
                onClick={() => {
                  navigateFromCurrentCanvas("/admin/accounts");
                }}
                type="button"
              >
                账号管理
              </button>
          )}
          {hasClientPermission(
            status.permissions,
            "manage_storage",
            status.user.role,
          ) && (
              <button
                onClick={() => {
                  navigateFromCurrentCanvas("/admin/storage");
                }}
                type="button"
              >
                存储中心
              </button>
          )}
          {hasClientPermission(
            status.permissions,
            "manage_generation_safety",
            status.user.role,
          ) && (
              <button
                onClick={() => {
                  navigateFromCurrentCanvas("/admin/generation-safety");
                }}
                type="button"
              >
                生成安全
              </button>
          )}
          {hasClientPermission(
            status.permissions,
            "manage_generation_recovery",
            status.user.role,
          ) && (
              <button
                onClick={() => {
                  navigateFromCurrentCanvas("/admin/generation-recovery");
                }}
                type="button"
              >
                生成维护
              </button>
          )}
          {hasClientPermission(
            status.permissions,
            "manage_public_templates",
            status.user.role,
          ) && (
              <button
                onClick={() => {
                  navigateFromCurrentCanvas("/admin/templates");
                }}
                type="button"
              >
                公共模板管理
              </button>
          )}
          <button
            onClick={() => {
              setAccountOpen(false);
              setPasswordOpen(true);
            }}
            type="button"
          >
            修改密码
          </button>
          <button
            onClick={() => {
              if (!confirmGroupRunNavigation(currentGroupRunScope)) return;
              void jsonRequest("/api/auth/logout", { method: "POST" }).then(() =>
                setStatus({
                  authenticated: false,
                  bootstrapRequired: false,
                }),
              );
            }}
            type="button"
          >
            退出登录
          </button>
        </aside>
      )}
      {passwordOpen && (
        <ChangeOwnPasswordDialog onClose={() => setPasswordOpen(false)} />
      )}
    </>
  );
}

function navigateToProjectWorkspace() {
  window.location.href = "/canvas/projects";
}

function CanvasApplication({
  accountOpen,
  fixtureId,
  onAccountOpenChange,
  permissions,
  projectId,
  role,
  userId,
  userInitial,
  workspace,
}: {
  accountOpen: boolean;
  fixtureId?: string;
  onAccountOpenChange: (open: boolean) => void;
  permissions?: AccountPermission[];
  projectId?: string;
  role?: AuthUser["role"];
  userId?: string;
  userInitial: string;
  workspace?: boolean;
}) {
  return (
    <Suspense
      fallback={(
        <main className="system-message" role="status">
          正在加载工作区…
        </main>
      )}
    >
      {workspace ? (
        <WorkspacePage userId={userId} />
      ) : (
        <ModelCatalogProvider>
          <CanvasShell
            accountOpen={accountOpen}
            fixtureId={fixtureId}
            onAccountOpenChange={onAccountOpenChange}
            onProjectMissing={navigateToProjectWorkspace}
            permissions={permissions}
            projectId={projectId}
            role={role}
            userId={userId}
            userInitial={userInitial}
          />
        </ModelCatalogProvider>
      )}
    </Suspense>
  );
}

export function App() {
  const [fixtureState, setFixtureState] = useState<FixtureState>(() =>
    fixtureMatch
      ? fixtureRouteId
        ? { state: "loading", id: fixtureRouteId }
        : { state: "error", message: "Fixture route is invalid" }
      : { state: "idle" },
  );

  useEffect(() => {
    if (!fixtureRouteId || !import.meta.env.DEV) {
      return;
    }

    const id = fixtureRouteId;
    const controller = new AbortController();

    fetch(`/__fixture-api/${encodeURIComponent(id)}`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Fixture request failed: ${response.status}`);
        }
        return (await response.json()) as { fixture: Fixture };
      })
      .then(({ fixture }) => {
        if (
          ![
            "canvas",
            "shell",
            "interaction",
            "node",
            "workflow",
            "geometry-catalog",
            "menu",
            "modal",
            "overlay",
            "panel",
            "persistence",
            "popover",
          ].includes(
            fixture.kind,
          )
        ) {
          throw new Error(`Fixture kind is not supported yet: ${fixture.kind}`);
        }
        setFixtureState({ state: "ready", fixture });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setFixtureState({
            state: "error",
            message: error instanceof Error ? error.message : "Fixture load failed",
          });
        }
      });

    return () => controller.abort();
  }, []);

  if ((fixtureMatch || responsivePreviewMatch) && !import.meta.env.DEV) {
    return (
      <main className="system-message" data-testid="fixture-unavailable">
        Fixture routes are unavailable in production.
      </main>
    );
  }

  if (responsivePreviewMatch) {
    const [width, height] = responsivePreviewMatch[1]
      .split("x")
      .map(Number);
    return <ResponsivePreview height={height} width={width} />;
  }

  if (fixtureState.state === "loading") {
    return <main className="system-message">Loading fixture…</main>;
  }

  if (fixtureState.state === "error") {
    return (
      <main className="system-message" role="alert">
        {fixtureState.message}
      </main>
    );
  }

  if (fixtureState.state === "ready") {
    return <AuthenticatedApplication fixtureId={fixtureState.fixture.id} />;
  }

  if (projectWorkspaceMatch) {
    return <AuthenticatedApplication workspace />;
  }
  if (projectCanvasMatch) {
    if (!projectCanvasId) {
      return (
        <main className="system-message" role="alert">
          Project route is invalid.
        </main>
      );
    }
    return (
      <AuthenticatedApplication
        projectId={projectCanvasId}
      />
    );
  }

  return <AuthenticatedApplication />;
}

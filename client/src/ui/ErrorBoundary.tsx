import { Component, type ErrorInfo, type ReactNode } from "react";

type ErrorBoundaryProps = Readonly<{
  children: ReactNode;
  fallback: (reset: () => void, error: unknown) => ReactNode;
  label?: string;
}>;

type ErrorBoundaryState = Readonly<{ error: unknown; failed: boolean }>;

/**
 * Catches render errors below it so one broken component shows a small
 * recovery message instead of blanking the whole page.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: undefined, failed: false };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error, failed: true };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error(`[ErrorBoundary${this.props.label ? `:${this.props.label}` : ""}]`, error, info.componentStack);
  }

  readonly reset = () => {
    this.setState({ error: undefined, failed: false });
  };

  override render() {
    if (this.state.failed) return this.props.fallback(this.reset, this.state.error);
    return this.props.children;
  }
}

export function AppErrorFallback() {
  return (
    <div className="app-error-boundary" data-testid="app-error-boundary" role="alert">
      <strong>页面出错了，点击刷新</strong>
      <p>刷新后会重新加载已保存的内容。</p>
      <button type="button" onClick={() => window.location.reload()}>
        刷新页面
      </button>
    </div>
  );
}

export function NodeErrorFallback({ nodeId, reset }: Readonly<{ nodeId: string; reset: () => void }>) {
  return (
    <div className="node-error-boundary" data-testid={`node-error-boundary-${nodeId}`}>
      <span>这个节点显示出错，点击重试</span>
      <button className="nodrag" type="button" onClick={reset}>
        重试
      </button>
    </div>
  );
}

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { exportGraphJSON } from '../persistence/exportImport';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  error: Error | null;
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default class AppErrorBoundary extends Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    useUiStore.getState().setLastError({
      message: messageFor(error),
      stack: [error.stack, info.componentStack].filter(Boolean).join('\n'),
      at: Date.now(),
    });
  }

  render() {
    if (!this.state.error) return this.props.children;
    const hasGraph = useGraphStore.getState().nodes.length > 0;

    return (
      <div className="app-root app-error-shell">
        <section className="app-error-panel glass-panel" role="alert">
          <p className="app-error-panel__eyebrow">Application Error</p>
          <h1 className="app-error-panel__title">Document Graph Explorer stopped rendering.</h1>
          <p className="app-error-panel__message">{messageFor(this.state.error)}</p>
          <div className="app-error-panel__actions">
            <button
              type="button"
              className="btn-pill"
              onClick={() => window.location.reload()}
            >
              Reload
            </button>
            <button
              type="button"
              className="btn-pill secondary"
              disabled={!hasGraph}
              title={
                hasGraph
                  ? 'Export the current graph before reloading'
                  : 'No graph is loaded to export'
              }
              onClick={() => {
                void exportGraphJSON();
              }}
            >
              Export your graph (JSON)
            </button>
          </div>
        </section>
      </div>
    );
  }
}

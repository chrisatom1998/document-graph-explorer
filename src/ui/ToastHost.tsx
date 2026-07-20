/**
 * Global toast stack — the single place error/warning feedback surfaces to
 * the user instead of vanishing into console.warn (spec: nothing that fails
 * should fail silently). Mounted once at the app root; any module pushes via
 * useUiStore.getState().pushToast(message, kind).
 */
import { useEffect } from 'react';
import { useUiStore } from '../store/uiStore';
import type { Toast } from '../store/uiStore';

const AUTO_DISMISS_MS: Record<Toast['kind'], number> = {
  error: 9000,
  warning: 7000,
  info: 5000,
};

function ToastRow({ toast }: { toast: Toast }) {
  const dismissToast = useUiStore((s) => s.dismissToast);

  useEffect(() => {
    // Actionable toasts (e.g. "Switch to 2D") persist until dismissed or acted
    // on — auto-hiding a suggestion the user might want to click is worse than
    // leaving it up. Plain notifications still auto-dismiss.
    if (toast.action) return;
    const t = setTimeout(() => dismissToast(toast.id), AUTO_DISMISS_MS[toast.kind]);
    return () => clearTimeout(t);
  }, [toast.id, toast.kind, toast.action, dismissToast]);

  return (
    // No role="alert" here: this row is inserted into the aria-live="polite"
    // container below, which already announces it. Nesting an assertive region
    // inside a polite one makes screen readers announce twice or race.
    <div className={`toast toast--${toast.kind} glass-panel`}>
      <span className="toast__text">{toast.message}</span>
      {toast.action && (
        <button
          type="button"
          className="toast__action btn-pill secondary"
          onClick={() => {
            toast.action?.run();
            dismissToast(toast.id);
          }}
        >
          {toast.action.label}
        </button>
      )}
      <button
        type="button"
        className="icon-btn-close"
        title="Dismiss"
        aria-label="Dismiss notification"
        onClick={() => dismissToast(toast.id)}
      >
        ✕
      </button>
    </div>
  );
}

export default function ToastHost() {
  const toasts = useUiStore((s) => s.toasts);
  return (
    <div className="toast-host" aria-live="polite" aria-atomic="false">
      {toasts.map((t) => (
        <ToastRow key={t.id} toast={t} />
      ))}
    </div>
  );
}

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
    const t = setTimeout(() => dismissToast(toast.id), AUTO_DISMISS_MS[toast.kind]);
    return () => clearTimeout(t);
  }, [toast.id, toast.kind, dismissToast]);

  return (
    <div className={`toast toast--${toast.kind} glass-panel`} role="alert">
      <span className="toast__text">{toast.message}</span>
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
  if (toasts.length === 0) return null;

  return (
    <div className="toast-host" aria-live="polite">
      {toasts.map((t) => (
        <ToastRow key={t.id} toast={t} />
      ))}
    </div>
  );
}

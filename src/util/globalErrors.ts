import { useUiStore } from '../store/uiStore';

const DEDUPE_MS = 5_000;

let lastKey = '';
let lastAt = 0;
let activeCleanup: (() => void) | null = null;

function detailsFrom(value: unknown): { message: string; stack?: string } {
  if (value instanceof Error) {
    return { message: value.message || value.name, stack: value.stack };
  }
  if (typeof value === 'string') return { message: value };
  try {
    return { message: JSON.stringify(value) };
  } catch {
    return { message: String(value) };
  }
}

export function recordGlobalError(value: unknown): void {
  const { message, stack } = detailsFrom(value);
  const key = `${message}\n${stack ?? ''}`;
  const now = Date.now();
  if (key === lastKey && now - lastAt < DEDUPE_MS) return;
  lastKey = key;
  lastAt = now;
  useUiStore.getState().setLastError({ message, stack, at: now });
  useUiStore.getState().pushToast(`Application error: ${message}`, 'error');
}

export function installGlobalErrorHandlers(): () => void {
  if (typeof window === 'undefined') return () => {};
  if (activeCleanup) return activeCleanup;

  const onError = (event: ErrorEvent) => {
    recordGlobalError(event.error ?? event.message);
  };
  const onUnhandledRejection = (event: PromiseRejectionEvent) => {
    recordGlobalError(event.reason);
  };

  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onUnhandledRejection);
  activeCleanup = () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onUnhandledRejection);
    activeCleanup = null;
  };
  return activeCleanup;
}

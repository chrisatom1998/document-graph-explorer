// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installGlobalErrorHandlers, recordGlobalError } from './globalErrors';
import { useUiStore } from '../store/uiStore';

describe('global error handling', () => {
  let cleanup: (() => void) | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-06T12:00:00Z'));
    useUiStore.setState({ lastError: null, toasts: [] });
  });

  afterEach(() => {
    cleanup?.();
    cleanup = null;
    vi.useRealTimers();
  });

  it('records window error events and surfaces an error toast', () => {
    cleanup = installGlobalErrorHandlers();

    window.dispatchEvent(
      new ErrorEvent('error', {
        message: 'boom',
        error: new Error('boom'),
      }),
    );

    expect(useUiStore.getState().lastError?.message).toBe('boom');
    expect(useUiStore.getState().toasts.at(-1)).toMatchObject({
      kind: 'error',
      message: 'Application error: boom',
    });
  });

  it('records unhandled promise rejections', () => {
    cleanup = installGlobalErrorHandlers();
    const event = new Event('unhandledrejection') as PromiseRejectionEvent;
    Object.defineProperty(event, 'reason', { value: new Error('async failed') });

    window.dispatchEvent(event);

    expect(useUiStore.getState().lastError?.message).toBe('async failed');
  });

  it('dedupes repeated errors inside the cooldown window', () => {
    recordGlobalError('same failure');
    recordGlobalError('same failure');
    expect(useUiStore.getState().toasts).toHaveLength(1);

    vi.advanceTimersByTime(5_001);
    recordGlobalError('same failure');

    expect(useUiStore.getState().toasts).toHaveLength(2);
  });
});

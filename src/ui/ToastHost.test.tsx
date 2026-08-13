// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useUiStore } from '../store/uiStore';
import ToastHost from './ToastHost';

describe('ToastHost', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useUiStore.setState({ toasts: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
    useUiStore.setState({ toasts: [] });
  });

  it('renders an empty polite aria-live container when there are no toasts', () => {
    const { container } = render(<ToastHost />);
    const host = container.querySelector('.toast-host');
    expect(host).toBeInTheDocument();
    expect(host).toHaveAttribute('aria-live', 'polite');
    expect(host?.children).toHaveLength(0);
  });

  it('renders toast items with appropriate text, kinds, and CSS classes', () => {
    useUiStore.setState({
      toasts: [
        { id: 1, message: 'Operation succeeded', kind: 'info' },
        { id: 2, message: 'Memory running low', kind: 'warning' },
        { id: 3, message: 'Failed to process file', kind: 'error' },
      ],
    });

    render(<ToastHost />);

    expect(screen.getByText('Operation succeeded')).toBeInTheDocument();
    expect(screen.getByText('Memory running low')).toBeInTheDocument();
    expect(screen.getByText('Failed to process file')).toBeInTheDocument();

    const toastEls = screen.getAllByText(/Operation|Memory|Failed/).map((el) => el.closest('.toast'));
    expect(toastEls[0]).toHaveClass('toast--info');
    expect(toastEls[1]).toHaveClass('toast--warning');
    expect(toastEls[2]).toHaveClass('toast--error');
  });

  it('auto-dismisses info toasts after 5000ms', () => {
    useUiStore.getState().pushToast('Info message', 'info');
    render(<ToastHost />);

    expect(screen.getByText('Info message')).toBeInTheDocument();

    vi.advanceTimersByTime(4999);
    expect(useUiStore.getState().toasts).toHaveLength(1);

    vi.advanceTimersByTime(1);
    expect(useUiStore.getState().toasts).toHaveLength(0);
  });

  it('auto-dismisses warning toasts after 7000ms', () => {
    useUiStore.getState().pushToast('Warning message', 'warning');
    render(<ToastHost />);

    vi.advanceTimersByTime(6999);
    expect(useUiStore.getState().toasts).toHaveLength(1);

    vi.advanceTimersByTime(1);
    expect(useUiStore.getState().toasts).toHaveLength(0);
  });

  it('auto-dismisses error toasts after 9000ms', () => {
    useUiStore.getState().pushToast('Error message', 'error');
    render(<ToastHost />);

    vi.advanceTimersByTime(8999);
    expect(useUiStore.getState().toasts).toHaveLength(1);

    vi.advanceTimersByTime(1);
    expect(useUiStore.getState().toasts).toHaveLength(0);
  });

  it('does NOT auto-dismiss toasts that have an action attached', () => {
    const handleAction = vi.fn();
    useUiStore.getState().pushToast('Actionable toast', 'warning', {
      label: 'Switch to 2D',
      run: handleAction,
    });

    render(<ToastHost />);

    expect(screen.getByText('Actionable toast')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Switch to 2D' })).toBeInTheDocument();

    vi.advanceTimersByTime(15000);
    expect(useUiStore.getState().toasts).toHaveLength(1);
    expect(screen.getByText('Actionable toast')).toBeInTheDocument();
  });

  it('dismisses toast when the dismiss button is clicked', () => {
    useUiStore.getState().pushToast('Dismissable notification', 'info');
    render(<ToastHost />);

    const closeBtn = screen.getByRole('button', { name: 'Dismiss notification' });
    fireEvent.click(closeBtn);

    expect(useUiStore.getState().toasts).toHaveLength(0);
    expect(screen.queryByText('Dismissable notification')).not.toBeInTheDocument();
  });

  it('executes action callback and dismisses toast when action button is clicked', () => {
    const handleRun = vi.fn();
    useUiStore.getState().pushToast('Perform action', 'info', {
      label: 'Fix issue',
      run: handleRun,
    });

    render(<ToastHost />);

    const actionBtn = screen.getByRole('button', { name: 'Fix issue' });
    fireEvent.click(actionBtn);

    expect(handleRun).toHaveBeenCalledTimes(1);
    expect(useUiStore.getState().toasts).toHaveLength(0);
    expect(screen.queryByText('Perform action')).not.toBeInTheDocument();
  });
});

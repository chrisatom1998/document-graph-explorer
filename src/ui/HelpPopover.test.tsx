// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { EDGE_KIND_LABEL } from '../scene/palette';
import { useUiStore } from '../store/uiStore';
import { FIRST_RUN_GUIDE_REOPEN_EVENT } from './FirstRunGuide';
import HelpPopover from './HelpPopover';

describe('HelpPopover', () => {
  beforeEach(() => useUiStore.setState({ helpOpen: true, dims: 3, flatEdgeDetail: 'balanced' }));
  afterEach(() => {
    cleanup();
    useUiStore.setState({ helpOpen: false });
    vi.restoreAllMocks();
  });

  it('shows every connection type and can launch the guided tour', () => {
    const listener = vi.fn();
    window.addEventListener(FIRST_RUN_GUIDE_REOPEN_EVENT, listener);
    render(<HelpPopover />);

    for (const label of Object.values(EDGE_KIND_LABEL)) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText(/opens two readers side by side/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Start guided tour' }));
    expect(listener).toHaveBeenCalledOnce();
    expect(useUiStore.getState().helpOpen).toBe(false);
    window.removeEventListener(FIRST_RUN_GUIDE_REOPEN_EVENT, listener);
  });

  it('describes the active 2D marks and progressive link detail', () => {
    useUiStore.setState({ dims: 2 });
    render(<HelpPopover />);

    expect(screen.getByText('Dot')).toBeInTheDocument();
    expect(screen.getByText(/Link detail is balanced/i)).toBeInTheDocument();
    expect(screen.queryByText('Sphere')).not.toBeInTheDocument();
  });
});

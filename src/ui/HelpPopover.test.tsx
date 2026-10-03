// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { EDGE_KIND_LABEL } from '../scene/palette';
import { useUiStore } from '../store/uiStore';
import HelpPopover from './HelpPopover';

describe('HelpPopover', () => {
  beforeEach(() => useUiStore.setState({ helpOpen: true, dims: 3, flatEdgeDetail: 'balanced' }));
  afterEach(() => {
    cleanup();
    useUiStore.setState({ helpOpen: false });
    vi.restoreAllMocks();
  });

  it('shows connection types and plain navigation help', () => {
    render(<HelpPopover />);

    for (const label of Object.values(EDGE_KIND_LABEL)) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText(/opens two readers side by side/i)).toBeInTheDocument();

    expect(screen.getByText(/Select a node to see its details/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Close help' }));
    expect(useUiStore.getState().helpOpen).toBe(false);
  });

  it('describes the active 2D marks and progressive link detail', () => {
    useUiStore.setState({ dims: 2 });
    render(<HelpPopover />);

    expect(screen.getByText('Dot')).toBeInTheDocument();
    expect(screen.getByText(/Link detail is balanced/i)).toBeInTheDocument();
    expect(screen.queryByText('Sphere')).not.toBeInTheDocument();
  });
});

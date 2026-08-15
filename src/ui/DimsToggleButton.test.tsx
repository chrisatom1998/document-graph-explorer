// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { switchGraphDimensions } from '../scene/dimensionTransition';
import { useUiStore } from '../store/uiStore';
import IngestDimsToggle, { DimsToggleButton } from './DimsToggleButton';

vi.mock('../scene/dimensionTransition', () => ({
  switchGraphDimensions: vi.fn(),
}));

describe('DimsToggleButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(switchGraphDimensions).mockImplementation((dims) => {
      useUiStore.getState().setDims(dims);
    });
    useUiStore.setState({ dims: 3 });
  });

  afterEach(() => {
    cleanup();
    localStorage.removeItem('knowledge-nebula-dims');
  });

  it('toggles between 2D and 3D with a fit after the layout settles', () => {
    render(<DimsToggleButton />);

    const button = screen.getByRole('button', { name: 'Switch to 2D view' });
    expect(button).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(button);
    expect(switchGraphDimensions).toHaveBeenLastCalledWith(2, { fitAfterSettle: true });

    const back = screen.getByRole('button', { name: 'Switch to 3D view' });
    expect(back).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(back);
    expect(switchGraphDimensions).toHaveBeenLastCalledWith(3, { fitAfterSettle: true });
  });

  it('renders the ingest-time floating variant with the same accessible control', () => {
    render(<IngestDimsToggle />);

    expect(screen.getByRole('button', { name: 'Switch to 2D view' })).toBeInTheDocument();
  });
});

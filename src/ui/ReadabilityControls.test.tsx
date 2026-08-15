// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_FILTER, useUiStore } from '../store/uiStore';
import ReadabilityControls from './ReadabilityControls';
import { READABILITY_PRESETS } from './graphReadability';

describe('ReadabilityControls', () => {
  afterEach(() => {
    cleanup();
    useUiStore.setState({
      filter: { ...DEFAULT_FILTER },
      labelDensity: 1,
      clusterAtmosphere: 1,
    });
  });

  it('applies always-on presets and sliders', () => {
    render(<ReadabilityControls />);

    fireEvent.click(screen.getByRole('button', { name: 'Quiet' }));
    expect(useUiStore.getState().filter.minEdgeWeight).toBe(READABILITY_PRESETS.quiet.minEdgeWeight);
    expect(useUiStore.getState().labelDensity).toBe(READABILITY_PRESETS.quiet.labelDensity);
    expect(useUiStore.getState().clusterAtmosphere).toBe(READABILITY_PRESETS.quiet.clusterAtmosphere);

    fireEvent.change(screen.getByLabelText('Label density'), { target: { value: '0.4' } });
    fireEvent.change(screen.getByLabelText('Cluster hull opacity'), { target: { value: '0.2' } });
    expect(useUiStore.getState().labelDensity).toBe(0.4);
    expect(useUiStore.getState().clusterAtmosphere).toBe(0.2);
  });
});

import { describe, expect, it, vi } from 'vitest';

// The real bridge spawns the layout Worker on first use — unavailable (and
// unwanted) in unit tests.
vi.mock('../layout/layoutBridge', () => ({ layoutSetDims: vi.fn() }));

import { layoutSetDims } from '../layout/layoutBridge';
import type { SavedViewRecord } from '../persistence/db';
import { applySavedView, nextViewName } from './savedViews';
import { useUiStore } from '../store/uiStore';

function view(overrides: Partial<SavedViewRecord> = {}): SavedViewRecord {
  return {
    id: 'v1',
    name: 'View 1',
    createdAt: 1,
    pose: { px: 10, py: 20, pz: 30, tx: 1, ty: 2, tz: 3 },
    dims: 2,
    filter: { fileTypes: ['md'], clusters: [4], minDegree: 2, minEdgeWeight: 0.5 },
    ...overrides,
  };
}

describe('nextViewName', () => {
  it('numbers from the current count and skips taken names', () => {
    expect(nextViewName([])).toBe('View 1');
    expect(nextViewName([view({ name: 'View 1' })])).toBe('View 2');
    expect(nextViewName([view({ name: 'View 2' }), view({ name: 'View 3' })])).toBe('View 4');
  });
});

describe('applySavedView', () => {
  it('restores dims and filter and issues a pose camera command', () => {
    useUiStore.setState({
      dims: 3,
      filter: { fileTypes: null, clusters: null, minDegree: 0, minEdgeWeight: 0, edgeKinds: null, modifiedWithinDays: null },
      cameraCommand: null,
    });

    applySavedView(view());

    const state = useUiStore.getState();
    expect(state.dims).toBe(2);
    expect(layoutSetDims).toHaveBeenCalledWith(2); // moves the layout worker to planar mode too
    expect(state.filter).toEqual({
      fileTypes: ['md'],
      clusters: [4],
      minDegree: 2,
      minEdgeWeight: 0.5,
      edgeKinds: null,
      modifiedWithinDays: null,
    });
    expect(state.cameraCommand?.kind).toBe('pose');
    expect(state.cameraCommand?.pose).toEqual({ px: 10, py: 20, pz: 30, tx: 1, ty: 2, tz: 3 });
  });
});

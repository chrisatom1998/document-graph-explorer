// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const bridge = vi.hoisted(() => ({
  epoch: 0,
  settled: 0,
  listeners: new Set<() => void>(),
  setDims: vi.fn(),
}));

vi.mock('../layout/layoutBridge', () => ({
  layoutEpoch: () => bridge.epoch,
  layoutSettledEpoch: () => bridge.settled,
  layoutSetDims: (dims: 2 | 3) => {
    bridge.epoch += 1;
    bridge.setDims(dims);
  },
  onLayoutSettled: (listener: () => void) => {
    bridge.listeners.add(listener);
    return () => bridge.listeners.delete(listener);
  },
}));

import { useUiStore } from '../store/uiStore';
import { switchGraphDimensions } from './dimensionTransition';

function settle(epoch: number): void {
  bridge.settled = epoch;
  for (const listener of [...bridge.listeners]) listener();
}

describe('switchGraphDimensions', () => {
  beforeEach(() => {
    bridge.epoch = 0;
    bridge.settled = 0;
    bridge.listeners.clear();
    bridge.setDims.mockClear();
    useUiStore.setState({ dims: 3, cameraCommand: null });
  });

  it('pairs store and worker state, then fits only after the matching settle', () => {
    switchGraphDimensions(2, { fitAfterSettle: true });
    expect(useUiStore.getState().dims).toBe(2);
    expect(bridge.setDims).toHaveBeenCalledWith(2);
    expect(useUiStore.getState().cameraCommand).toBeNull();

    settle(1);
    expect(useUiStore.getState().cameraCommand?.kind).toBe('fitAll');
    expect(bridge.listeners.size).toBe(0);
  });

  it('does not let an older rapid toggle move the camera in the newer mode', () => {
    switchGraphDimensions(2, { fitAfterSettle: true });
    switchGraphDimensions(3, { fitAfterSettle: true });
    settle(2);

    expect(useUiStore.getState().dims).toBe(3);
    expect(useUiStore.getState().cameraCommand?.kind).toBe('fitAll');
    expect(useUiStore.getState().cameraCommand?.nonce).toBe(1);
  });
});

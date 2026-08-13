import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CameraPose } from '../store/uiStore';
import { DEFAULT_FILTER, useUiStore } from '../store/uiStore';
import {
  idOfSlot,
  positionBuffer,
  resetPositionBuffer,
  scaleOfSlot,
  slotOfId,
} from '../scene/positionBuffer';

const layoutSetDims = vi.fn();
const settledListeners = new Set<() => void>();

vi.mock('../layout/layoutBridge', () => ({
  layoutSetDims: (...args: unknown[]) => layoutSetDims(...args),
  onLayoutSettled: (fn: () => void) => {
    settledListeners.add(fn);
    return () => settledListeners.delete(fn);
  },
}));

import {
  applySharedView,
  clearDeferredRemoteCameras,
  sanitizeSharedFilter,
  useCollabStore,
} from './store';

function seedNode(id: string, slot: number, pos: [number, number, number]): void {
  slotOfId.set(id, slot);
  idOfSlot[slot] = id;
  scaleOfSlot[slot] = 2;
  const needed = (slot + 1) * 3;
  if (positionBuffer.array.length < needed) {
    const next = new Float32Array(needed);
    next.set(positionBuffer.array);
    positionBuffer.array = next;
  }
  positionBuffer.array[slot * 3] = pos[0];
  positionBuffer.array[slot * 3 + 1] = pos[1];
  positionBuffer.array[slot * 3 + 2] = pos[2];
  positionBuffer.count = Math.max(positionBuffer.count, slot + 1);
}

describe('sanitizeSharedFilter', () => {
  it('copies only validated graph filter fields from shared state', () => {
    const remote = JSON.parse(
      '{"__proto__":{"polluted":true},"fileTypes":["md","pdf"],"clusters":[1,2],"minDegree":3,"minEdgeWeight":0.4,"edgeKinds":["semantic"],"modifiedWithinDays":30}',
    ) as unknown;

    expect(sanitizeSharedFilter(remote)).toEqual({
      fileTypes: ['md', 'pdf'],
      clusters: [1, 2],
      minDegree: 3,
      minEdgeWeight: 0.4,
      edgeKinds: ['semantic'],
      modifiedWithinDays: 30,
    });
    expect(Object.prototype).not.toHaveProperty('polluted');
  });

  it('omits malformed remote values instead of merging them into UI state', () => {
    expect(sanitizeSharedFilter({
      fileTypes: ['exe'],
      clusters: [1, 2.5],
      minDegree: -1,
      minEdgeWeight: 2,
      edgeKinds: ['unknown'],
      modifiedWithinDays: Number.NaN,
    })).toBeUndefined();
  });
});

describe('applySharedView', () => {
  const delivered: CameraPose[] = [];
  let realSendCameraPose: (pose: CameraPose) => void;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      return setTimeout(() => cb(performance.now()), 0) as unknown as number;
    });
    layoutSetDims.mockClear();
    settledListeners.clear();
    delivered.length = 0;
    resetPositionBuffer();
    clearDeferredRemoteCameras();
    realSendCameraPose = useUiStore.getState().sendCameraPose;
    useUiStore.setState({
      dims: 3,
      selectedId: null,
      topicNodesEnabled: false,
      clusterCollapsed: false,
      filter: { ...DEFAULT_FILTER },
      cameraCommand: null,
      sendCameraPose: (pose) => {
        delivered.push(pose);
      },
    });
    useCollabStore.setState({
      session: {
        doc: {
          destroy() {},
          transact(fn: () => void) {
            fn();
          },
        },
        view: {
          toJSON: () => ({}),
          set: vi.fn(),
        },
      } as never,
      followMode: true,
      lastRemoteView: null,
    });
  });

  afterEach(() => {
    clearDeferredRemoteCameras();
    useUiStore.setState({ sendCameraPose: realSendCameraPose });
    useCollabStore.setState({ session: null, followMode: false, lastRemoteView: null });
    resetPositionBuffer();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('does not call layoutSetDims when remote dims match the local value', () => {
    applySharedView({
      dims: 3,
      selectedId: null,
      topicNodesEnabled: false,
      clusterCollapsed: false,
      filter: { ...DEFAULT_FILTER },
      camera: { px: 0, py: 0, pz: 40, tx: 0, ty: 0, tz: 0 },
    });
    expect(layoutSetDims).not.toHaveBeenCalled();
  });

  it('calls layoutSetDims once when dims change and waits for layout settle before posing', () => {
    applySharedView({
      dims: 2,
      camera: { px: 1, py: 2, pz: 3, tx: 4, ty: 5, tz: 6 },
    });
    expect(layoutSetDims).toHaveBeenCalledTimes(1);
    expect(layoutSetDims).toHaveBeenCalledWith(2);
    expect(useUiStore.getState().dims).toBe(2);
    expect(delivered).toHaveLength(0);

    for (const listener of [...settledListeners]) listener();
    expect(delivered).toEqual([
      { px: 1, py: 2, pz: 3, tx: 4, ty: 5, tz: 6 },
    ]);
  });

  it('remaps the remote pose into the local selected-node frame', () => {
    seedNode('doc', 0, [100, 50, -20]);
    useUiStore.setState({ selectedId: 'doc' });

    applySharedView({
      dims: 3,
      selectedId: 'doc',
      camera: { px: 10, py: 0, pz: 40, tx: 10, ty: 0, tz: 0 },
      cameraAnchor: { id: 'doc', x: 10, y: 0, z: 0, radius: 2, count: 1 },
    });

    vi.runOnlyPendingTimers();
    expect(delivered).toEqual([
      {
        px: 100,
        py: 50,
        pz: 20,
        tx: 100,
        ty: 50,
        tz: -20,
      },
    ]);
  });

  it('skips a deferred follow pose after follow mode is turned off', () => {
    applySharedView({
      dims: 3,
      camera: { px: 0, py: 0, pz: 40, tx: 0, ty: 0, tz: 0 },
    });
    useCollabStore.getState().setFollowMode(false);
    vi.runOnlyPendingTimers();
    expect(delivered).toHaveLength(0);
  });
});

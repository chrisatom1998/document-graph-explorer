import { afterEach, describe, expect, it } from 'vitest';
import type { DocNode, Edge } from '../model/types';
import {
  idOfSlot,
  positionBuffer,
  resetPositionBuffer,
  scaleOfSlot,
  slotOfId,
} from '../scene/positionBuffer';
import { DEFAULT_FILTER } from '../store/uiStore';
import {
  computeCentroidAnchor,
  computeCollabCameraAnchor,
  parseCameraAnchor,
  remapCameraPose,
} from './viewFrame';

function seedLayout(entries: Array<{ id: string; slot: number; pos: [number, number, number]; scale?: number }>): void {
  resetPositionBuffer();
  let maxSlot = -1;
  for (const entry of entries) {
    maxSlot = Math.max(maxSlot, entry.slot);
  }
  const count = maxSlot + 1;
  const arr = new Float32Array(count * 3);
  for (const entry of entries) {
    slotOfId.set(entry.id, entry.slot);
    idOfSlot[entry.slot] = entry.id;
    scaleOfSlot[entry.slot] = entry.scale ?? 1.5;
    arr[entry.slot * 3] = entry.pos[0];
    arr[entry.slot * 3 + 1] = entry.pos[1];
    arr[entry.slot * 3 + 2] = entry.pos[2];
  }
  positionBuffer.array = arr;
  positionBuffer.count = count;
}

function doc(id: string, cluster = 0): DocNode {
  return {
    id,
    title: id,
    path: id,
    fileType: 'md',
    kind: 'document',
    cluster,
    degree: 1,
    status: 'ok',
    keywords: [],
    topics: [],
    entities: [],
    summary: '',
    wordCount: 10,
  };
}

afterEach(() => {
  resetPositionBuffer();
});

describe('parseCameraAnchor', () => {
  it('accepts a well-formed anchor and rejects malformed payloads', () => {
    expect(
      parseCameraAnchor({ id: 'n1', x: 1, y: 2, z: 3, radius: 4, count: 5 }),
    ).toEqual({ id: 'n1', x: 1, y: 2, z: 3, radius: 4, count: 5 });
    expect(parseCameraAnchor({ id: null, x: 0, y: 0, z: 0, radius: 1, count: 2 })).toEqual({
      id: null,
      x: 0,
      y: 0,
      z: 0,
      radius: 1,
      count: 2,
    });
    expect(parseCameraAnchor({ id: 'n1', x: 1, y: 2, z: 3, radius: -1, count: 1 })).toBeUndefined();
    expect(parseCameraAnchor({ x: 1, y: 2, z: 3, radius: 1, count: 1 })).toBeUndefined();
  });
});

describe('remapCameraPose', () => {
  it('translates a remote pose so the remote target on a remote node lands on the local node', () => {
    const remoteAnchor = { id: 'doc', x: 10, y: 0, z: 0, radius: 1, count: 1 };
    const localAnchor = { id: 'doc', x: 100, y: 50, z: -20, radius: 1, count: 1 };
    const remotePose = {
      px: 10,
      py: 0,
      pz: 40,
      tx: 10,
      ty: 0,
      tz: 0,
    };
    expect(remapCameraPose(remotePose, remoteAnchor, localAnchor)).toEqual({
      px: 100,
      py: 50,
      pz: 20,
      tx: 100,
      ty: 50,
      tz: -20,
    });
  });

  it('scales offsets about the local anchor when radii differ', () => {
    const remoteAnchor = { id: null, x: 0, y: 0, z: 0, radius: 10, count: 4 };
    const localAnchor = { id: null, x: 0, y: 0, z: 0, radius: 20, count: 4 };
    const remotePose = {
      px: 0,
      py: 0,
      pz: 30,
      tx: 5,
      ty: 0,
      tz: 0,
    };
    expect(remapCameraPose(remotePose, remoteAnchor, localAnchor)).toEqual({
      px: 0,
      py: 0,
      pz: 60,
      tx: 10,
      ty: 0,
      tz: 0,
    });
  });

  it('refuses to remap when selected-id and centroid anchors are mixed', () => {
    const remoteAnchor = { id: 'missing', x: 10, y: 0, z: 0, radius: 2, count: 1 };
    const localAnchor = { id: null, x: 50, y: 50, z: 0, radius: 100, count: 10 };
    const remotePose = { px: 10, py: 0, pz: 40, tx: 10, ty: 0, tz: 0 };
    expect(remapCameraPose(remotePose, remoteAnchor, localAnchor)).toEqual(remotePose);
  });
});

describe('computeCollabCameraAnchor', () => {
  it('prefers the selected node over the graph centroid', () => {
    seedLayout([
      { id: 'a', slot: 0, pos: [0, 0, 0] },
      { id: 'b', slot: 1, pos: [10, 0, 0], scale: 2.5 },
    ]);
    const anchor = computeCollabCameraAnchor({
      selectedId: 'b',
      filter: { ...DEFAULT_FILTER },
      nodes: [doc('a'), doc('b')],
      edges: [],
    });
    expect(anchor).toEqual({
      id: 'b',
      x: 10,
      y: 0,
      z: 0,
      radius: 2.5,
      count: 1,
    });
  });

  it('falls back to the centroid of live slots when nothing is selected', () => {
    seedLayout([
      { id: 'a', slot: 0, pos: [0, 0, 0] },
      { id: 'b', slot: 1, pos: [4, 0, 0] },
    ]);
    const anchor = computeCentroidAnchor(null);
    expect(anchor).toMatchObject({
      id: null,
      x: 2,
      y: 0,
      z: 0,
      count: 2,
    });
    expect(anchor?.radius).toBeCloseTo(2, 5);
  });

  it('uses a preferred remote id when resolving the follower-side local frame', () => {
    seedLayout([
      { id: 'a', slot: 0, pos: [1, 2, 3] },
      { id: 'b', slot: 1, pos: [9, 9, 9] },
    ]);
    const anchor = computeCollabCameraAnchor({
      selectedId: null,
      preferId: 'a',
      filter: { ...DEFAULT_FILTER },
      nodes: [doc('a'), doc('b')],
      edges: [] as Edge[],
    });
    expect(anchor?.id).toBe('a');
    expect(anchor).toMatchObject({ x: 1, y: 2, z: 3 });
  });
});

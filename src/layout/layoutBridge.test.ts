import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { INITIAL_NODE_CAPACITY, MAX_NODES, NODE_CAPACITY_GROWTH } from '../config';
import { slotMeta, slotOfId } from '../scene/positionBuffer';
import { layoutAddNodes, layoutRemoveNodes, layoutReset } from './layoutBridge';

/** layoutAddNodes posts to the layout worker, which vitest's node environment
 * can't spawn — stub the global with an inert double. (The real worker
 * protocol is exercised headless by scripts/bench-layout.mjs.) */
class WorkerStub {
  onmessage: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage(): void {}
  terminate(): void {}
}

beforeAll(() => {
  vi.stubGlobal('Worker', WorkerStub);
});

beforeEach(() => {
  layoutReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  layoutReset();
  vi.restoreAllMocks();
});

function specs(count: number, start = 0): { id: string; cluster: number }[] {
  return Array.from({ length: count }, (_, i) => ({ id: `n${start + i}`, cluster: 0 }));
}

describe('layoutAddNodes capacity growth', () => {
  it('grows past the initial capacity instead of dropping', () => {
    expect(layoutAddNodes(specs(INITIAL_NODE_CAPACITY))).toEqual([]);
    expect(slotMeta.capacity).toBe(INITIAL_NODE_CAPACITY);

    // The 4097th node lands in a grown slot — with 1.5x headroom, not 1-by-1.
    const over = layoutAddNodes([{ id: 'over', cluster: 0, spawn: [3, 4, 5] }]);
    expect(over).toEqual([]);
    const slot = slotOfId.get('over');
    expect(slot).toBe(INITIAL_NODE_CAPACITY);
    expect(slotMeta.capacity).toBe(
      Math.min(Math.ceil((INITIAL_NODE_CAPACITY + 1) * NODE_CAPACITY_GROWTH), MAX_NODES),
    );
    // The fly-in origin write landed in the grown arrays, not silently off
    // the end of the old ones.
    expect(slotMeta.hasOrigin[slot!]).toBe(1);
    expect(slotMeta.origin[slot! * 3]).toBe(3);
    expect(slotMeta.origin[slot! * 3 + 1]).toBe(4);
    expect(slotMeta.origin[slot! * 3 + 2]).toBe(5);
  });

  it('preserves earlier slots across a growth step', () => {
    layoutAddNodes([{ id: 'first', cluster: 0, spawn: [1, 2, 3] }]);
    layoutAddNodes(specs(INITIAL_NODE_CAPACITY, 1)); // forces one grow
    expect(slotMeta.capacity).toBeGreaterThan(INITIAL_NODE_CAPACITY);
    expect(slotMeta.hasOrigin[0]).toBe(1);
    expect(slotMeta.origin[0]).toBe(1);
    expect(slotMeta.origin[1]).toBe(2);
    expect(slotMeta.origin[2]).toBe(3);
  });

  it('drops only at the MAX_NODES hard ceiling', () => {
    expect(layoutAddNodes(specs(MAX_NODES))).toEqual([]);
    expect(slotMeta.capacity).toBe(MAX_NODES);
    expect(slotOfId.size).toBe(MAX_NODES);

    const dropped = layoutAddNodes([
      { id: 'past-a', cluster: 0 },
      { id: 'past-b', cluster: 0 },
    ]);
    expect(dropped).toEqual(['past-a', 'past-b']);
    expect(slotOfId.has('past-a')).toBe(false);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining(`Node limit (${MAX_NODES})`),
    );
  });

  it('recycles freed slots at the ceiling instead of dropping', () => {
    layoutAddNodes(specs(MAX_NODES));
    layoutRemoveNodes(['n5']);
    const added = layoutAddNodes([{ id: 'replacement', cluster: 0 }]);
    expect(added).toEqual([]);
    expect(slotOfId.get('replacement')).toBe(5);
  });
});

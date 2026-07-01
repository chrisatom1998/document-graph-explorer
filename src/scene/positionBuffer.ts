/**
 * Per-frame layout positions, kept out of React entirely.
 * The layout worker posts a transferable Float32Array; the bridge points
 * `array` at it. Scene components read it inside useFrame.
 */

export const positionBuffer = {
  array: new Float32Array(0), // [slot*3 + i]
  count: 0, // active node count
  alpha: 1,
  version: 0, // bumped on every tick received
};

/** slot assignment is owned by layoutBridge; render uses these lookups */
export const slotOfId = new Map<string, number>();
export const idOfSlot: string[] = [];

/** per-slot visual scale (from degree), maintained by the Nodes component */
export const scaleOfSlot: number[] = [];

/** per-slot spawn timestamp for the materialize animation */
export const spawnAtOfSlot: number[] = [];

export function resetPositionBuffer(): void {
  positionBuffer.array = new Float32Array(0);
  positionBuffer.count = 0;
  positionBuffer.alpha = 1;
  positionBuffer.version = 0;
  slotOfId.clear();
  idOfSlot.length = 0;
  scaleOfSlot.length = 0;
  spawnAtOfSlot.length = 0;
}

export function getNodePosition(id: string): [number, number, number] | null {
  const slot = slotOfId.get(id);
  if (slot === undefined || slot * 3 + 2 >= positionBuffer.array.length) return null;
  const a = positionBuffer.array;
  return [a[slot * 3], a[slot * 3 + 1], a[slot * 3 + 2]];
}

import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as THREE from 'three';
const state = vi.hoisted(() => ({
  mesh: null as unknown,
  frame: null as unknown,
  ui: { selectedId: 'selected' as string | null, dims: 2 as 2 | 3, clusterCollapsed: false, highlightOwner: null },
}));
vi.mock('react', () => ({ useMemo: (factory: () => unknown) => factory(), useRef: () => ({ current: state.mesh }) }));
vi.mock('@react-three/fiber', () => ({ useFrame: (callback: unknown) => { state.frame = callback; } }));
vi.mock('../store/uiStore', () => ({ useUiStore: Object.assign((select: (ui: typeof state.ui) => unknown) => select(state.ui), { getState: () => state.ui }) }));
vi.mock('../util/motion', () => ({ prefersReducedMotion: () => false }));
import SelectionHalo from './SelectionHalo';
import { positionBuffer, resetPositionBuffer, slotMeta, slotOfId, spawnAtOfSlot } from './positionBuffer';
import { displayTravelPosition } from './ingestBirth';

afterEach(() => { vi.restoreAllMocks(); resetPositionBuffer(); });
beforeEach(() => {
  resetPositionBuffer();
  state.ui = { selectedId: 'selected', dims: 2, clusterCollapsed: false, highlightOwner: null };
  state.mesh = new THREE.Mesh();
  positionBuffer.array = new Float32Array([24, -12, 70]);
  positionBuffer.count = 1;
  slotOfId.set('selected', 0);
  vi.spyOn(performance, 'now').mockReturnValue(200);
});
function frame() {
  SelectionHalo();
  (state.frame as (input: unknown) => void)({ camera: new THREE.PerspectiveCamera(), clock: { elapsedTime: .2 } });
  return state.mesh as THREE.Mesh;
}
it('centers the ring on the flattened node when the layout retains a 3D depth', () => {
  expect(frame().position.toArray()).toEqual([24, -12, 0]);
});
it('keeps the ring at the node depth in 3D', () => {
  state.ui.dims = 3;
  expect(frame().position.toArray()).toEqual([24, -12, 70]);
});
it.each([2, 3] as const)('tracks the displayed node during its %dD arrival animation', dims => {
  state.ui.dims = dims;
  spawnAtOfSlot[0] = 0;
  slotMeta.hasOrigin[0] = 1;
  slotMeta.origin.set([-60, 40, -20]);
  const expected = displayTravelPosition({ origin: [-60, 40, -20], home: [24, -12, 70], spawnAt: 0, now: 200, reducedMotion: false, flat: dims === 2 });
  expect(frame().position.toArray()).toEqual(expected);
});
it('hides the ring when individual nodes are collapsed', () => {
  state.ui.clusterCollapsed = true;
  expect(frame().visible).toBe(false);
});

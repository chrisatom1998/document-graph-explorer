/**
 * OrbitControls wiring per display mode (spec §7.3).
 *
 * The two modes want opposite gestures from the same drag:
 *
 *  - 3D: drag orbits the nebula. Panning would let the user slide the whole
 *    sphere off-screen with no horizon to recover against, so it stays off
 *    and the arrow keys own panning (see panInput.ts).
 *  - 2D: the graph is a flat chart in the x–y plane, so drag pans it like a
 *    map. Rotation is disabled outright rather than moved to a modifier:
 *    with the polar angle pinned to the equator, the only rotation left is
 *    azimuth, which can only skew the chart to an oblique or edge-on view.
 *
 * Kept pure and prop-shaped (rather than imperative writes onto the controls
 * instance) so drei re-applies it on every dims change and there is exactly
 * one source of truth for the polar clamp.
 */

import * as THREE from 'three';

export interface OrbitControlsConfig {
  enablePan: boolean;
  enableRotate: boolean;
  screenSpacePanning: boolean;
  minPolarAngle: number;
  maxPolarAngle: number;
  mouseButtons: { LEFT: THREE.MOUSE; MIDDLE: THREE.MOUSE; RIGHT: THREE.MOUSE };
  touches: { ONE: THREE.TOUCH; TWO: THREE.TOUCH };
}

/** 3D: today's behavior, spelled out so the test can pin it. */
const ORBIT_3D: OrbitControlsConfig = {
  enablePan: false,
  enableRotate: true,
  screenSpacePanning: false,
  minPolarAngle: 0,
  maxPolarAngle: Math.PI,
  mouseButtons: {
    LEFT: THREE.MOUSE.ROTATE,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: THREE.MOUSE.PAN,
  },
  touches: { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN },
};

/** 2D: drag pans the chart, wheel/pinch still zooms, no rotation at all. */
const ORBIT_2D: OrbitControlsConfig = {
  enablePan: true,
  enableRotate: false,
  // Pan along the screen plane, not the ground plane — on a flat chart viewed
  // head-on the ground-plane pan would fight the polar clamp.
  screenSpacePanning: true,
  minPolarAngle: Math.PI / 2,
  maxPolarAngle: Math.PI / 2,
  mouseButtons: {
    LEFT: THREE.MOUSE.PAN,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: THREE.MOUSE.PAN,
  },
  touches: { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN },
};

export function orbitControlsConfig(dims: 2 | 3): OrbitControlsConfig {
  return dims === 2 ? ORBIT_2D : ORBIT_3D;
}

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { orbitControlsConfig } from './cameraControlsConfig';

describe('orbitControlsConfig', () => {
  it('keeps 3D on orbit-only gestures', () => {
    // Pins the pre-existing 3D behavior: drag orbits, mouse/touch never pans
    // (arrow keys do), and the polar range stays unclamped.
    expect(orbitControlsConfig(3)).toEqual({
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
    });
  });

  it('maps drag to screen-space pan in 2D and disables rotation', () => {
    expect(orbitControlsConfig(2)).toEqual({
      enablePan: true,
      enableRotate: false,
      screenSpacePanning: true,
      minPolarAngle: Math.PI / 2,
      maxPolarAngle: Math.PI / 2,
      mouseButtons: {
        LEFT: THREE.MOUSE.PAN,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.PAN,
      },
      touches: { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN },
    });
  });

  it('pins the polar angle to the equator only in 2D', () => {
    const flat = orbitControlsConfig(2);
    expect(flat.minPolarAngle).toBe(flat.maxPolarAngle);
    expect(orbitControlsConfig(3).minPolarAngle).not.toBe(
      orbitControlsConfig(3).maxPolarAngle,
    );
  });

  it('leaves zoom available in both modes', () => {
    // Dolly must survive the gesture remap — losing wheel/pinch zoom would be
    // a regression the pan change could easily cause.
    for (const dims of [2, 3] as const) {
      const cfg = orbitControlsConfig(dims);
      expect(cfg.mouseButtons.MIDDLE).toBe(THREE.MOUSE.DOLLY);
      expect(cfg.touches.TWO).toBe(THREE.TOUCH.DOLLY_PAN);
    }
  });
});

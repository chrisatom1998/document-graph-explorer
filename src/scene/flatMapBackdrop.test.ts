import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  BACKDROP_RENDER_ORDER,
  BACKDROP_Z,
  flatBackdropMaterial,
} from './flatMapBackdrop';

/**
 * Regression guard for "the nodes in the 2D view went away".
 *
 * The 2D backdrop covers the whole viewport, so any material setting that lets
 * it draw over the graph hides the entire graph. It shipped broken once as
 * `transparent: true` + `depthTest: false`, which put it in three's transparent
 * list (rendered AFTER opaque geometry) with depth comparison disabled, so it
 * painted over every node and renderOrder was powerless to stop it.
 */
describe('2D flat map backdrop occlusion contract', () => {
  it('stays in the opaque render list so renderOrder actually sorts it first', () => {
    // three splits render lists by material.transparent and draws
    // opaque -> transmissive -> transparent. renderOrder only sorts WITHIN a
    // list, so the backdrop must be opaque for its low renderOrder to mean
    // anything at all relative to the nodes.
    expect(flatBackdropMaterial.transparent).toBe(false);
    expect(BACKDROP_RENDER_ORDER).toBeLessThan(0);
  });

  it('keeps depth testing on as an independent guarantee', () => {
    // Second, redundant guarantee: even if list ordering ever changed, real
    // depth comparison must still let the nearer nodes win.
    expect(flatBackdropMaterial.depthTest).toBe(true);
  });

  it('sits far behind the z=0 layout plane, beyond any node radius', () => {
    // Nodes live at z=0 in 2D with radius capped at 1.75 (see Nodes.tsx
    // scaleOfSlot), so their nearest-to-backdrop surface is z = -1.75.
    const maxNodeRadius = 1.75;
    expect(BACKDROP_Z).toBeLessThan(-maxNodeRadius);
    expect(Math.abs(BACKDROP_Z) - maxNodeRadius).toBeGreaterThan(10); // real margin
  });

  it('emits fully opaque alpha, matching the opaque-list classification', () => {
    // If the shader ever emitted alpha < 1 it would need the transparent list,
    // which would reintroduce the original bug.
    expect(flatBackdropMaterial.fragmentShader).toContain('1.0);');
    expect(flatBackdropMaterial.fragmentShader).not.toMatch(/gl_FragColor\s*=\s*vec4\([^)]*,\s*0?\.\d+\s*\)/);
  });

  it('sorts ahead of a node by renderOrder within the opaque list', () => {
    // This locks the specific ordering guarantee we rely on here: both meshes
    // are opaque, so renderOrder decides which one draws first within that
    // list, and the backdrop must sort before the node.
    const backdrop = new THREE.Mesh(
      new THREE.PlaneGeometry(1400, 1400),
      flatBackdropMaterial,
    );
    backdrop.position.z = BACKDROP_Z;
    backdrop.renderOrder = BACKDROP_RENDER_ORDER;

    const node = new THREE.Mesh(
      new THREE.SphereGeometry(1.75),
      new THREE.MeshBasicMaterial(),
    );
    node.position.z = 0;

    // The full painter comparator considers other fields too, but this test is
    // intentionally about the renderOrder precondition we author directly.
    const sorted = [node, backdrop].sort((a, b) => a.renderOrder - b.renderOrder);
    expect(sorted[0]).toBe(backdrop);

    // ...and both are opaque, so they share one list and that sort applies.
    expect(backdrop.material.transparent).toBe(false);
    expect(node.material.transparent).toBe(false);
  });
});

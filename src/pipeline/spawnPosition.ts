/**
 * Random point on a spherical shell of radius `radius` (± `jitter`, uniform)
 * — the "fly-in" origin used for newly placed graph nodes before the force
 * layout settles them. Worker-safe (Math.random only, no DOM) so it can be
 * shared by every main-thread ingest/import path without pulling in scene
 * code.
 *
 * Deliberately NOT shared with layout.worker.ts's randomShellPoint(): that
 * one samples around the layout's *current* settled shell radius (a
 * runtime-computed value owned by the layout worker), a different contract
 * than this fixed-radius spawn shell.
 */
export function randomSpherePoint(radius: number, jitter = 0): [number, number, number] {
  const u = Math.random() * 2 - 1; // cos(polar)
  const phi = Math.random() * Math.PI * 2;
  const s = Math.sqrt(Math.max(0, 1 - u * u));
  const r = radius + (Math.random() * 2 - 1) * jitter;
  return [r * s * Math.cos(phi), r * s * Math.sin(phi), r * u];
}

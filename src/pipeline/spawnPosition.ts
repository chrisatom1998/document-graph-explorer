/**
 * Random point on a spherical shell of radius `radius` (± `jitter`, uniform)
 * — the "fly-in" origin used for newly placed graph nodes before the force
 * layout settles them. Worker-safe (Math.random only, no DOM), zero
 * dependencies, so it can be shared by every ingest/import path and by
 * layout.worker.ts without pulling in scene code. Callers own the radius:
 * ingest/import paths pass a fixed spawn radius, while layout.worker.ts
 * passes its own runtime-computed settled-shell radius.
 */
export function randomSpherePoint(radius: number, jitter = 0): [number, number, number] {
  const u = Math.random() * 2 - 1; // cos(polar)
  const phi = Math.random() * Math.PI * 2;
  const s = Math.sqrt(Math.max(0, 1 - u * u));
  const r = radius + (Math.random() * 2 - 1) * jitter;
  return [r * s * Math.cos(phi), r * s * Math.sin(phi), r * u];
}

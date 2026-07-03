/**
 * prefers-reduced-motion for the WebGL scene. The CSS media block in
 * styles.css only reaches DOM animations — Three.js motion (idle orbit,
 * edge pulses, materialize pops) must check this explicitly.
 */

const query =
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null;

/** Live value — MediaQueryList.matches tracks OS-setting changes. */
export function prefersReducedMotion(): boolean {
  return query?.matches ?? false;
}

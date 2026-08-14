/**
 * One-shot bloom lift when the force layout cools. Effects.tsx reads the
 * decaying boost; reduced-motion callers get a no-op trigger.
 */

import { prefersReducedMotion } from '../util/motion';

const SETTLE_MS = 800;
const SETTLE_BLOOM = 0.06;

let settleUntil = 0;

export function triggerSettleCue(): void {
  if (prefersReducedMotion()) return;
  settleUntil = performance.now() + SETTLE_MS;
}

/** Extra bloom intensity (0 when idle / reduced-motion). */
export function settleBloomBoost(now: number = performance.now()): number {
  const left = settleUntil - now;
  if (left <= 0) return 0;
  return SETTLE_BLOOM * (left / SETTLE_MS);
}

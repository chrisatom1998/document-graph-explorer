/**
 * Pure decision rules for camera-then-panel focus.
 *
 * CameraRig applies these; tests lock the race-prone commit timing so a
 * later arrival cannot reopen a dismissed panel, and a missing layout slot
 * still opens the reader (search / list picks).
 */

import { useUiStore } from '../store/uiStore';

/** "< 0.5u" arrival check, squared — shared by the rig and its tests. */
export const ARRIVE_EPS_SQ = 0.25;

export type FrameNodeCommitReason = 'no-slot' | 'reduced-motion' | 'already-near';

export type FrameNodeDecision =
  | { action: 'commit'; reason: FrameNodeCommitReason }
  | { action: 'tween' };

export function decideFrameNode(input: {
  hasSlot: boolean;
  reducedMotion: boolean;
  alreadyNear: boolean;
}): FrameNodeDecision {
  if (!input.hasSlot) return { action: 'commit', reason: 'no-slot' };
  if (input.reducedMotion) return { action: 'commit', reason: 'reduced-motion' };
  if (input.alreadyNear) return { action: 'commit', reason: 'already-near' };
  return { action: 'tween' };
}

export function isAlreadyNear(
  cameraDistSq: number,
  targetDistSq: number,
  epsSq = ARRIVE_EPS_SQ,
): boolean {
  return cameraDistSq < epsSq && targetDistSq < epsSq;
}

/** User orbit / arrow-key pan cancels an in-flight glide: commit, then clear. */
export function shouldCommitOnTweenCancel(tweenActive: boolean): boolean {
  return tweenActive;
}

/** Empty-space click: dismiss the open panel and any in-flight focus. */
export function shouldDismissGraphFocus(
  selectedId: string | null,
  pendingFocus: { id: string } | null,
): boolean {
  return Boolean(selectedId || pendingFocus);
}

/** Apply the empty-space dismiss so a later camera arrival cannot reopen the panel. */
export function dismissGraphFocus(): void {
  const ui = useUiStore.getState();
  if (shouldDismissGraphFocus(ui.selectedId, ui.pendingFocus)) ui.setSelected(null);
}

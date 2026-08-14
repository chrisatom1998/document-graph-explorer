/**
 * Owns the browser-event portion of a node drag.
 *
 * A node pointer gesture starts without touching OrbitControls. Only an actual
 * node drag (movement beyond the click threshold) engages the camera lock, so
 * selecting a node can never leave the camera disabled. Every way a real drag
 * can end must still restore the controls: a normal release, browser pointer
 * cancellation, focus loss, page hide, or unmount.
 */

export interface ToggleableControls {
  enabled: boolean;
}

interface NodeDragLifecycleOptions {
  target: Window;
  controls: ToggleableControls | null;
  onMove: (event: PointerEvent) => void;
  onFinish: () => void;
}

export interface NodeDragLifecycle {
  /** Disable camera input once the gesture has become a real node drag. */
  engage: () => void;
  /** Remove listeners and restore camera input. Safe to call more than once. */
  finish: () => void;
}

/**
 * Starts one node-pointer gesture and returns an idempotent finish function.
 */
export function startNodeDragLifecycle({
  target,
  controls,
  onMove,
  onFinish,
}: NodeDragLifecycleOptions): NodeDragLifecycle {
  let active = true;
  let controlsLocked = false;

  const engage = (): void => {
    if (!active || controlsLocked) return;
    controlsLocked = true;
    if (controls) controls.enabled = false;
  };

  const finish = (): void => {
    if (!active) return;
    active = false;
    target.removeEventListener('pointermove', onMove);
    target.removeEventListener('pointerup', finish);
    target.removeEventListener('pointercancel', finish);
    target.removeEventListener('blur', finish);
    target.removeEventListener('pagehide', finish);
    if (controlsLocked && controls) controls.enabled = true;
    onFinish();
  };

  target.addEventListener('pointermove', onMove);
  target.addEventListener('pointerup', finish);
  target.addEventListener('pointercancel', finish);
  target.addEventListener('blur', finish);
  target.addEventListener('pagehide', finish);

  return { engage, finish };
}

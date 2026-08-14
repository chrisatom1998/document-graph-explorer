/**
 * Owns the browser-event portion of a node drag.
 *
 * Node pointer-down temporarily disables OrbitControls so click jitter cannot
 * rotate the camera. Every way that gesture can end must restore the controls:
 * a normal release, browser pointer cancellation, focus loss, or unmount.
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

/**
 * Starts one node-pointer gesture and returns an idempotent finish function.
 */
export function startNodeDragLifecycle({
  target,
  controls,
  onMove,
  onFinish,
}: NodeDragLifecycleOptions): () => void {
  let active = true;

  const finish = (): void => {
    if (!active) return;
    active = false;
    target.removeEventListener('pointermove', onMove);
    target.removeEventListener('pointerup', finish);
    target.removeEventListener('pointercancel', finish);
    target.removeEventListener('blur', finish);
    if (controls) controls.enabled = true;
    onFinish();
  };

  if (controls) controls.enabled = false;
  target.addEventListener('pointermove', onMove);
  target.addEventListener('pointerup', finish);
  target.addEventListener('pointercancel', finish);
  target.addEventListener('blur', finish);

  return finish;
}

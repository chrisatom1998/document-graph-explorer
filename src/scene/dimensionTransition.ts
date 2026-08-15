import {
  layoutEpoch,
  layoutSetDims,
  layoutSettledEpoch,
  onLayoutSettled,
} from '../layout/layoutBridge';
import { useUiStore } from '../store/uiStore';

const SETTLE_LISTENER_TIMEOUT_MS = 12_000;

export interface DimensionTransitionOptions {
  /** Reframe the graph after the new force layout has finished moving. */
  fitAfterSettle?: boolean;
}

/**
 * User-facing 2D/3D switch. Store + worker updates stay paired, and an
 * optional fit waits for the matching layout epoch so the camera never frames
 * the half-flattened transition state.
 */
export function switchGraphDimensions(
  next: 2 | 3,
  options: DimensionTransitionOptions = {},
): void {
  const ui = useUiStore.getState();
  if (ui.dims === next) return;

  ui.setDims(next);
  layoutSetDims(next);
  if (!options.fitAfterSettle) return;

  const expectedEpoch = layoutEpoch();
  let timeout = 0;
  let off = (): void => undefined;
  const finish = (): boolean => {
    if (layoutSettledEpoch() < expectedEpoch) return false;
    off();
    if (timeout) window.clearTimeout(timeout);
    const current = useUiStore.getState();
    // A rapid second toggle supersedes this transition; never let an older
    // settle unexpectedly move the camera in the new mode.
    if (current.dims === next) current.sendCamera('fitAll');
    return true;
  };

  off = onLayoutSettled(() => {
    finish();
  });
  if (!finish()) timeout = window.setTimeout(off, SETTLE_LISTENER_TIMEOUT_MS);
}

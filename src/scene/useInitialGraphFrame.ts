import { useEffect, useRef } from 'react';
import { onLayoutSettled } from '../layout/layoutBridge';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';
import { clearIngestBirthSteer, isIngestFraming, wasIngestBirthSteered } from './ingestGesture';

/** Fit new collections until the user takes ownership of the camera. */
export function useInitialGraphFrame(hasNodes: boolean): void {
  const needsFrame = useRef(true);
  useEffect(() => {
    if (!hasNodes) {
      needsFrame.current = true; // next corpus gets framed again
      clearIngestBirthSteer(); // fresh corpus: an old steer must not block its first fit
      return;
    }
    let ownedNonce = useUiStore.getState().cameraCommand?.nonce ?? 0;
    return onLayoutSettled(() => {
      if (!needsFrame.current) return;
      const ui = useUiStore.getState();
      // Imported/restored graphs have no ingest-birth gesture state. A search,
      // navigator pick or explicit camera command still owns the view. Never
      // replace it with a late initial fit and strand its pending reader.
      if (ui.pendingFocus || ui.selectedId || (ui.cameraCommand?.nonce ?? 0) !== ownedNonce) {
        needsFrame.current = false;
        return;
      }
      const ready = useGraphStore.getState().phase === 'ready';
      // Live first-ingest framing is owned by CameraRig (slow ease-out).
      // Incremental add never sets that flag; session restore still fit-alls
      // here. A ready-state settle completes the initial framing either way —
      // leaving needsFrame set would make the NEXT incremental add's settle
      // fitAll and steal the user's camera.
      if (isIngestFraming()) {
        if (ready) needsFrame.current = false;
        return;
      }
      // A mid-ingest orbit/pan cancels the follow AND this handler's fitAll:
      // the no-steal guarantee means once the user takes the camera during a
      // corpus's formation, nothing auto-fits that corpus behind them.
      if (wasIngestBirthSteered()) {
        needsFrame.current = false;
        return;
      }
      ui.sendCamera('fitAll');
      ownedNonce = useUiStore.getState().cameraCommand?.nonce ?? 0;
      if (ready) needsFrame.current = false;
    });
  }, [hasNodes]);
}

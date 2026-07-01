/**
 * Auto-quality ladder (spec §7.4): EMA of frame time; sustained overruns of
 * FRAME_BUDGET_MS step the quality tier DOWN the ladder (tier+1), sustained
 * headroom steps back up. Tier semantics live with the consumers:
 *   1+: DoF off (Effects)   2+: half-res bloom (Effects)
 *   3+: label cap 15 (Labels) + hover pulses off (EdgePulses)
 *   4 : "suggest 2D" — the UI layer shows a toast off qualityTier===4;
 *       we emit a one-time console.info here.
 *
 * Also owns the document visibilitychange -> layoutPause/layoutResume hookup
 * (pause simulation when the tab is hidden, spec §7.4). This is a document
 * listener, not a keyboard listener — App's keyboard ownership is untouched.
 */

import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { FRAME_BUDGET_MS, FRAME_BUDGET_SUSTAIN_MS } from '../config';
import { layoutPause, layoutResume } from '../layout/layoutBridge';
import { useUiStore } from '../store/uiStore';
import type { QualityTier } from '../store/uiStore';

const RECOVER_MS = 14; // headroom threshold for stepping back up
const RECOVER_SUSTAIN_MS = 5_000;
const GRACE_MS = 1_500; // ignore samples after visibility/tier changes
const EMA_WEIGHT = 0.1;

export default function AutoQuality() {
  const ema = useRef(16.7);
  const overSince = useRef<number | null>(null);
  const underSince = useRef<number | null>(null);
  const holdUntil = useRef(0);
  const lastTier = useRef<QualityTier>(useUiStore.getState().qualityTier);
  const announced4 = useRef(false);

  useEffect(() => {
    holdUntil.current = performance.now() + GRACE_MS; // startup grace
    const onVisibility = (): void => {
      if (document.hidden) {
        layoutPause();
      } else {
        layoutResume();
        holdUntil.current = performance.now() + GRACE_MS;
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  useFrame((_, delta) => {
    const ui = useUiStore.getState();
    const now = performance.now();

    // any tier change (ours or the user's) restarts the measurement window
    if (ui.qualityTier !== lastTier.current) {
      lastTier.current = ui.qualityTier;
      holdUntil.current = now + GRACE_MS;
      overSince.current = null;
      underSince.current = null;
      if (ui.qualityTier < 4) announced4.current = false;
    }

    if (!ui.autoQuality) {
      overSince.current = null;
      underSince.current = null;
      return;
    }

    // clamp pathological deltas (tab stalls) so one spike can't poison the EMA
    ema.current = ema.current * (1 - EMA_WEIGHT) + Math.min(delta * 1000, 250) * EMA_WEIGHT;

    if (now < holdUntil.current) {
      overSince.current = null;
      underSince.current = null;
      return;
    }

    if (ema.current > FRAME_BUDGET_MS) {
      underSince.current = null;
      if (overSince.current === null) {
        overSince.current = now;
      } else if (now - overSince.current >= FRAME_BUDGET_SUSTAIN_MS) {
        const next = Math.min(4, ui.qualityTier + 1) as QualityTier;
        if (next !== ui.qualityTier) {
          ui.setQualityTier(next);
          if (next === 4 && !announced4.current) {
            announced4.current = true;
            console.info(
              'Knowledge Nebula: frame time is staying over budget at minimum quality — 2D mode is recommended (quality tier 4).',
            );
          }
        }
        overSince.current = null;
        holdUntil.current = now + GRACE_MS;
      }
    } else if (ema.current < RECOVER_MS && ui.qualityTier > 0) {
      overSince.current = null;
      if (underSince.current === null) {
        underSince.current = now;
      } else if (now - underSince.current >= RECOVER_SUSTAIN_MS) {
        ui.setQualityTier((ui.qualityTier - 1) as QualityTier);
        underSince.current = null;
        holdUntil.current = now + GRACE_MS;
      }
    } else {
      overSince.current = null;
      underSince.current = null;
    }
  });

  return null;
}

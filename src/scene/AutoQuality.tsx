/**
 * Auto-quality ladder (spec §7.4): EMA of frame time; sustained overruns of
 * FRAME_BUDGET_MS step the quality tier DOWN the ladder (tier+1), sustained
 * headroom steps back up. Tier semantics live with the consumers:
 *   1+: DoF off (Effects)
 *   2+: half-res bloom + composer MSAA off (Effects), dpr cap 1.5 (here),
 *       hairline edges instead of fat lines (Edges)
 *   3+: dpr cap 1.25 + label cap 15 (Labels) + hover pulses off (EdgePulses)
 *   4 : dpr cap 1; "suggest 2D" — the UI layer shows a toast off
 *       qualityTier===4; we emit a one-time console.info here.
 *
 * Also owns the document visibilitychange -> layoutPause/layoutResume hookup
 * (pause simulation when the tab is hidden, spec §7.4). This is a document
 * listener, not a keyboard listener — App's keyboard ownership is untouched.
 *
 * Also owns render resolution: dpr is the biggest fill-rate lever (bloom is
 * fullscreen), so degraded tiers shrink the backbuffer alongside the effect
 * cuts above. Caps, not values — never exceeds the device pixel ratio, and
 * coarse-pointer devices stay at 1 (matching NebulaCanvas's initial dpr).
 */

import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { FRAME_BUDGET_MS, FRAME_BUDGET_SUSTAIN_MS } from '../config';
import { layoutPause, layoutResume, layoutSetDims } from '../layout/layoutBridge';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';
import type { QualityTier } from '../store/uiStore';

const DPR_CAP_BY_TIER = [2, 2, 1.5, 1.25, 1] as const;

// Recovery needs REAL headroom, not "barely under budget": with degrade at
// 22ms and recover at 14ms, a machine hovering near ~18ms cycled tiers every
// few seconds — and every tier change swaps dpr/edge geometry/bloom, which is
// far more visible than staying one tier lower.
const RECOVER_MS = 11; // headroom threshold for stepping back up
const RECOVER_SUSTAIN_MS = 5_000;
const GRACE_MS = 4_000; // ignore samples after visibility/tier changes
/** Tier may step UP (recover) at most once per this window; degradation
 * stays responsive so a bad recovery is corrected quickly, but the ladder
 * can never oscillate faster than one recover per minute. */
const RECOVER_COOLDOWN_MS = 60_000;
const EMA_WEIGHT = 0.1;

export default function AutoQuality() {
  const ema = useRef(16.7);
  const overSince = useRef<number | null>(null);
  const underSince = useRef<number | null>(null);
  const holdUntil = useRef(0);
  const lastRecoverAt = useRef(-Infinity);
  const lastTier = useRef<QualityTier>(useUiStore.getState().qualityTier);
  const announced4 = useRef(false);

  const setDpr = useThree((s) => s.setDpr);
  const tier = useUiStore((s) => s.qualityTier);
  useEffect(() => {
    const coarse = Boolean(window.matchMedia?.('(pointer: coarse)').matches);
    const base = coarse ? 1 : Math.min(window.devicePixelRatio || 1, 2);
    setDpr(Math.min(base, DPR_CAP_BY_TIER[tier]));
  }, [tier, setDpr]);

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
    }
    // NOTE: announced4 is deliberately never reset — the "try 2D" toast shows
    // at most once per session. Resetting it on recovery let an oscillating
    // frame budget re-push the (non-auto-dismissing) toast on every
    // degrade→recover→degrade cycle, stacking duplicates on screen.

    if (!ui.autoQuality) {
      // Opted out: hold at maximum quality rather than freezing at whatever
      // tier we'd degraded to (the Settings toggle promises "maximum quality").
      if (ui.qualityTier !== 0) ui.setQualityTier(0);
      overSince.current = null;
      underSince.current = null;
      return;
    }

    // Hold the ladder while no graph exists: the welcome screen's frame cost
    // is dominated by DOM compositing over the canvas (the empty-state card
    // and its own hero canvas), not by anything a tier could shed — stepping
    // tiers there just swaps bloom/dpr under the card, a visible flash for
    // zero relief. Measurement restarts from a clean baseline once a corpus
    // produces nodes: the EMA is re-seeded (a stale value from a prior heavy
    // session would otherwise pre-charge the next ingest's degrade window)
    // and the grace window is kept armed so the first samples after nodes
    // appear are ignored, matching startup.
    if (useGraphStore.getState().nodes.length === 0) {
      ema.current = 16.7;
      holdUntil.current = now + GRACE_MS;
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
          // Suggest 2D via the shared toast stack (once per session). Only
          // consume the guard when we actually show it — if the budget first
          // bottoms out while already in 2D, a later 3D re-degrade should
          // still get the suggestion. The action toast persists until acted
          // on or dismissed.
          if (next === 4 && !announced4.current && ui.dims === 3) {
            announced4.current = true;
            ui.pushToast('Struggling to keep up — try 2D mode?', 'info', {
              label: 'Switch to 2D',
              run: () => {
                const s = useUiStore.getState();
                s.setDims(2);
                layoutSetDims(2);
              },
            });
          }
        }
        overSince.current = null;
        holdUntil.current = now + GRACE_MS;
      }
    } else if (
      ema.current < RECOVER_MS &&
      ui.qualityTier > 0 &&
      now - lastRecoverAt.current >= RECOVER_COOLDOWN_MS
    ) {
      overSince.current = null;
      if (underSince.current === null) {
        underSince.current = now;
      } else if (now - underSince.current >= RECOVER_SUSTAIN_MS) {
        ui.setQualityTier((ui.qualityTier - 1) as QualityTier);
        underSince.current = null;
        lastRecoverAt.current = now;
        holdUntil.current = now + GRACE_MS;
      }
    } else {
      overSince.current = null;
      underSince.current = null;
    }
  });

  return null;
}

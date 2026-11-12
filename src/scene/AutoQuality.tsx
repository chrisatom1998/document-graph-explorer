/**
 * Auto-quality ladder (spec §7.4): EMA of frame time; sustained overruns of
 * FRAME_BUDGET_MS step the quality tier DOWN the ladder (tier+1), sustained
 * headroom steps back up. Tier semantics live with the consumers:
 *   1+: reserves headroom before reducing glow and geometry
 *   2+: half-res bloom (Effects),
 *       hairline edges in Performance mode (Edges)
 *   3+: label cap 15 (Labels) + hover pulses off (EdgePulses)
 *   4 : "suggest 2D" — the UI layer shows a toast off
 *       qualityTier===4; we emit a one-time console.info here.
 *
 * Also owns the document visibilitychange -> layoutPause/layoutResume hookup
 * (pause simulation when the tab is hidden, spec §7.4). This is a document
 * listener, not a keyboard listener — App's keyboard ownership is untouched.
 *
 * Also owns render resolution: dpr is the biggest fill-rate lever (bloom is
 * fullscreen). High/Ultra retain sharpness while reducing effects; Performance
 * allows the original resolution ladder. All modes respect a pixel budget.
 */

import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { FRAME_BUDGET_MS, FRAME_BUDGET_SUSTAIN_MS } from '../config';
import { layoutPause, layoutResume } from '../layout/layoutBridge';
import { useUiStore } from '../store/uiStore';
import type { QualityTier } from '../store/uiStore';
import { switchGraphDimensions } from './dimensionTransition';
import { useSettingsStore } from '../store/settingsStore';
import { graphPixelRatio } from './renderQuality';

const MIN_RECOVER_MS = 14;
const CADENCE_WINDOW_MS = 1_000;
const RECOVER_SUSTAIN_MS = 5_000;
const GRACE_MS = 1_500; // ignore samples after visibility/tier changes
const EMA_WEIGHT = 0.1;
const SWITCH_TO_2D_ACTION_LABEL = 'Switch to 2D';

export default function AutoQuality({ onPixelRatioChange }: { onPixelRatioChange?: (ratio: number) => void }) {
  const ema = useRef(16.7);
  const overSince = useRef<number | null>(null);
  const underSince = useRef<number | null>(null);
  const holdUntil = useRef(0);
  const lastTier = useRef<QualityTier>(useUiStore.getState().qualityTier);
  const announced4 = useRef(false);
  const cadence = useRef({ since: 0, fastest: Infinity, frameMs: 1000 / 60 });

  const setDpr = useThree((s) => s.setDpr);
  const size = useThree((s) => s.size);
  const gl = useThree((s) => s.gl);
  const clarity = useSettingsStore((s) => s.graphClarity);
  const tier = useUiStore((s) => s.qualityTier);
  const dims = useUiStore((s) => s.dims);
  useEffect(() => {
    const context = gl.getContext();
    const maxDimension = Math.min(gl.capabilities.maxTextureSize, context.getParameter(context.MAX_RENDERBUFFER_SIZE));
    const update = () => {
      const ratio = graphPixelRatio({
        deviceRatio: window.devicePixelRatio, clarity, tier,
        width: size.width, height: size.height, maxDimension,
      });
      setDpr(ratio);
      onPixelRatioChange?.(ratio);
    };
    // Re-arm the resolution query when moving between screens or zooming.
    let screen: MediaQueryList | undefined;
    const watchScreen = () => {
      screen?.removeEventListener('change', watchScreen);
      update();
      screen = window.matchMedia?.(`(resolution: ${window.devicePixelRatio}dppx)`);
      screen?.addEventListener('change', watchScreen);
    };
    watchScreen();
    window.addEventListener('resize', update);
    return () => {
      screen?.removeEventListener('change', watchScreen);
      window.removeEventListener('resize', update);
    };
  }, [tier, clarity, size.width, size.height, gl, setDpr, onPixelRatioChange]);

  useEffect(() => {
    holdUntil.current = performance.now() + GRACE_MS; // startup grace
    const onVisibility = (): void => {
      if (document.hidden) {
        layoutPause();
      } else {
        layoutResume();
        holdUntil.current = performance.now() + GRACE_MS;
        cadence.current.since = 0;
        cadence.current.fastest = Infinity;
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  // A performance suggestion raised in 3D becomes misleading the instant the
  // user switches modes through the toolbar. Clear only that redundant action
  // toast; unrelated warnings and information remain untouched.
  useEffect(() => {
    if (dims !== 2) return;
    const ui = useUiStore.getState();
    for (const toast of ui.toasts) {
      if (toast.action?.label === SWITCH_TO_2D_ACTION_LABEL) ui.dismissToast(toast.id);
    }
  }, [dims]);

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

    // clamp pathological deltas (tab stalls) so one spike can't poison the EMA
    ema.current = ema.current * (1 - EMA_WEIGHT) + Math.min(delta * 1000, 250) * EMA_WEIGHT;

    // Frame deltas include vsync wait: 60 Hz cannot ever reach the old 14ms
    // recovery threshold. Re-measure cadence in short windows so switching
    // displays can recover too, while capping recovery below the degrade budget.
    const sampleMs = delta * 1000;
    if (cadence.current.since === 0) cadence.current.since = now;
    if (sampleMs >= 1000 / 240 && sampleMs < FRAME_BUDGET_MS) {
      cadence.current.fastest = Math.min(cadence.current.fastest, sampleMs);
    }
    if (now - cadence.current.since >= CADENCE_WINDOW_MS) {
      if (Number.isFinite(cadence.current.fastest)) {
        cadence.current.frameMs = cadence.current.fastest;
      }
      cadence.current.since = now;
      cadence.current.fastest = Infinity;
    }
    const recoverMs = Math.min(
      FRAME_BUDGET_MS * 0.85,
      Math.max(MIN_RECOVER_MS, cadence.current.frameMs * 1.1),
    );

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
              label: SWITCH_TO_2D_ACTION_LABEL,
              run: () => {
                switchGraphDimensions(2, { fitAfterSettle: true });
              },
            });
          }
        }
        overSince.current = null;
        holdUntil.current = now + GRACE_MS;
      }
    } else if (ema.current < recoverMs && ui.qualityTier > 0) {
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

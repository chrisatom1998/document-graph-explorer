/**
 * Post-processing chain (spec §7.1): Bloom is the money shot, a gentle
 * vignette for the observatory frame. Keep every graph depth in focus so
 * selecting a node never blurs neighboring labels and connections.
 *
 * Quality ladder (§7.4): qualityTier >= 2 halves bloom resolution. In the
 * installed postprocessing@6.39 `resolutionScale` only applies to the
 * non-mipmap (Kawase) blur path — mipmapBlur always works from the full-res
 * mip chain — so degraded tiers switch to the Kawase path at half res while
 * tiers 0-1 keep the prettier mipmap blur.
 *
 * Tone mapping: the Canvas keeps R3F's default ACESFilmic; the composer
 * internally renders untonemapped and every nebula material opts out via
 * toneMapped={false}, so brightness authored in scene colors survives to the
 * bloom luminance pass. See Labels.tsx for the label-vs-bloom threshold
 * tension (luminanceThreshold here is the other half of that contract).
 */

import { useEffect, useMemo, useState } from 'react';
import { useThree } from '@react-three/fiber';
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing';
import { onLayoutSettled } from '../layout/layoutBridge';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';
import { useSettingsStore } from '../store/settingsStore';
import { graphSamples } from './renderQuality';
import { settleBloomBoost, triggerSettleCue } from './settleCue';
import { VISUAL_DENSITY_SOFTEN_FULL, VISUAL_DENSITY_SOFTEN_START } from '../config';

// Keep label luminance below the bloom threshold; only bright highlights glow.
const BLOOM_INTENSITY = 0.34;
// Text stays below this luminance; bright node highlights keep their glow.
const BLOOM_THRESHOLD = 0.9;
const BLOOM_SMOOTHING = 0.1;
// 2D star chart: bloom drops to a faint dot glow (the halo shells are off),
// DoF makes no sense on a flat plane, vignette lightens to a soft frame.
const FLAT_BLOOM_INTENSITY = 0.05;
const FLAT_VIGNETTE = 0.18;

export default function Effects() {
  const maxSamples = useThree(s => s.gl.capabilities.maxSamples);
  const clarity = useSettingsStore(s => s.graphClarity);
  const qualityTier = useUiStore((s) => s.qualityTier);
  const flat = useUiStore((s) => s.dims === 2);
  const hoveredId = useUiStore((s) => s.hoveredId);
  const selectedId = useUiStore((s) => s.selectedId);
  const nodeCount = useGraphStore((s) => s.nodes.length);
  const [settleTick, setSettleTick] = useState(0);

  useEffect(() => {
    let timeout = 0;
    const off = onLayoutSettled(() => {
      triggerSettleCue();
      setSettleTick((n) => n + 1);
      window.clearTimeout(timeout);
      timeout = window.setTimeout(() => setSettleTick((n) => n + 1), 820);
    });
    return () => {
      off();
      window.clearTimeout(timeout);
    };
  }, []);
  const halfRes = qualityTier >= 2;
  const densitySoftening = useMemo(() => {
    if (nodeCount <= VISUAL_DENSITY_SOFTEN_START) return 0;
    const span = VISUAL_DENSITY_SOFTEN_FULL - VISUAL_DENSITY_SOFTEN_START;
    return Math.min(1, (nodeCount - VISUAL_DENSITY_SOFTEN_START) / span);
  }, [nodeCount]);
  const focusBoost = hoveredId || selectedId ? 0.04 : 0;
  const intensity = flat
    ? FLAT_BLOOM_INTENSITY
    : BLOOM_INTENSITY - densitySoftening * 0.14 + focusBoost + settleBloomBoost() * 0.5;
  void settleTick;

  // Geometry antialiasing lives HERE, not on the canvas: the composer renders
  // the scene into its own framebuffer, so the WebGL context's MSAA (off in
  // NebulaCanvas) could only ever smooth the final fullscreen blit. Preserve
  // antialiasing when reducing effects so curves and text remain stable.
  return (
    <EffectComposer multisampling={graphSamples(maxSamples, clarity)}>
      {halfRes ? (
        <Bloom
          mipmapBlur={false}
          resolutionScale={0.5}
          intensity={intensity}
          luminanceThreshold={BLOOM_THRESHOLD}
          luminanceSmoothing={BLOOM_SMOOTHING}
        />
      ) : (
        <Bloom
          mipmapBlur
          intensity={intensity}
          luminanceThreshold={BLOOM_THRESHOLD}
          luminanceSmoothing={BLOOM_SMOOTHING}
          radius={0.55}
        />
      )}
      <Vignette darkness={flat ? FLAT_VIGNETTE : 0.32 - densitySoftening * 0.06} offset={flat ? 0.28 : 0.18} />
    </EffectComposer>
  );
}

/**
 * Post-processing chain (spec §7.1): Bloom is the money shot, a gentle
 * vignette for the observatory frame, DoF only at full quality with a
 * selection. Capped there on purpose — no chromatic aberration, no grain.
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
 *
 * Everything that changes at interaction rate — hover/selection focus boost,
 * node-count density softening — is steered imperatively in useFrame via the
 * effects' runtime setters. Re-rendering the composer with new children or
 * props rebuilds the EffectPass (a shader recompile + render-target
 * reallocation), which shows up as a one-frame flash; only rare structural
 * switches (quality tier, 2D/3D) are allowed to do that.
 */

import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Bloom, DepthOfField, EffectComposer, Vignette } from '@react-three/postprocessing';
import type { BloomEffect, DepthOfFieldEffect, VignetteEffect } from 'postprocessing';
import { onLayoutSettled } from '../layout/layoutBridge';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';
import { positionBuffer, slotOfId } from './positionBuffer';
import { settleBloomBoost, triggerSettleCue } from './settleCue';
import { VISUAL_DENSITY_SOFTEN_FULL, VISUAL_DENSITY_SOFTEN_START } from '../config';

// Threshold/smoothing are half of the label-vs-bloom contract (Labels.tsx) —
// intensity and radius are safe to tune; the threshold is not.
const BLOOM_INTENSITY = 1.02;
const BLOOM_THRESHOLD = 0.34;
const BLOOM_SMOOTHING = 0.18;
// 2D star chart: bloom drops to a faint dot glow (the halo shells are off),
// DoF makes no sense on a flat plane, vignette lightens to a soft frame.
const FLAT_BLOOM_INTENSITY = 0.52;
const FLAT_VIGNETTE = 0.34;
const FOCUS_BOOST = 0.12;
const DOF_BOKEH_SCALE = 2.2;

function densitySoftening(nodeCount: number): number {
  if (nodeCount <= VISUAL_DENSITY_SOFTEN_START) return 0;
  const span = VISUAL_DENSITY_SOFTEN_FULL - VISUAL_DENSITY_SOFTEN_START;
  return Math.min(1, (nodeCount - VISUAL_DENSITY_SOFTEN_START) / span);
}

/**
 * DepthOfField that keeps its focus target on the selected node. Mounted
 * whenever tier-0 3D allows it — NOT gated on selection, because adding or
 * removing the effect rebuilds the composer's EffectPass mid-interaction.
 * With nothing selected the bokeh scale drops to 0, leaving the pass
 * visually inert.
 */
function FocusedDoF() {
  const ref = useRef<DepthOfFieldEffect>(null);
  useFrame(() => {
    const effect = ref.current;
    if (!effect || !effect.target) return;
    const id = useUiStore.getState().selectedId;
    if (!id) {
      if (effect.bokehScale !== 0) effect.bokehScale = 0;
      return;
    }
    if (effect.bokehScale !== DOF_BOKEH_SCALE) effect.bokehScale = DOF_BOKEH_SCALE;
    const slot = slotOfId.get(id);
    if (slot === undefined || slot >= positionBuffer.count) return;
    const arr = positionBuffer.array;
    effect.target.set(arr[slot * 3], arr[slot * 3 + 1], arr[slot * 3 + 2]);
  });
  // target prop makes the effect allocate its target Vector3; we then steer
  // it imperatively above (checked against installed typings: target is
  // `Vector3 | null` on DepthOfFieldEffect).
  return (
    <DepthOfField ref={ref} target={[0, 0, 0]} worldFocusRange={70} bokehScale={0} />
  );
}

export default function Effects() {
  const qualityTier = useUiStore((s) => s.qualityTier);
  const flat = useUiStore((s) => s.dims === 2);
  const dofOn = useUiStore((s) => s.qualityTier === 0 && s.dims === 3);
  const halfRes = qualityTier >= 2;

  // Settle cue: arm the one-shot bloom lift when the force layout cools.
  // The decaying boost itself is read per-frame below, so no re-render tick
  // is needed to animate it.
  useEffect(() => onLayoutSettled(() => triggerSettleCue()), []);

  const bloomRef = useRef<BloomEffect>(null);
  const vignetteRef = useRef<VignetteEffect>(null);
  // Interaction-rate parameters bypass React: R3F runs useFrame subscribers
  // before the composer renders, so values written here land the same frame.
  useFrame(() => {
    const bloom = bloomRef.current;
    const vignette = vignetteRef.current;
    if (!bloom || !vignette) return;
    const softening = densitySoftening(useGraphStore.getState().nodes.length);
    const { hoveredId, selectedId } = useUiStore.getState();
    const focusBoost = hoveredId || selectedId ? FOCUS_BOOST : 0;
    bloom.intensity = flat
      ? FLAT_BLOOM_INTENSITY
      : BLOOM_INTENSITY - softening * 0.26 + focusBoost + settleBloomBoost();
    vignette.darkness = flat ? FLAT_VIGNETTE : 0.62 - softening * 0.08;
  });

  // Geometry antialiasing lives HERE, not on the canvas: the composer renders
  // the scene into its own framebuffer, so the WebGL context's MSAA (off in
  // NebulaCanvas) could only ever smooth the final fullscreen blit. 4x is
  // visually equivalent to the library default 8x at this scene's contrast
  // and half the cost; degraded tiers drop it with the half-res bloom.
  return (
    <EffectComposer multisampling={halfRes ? 0 : 4}>
      {halfRes ? (
        <Bloom
          ref={bloomRef}
          mipmapBlur={false}
          resolutionScale={0.5}
          intensity={BLOOM_INTENSITY}
          luminanceThreshold={BLOOM_THRESHOLD}
          luminanceSmoothing={BLOOM_SMOOTHING}
        />
      ) : (
        <Bloom
          ref={bloomRef}
          mipmapBlur
          intensity={BLOOM_INTENSITY}
          luminanceThreshold={BLOOM_THRESHOLD}
          luminanceSmoothing={BLOOM_SMOOTHING}
          radius={0.9}
        />
      )}
      {dofOn ? <FocusedDoF /> : (null as unknown as React.ReactElement)}
      <Vignette ref={vignetteRef} darkness={0.62} offset={flat ? 0.28 : 0.18} />
    </EffectComposer>
  );
}

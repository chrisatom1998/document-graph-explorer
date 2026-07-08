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
 */

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Bloom, DepthOfField, EffectComposer, Vignette } from '@react-three/postprocessing';
import type { DepthOfFieldEffect } from 'postprocessing';
import { useUiStore } from '../store/uiStore';
import { positionBuffer, slotOfId } from './positionBuffer';

// Threshold/smoothing are half of the label-vs-bloom contract (Labels.tsx) —
// intensity and radius are safe to tune; the threshold is not.
const BLOOM_INTENSITY = 1.15;
const BLOOM_THRESHOLD = 0.28;
const BLOOM_SMOOTHING = 0.18;

// Flat (2D ambient) mode wants a restrained, "portfolio hero" glow — a hint
// of bloom on the brightest dots, not the nebula's money-shot wash.
const FLAT_BLOOM_INTENSITY = 0.4;
const FLAT_BLOOM_THRESHOLD = 0.45;
const FLAT_VIGNETTE_DARKNESS = 0.35;

/** DepthOfField that keeps its focus target on the selected node. */
function FocusedDoF() {
  const ref = useRef<DepthOfFieldEffect>(null);
  useFrame(() => {
    const effect = ref.current;
    if (!effect || !effect.target) return;
    const id = useUiStore.getState().selectedId;
    if (!id) return;
    const slot = slotOfId.get(id);
    if (slot === undefined || slot >= positionBuffer.count) return;
    const arr = positionBuffer.array;
    effect.target.set(arr[slot * 3], arr[slot * 3 + 1], arr[slot * 3 + 2]);
  });
  // target prop makes the effect allocate its target Vector3; we then steer
  // it imperatively above (checked against installed typings: target is
  // `Vector3 | null` on DepthOfFieldEffect).
  return (
    <DepthOfField ref={ref} target={[0, 0, 0]} worldFocusRange={70} bokehScale={2.2} />
  );
}

export default function Effects() {
  const qualityTier = useUiStore((s) => s.qualityTier);
  const flat = useUiStore((s) => s.dims === 2);
  const dofOn = useUiStore((s) => s.qualityTier === 0 && s.selectedId !== null) && !flat;
  const halfRes = qualityTier >= 2;

  const intensity = flat ? FLAT_BLOOM_INTENSITY : BLOOM_INTENSITY;
  const threshold = flat ? FLAT_BLOOM_THRESHOLD : BLOOM_THRESHOLD;

  return (
    <EffectComposer>
      {halfRes ? (
        <Bloom
          mipmapBlur={false}
          resolutionScale={0.5}
          intensity={intensity}
          luminanceThreshold={threshold}
          luminanceSmoothing={BLOOM_SMOOTHING}
        />
      ) : (
        <Bloom
          mipmapBlur
          intensity={intensity}
          luminanceThreshold={threshold}
          luminanceSmoothing={BLOOM_SMOOTHING}
          radius={0.9}
        />
      )}
      {dofOn ? <FocusedDoF /> : <></>}
      <Vignette darkness={flat ? FLAT_VIGNETTE_DARKNESS : 0.55} offset={0.18} />
    </EffectComposer>
  );
}

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

const BLOOM_INTENSITY = 1.0;
const BLOOM_THRESHOLD = 0.28;
const BLOOM_SMOOTHING = 0.18;

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
    <DepthOfField ref={ref} target={[0, 0, 0]} worldFocusRange={55} bokehScale={2.2} />
  );
}

export default function Effects() {
  const qualityTier = useUiStore((s) => s.qualityTier);
  const dofOn = useUiStore((s) => s.qualityTier === 0 && s.selectedId !== null);
  const halfRes = qualityTier >= 2;

  return (
    <EffectComposer>
      {halfRes ? (
        <Bloom
          mipmapBlur={false}
          resolutionScale={0.5}
          intensity={BLOOM_INTENSITY}
          luminanceThreshold={BLOOM_THRESHOLD}
          luminanceSmoothing={BLOOM_SMOOTHING}
        />
      ) : (
        <Bloom
          mipmapBlur
          intensity={BLOOM_INTENSITY}
          luminanceThreshold={BLOOM_THRESHOLD}
          luminanceSmoothing={BLOOM_SMOOTHING}
          radius={0.85}
        />
      )}
      {dofOn ? <FocusedDoF /> : <></>}
      <Vignette darkness={0.55} offset={0.18} />
    </EffectComposer>
  );
}

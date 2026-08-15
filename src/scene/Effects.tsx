/**
 * Post-processing chain (spec §7.1): Bloom is the money shot, a gentle
 * vignette for the observatory frame, DoF only at full quality in 3D. Capped
 * there on purpose — no chromatic aberration, no grain.
 *
 * Quality ladder (§7.4): qualityTier >= 2 halves bloom resolution. In the
 * installed postprocessing@6.39 `resolutionScale` only applies to the
 * non-mipmap (Kawase) blur path — mipmapBlur always works from the full-res
 * mip chain — so degraded tiers switch to the Kawase path at half res while
 * tiers 0-1 keep the prettier mipmap blur.
 *
 * Re-render discipline: the composer children rebuild ONLY on structural
 * changes (quality tier, 2D/3D) — EffectComposer rebuilds its EffectPass
 * (shader recompile, one-frame pop) whenever children identity changes, so
 * everything continuous (hover/selection focus boost, settle-cue bloom lift,
 * density softening, DoF focus/strength) is driven imperatively on the effect
 * instances inside useFrame, damped so brightness eases instead of stepping.
 * Hover/selection and node count are read transiently via getState — a
 * pointermove or ingest tick never re-renders this component.
 *
 * Tone mapping: the Canvas keeps R3F's default ACESFilmic; the composer
 * internally renders untonemapped and every nebula material opts out via
 * toneMapped={false}, so brightness authored in scene colors survives to the
 * bloom luminance pass. See Labels.tsx for the label-vs-bloom threshold
 * tension (luminanceThreshold here is the other half of that contract).
 */

import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
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
const VIGNETTE_DARKNESS = 0.62;
const FOCUS_BLOOM_BOOST = 0.12;
const DOF_BOKEH_SCALE = 2.2;
// Damping lambdas, matching FocusLight's intensity feel.
const BLOOM_DAMP = 8;
const VIGNETTE_DAMP = 8;
const DOF_DAMP = 8;

function densitySoftening(nodeCount: number): number {
  if (nodeCount <= VISUAL_DENSITY_SOFTEN_START) return 0;
  return Math.min(
    1,
    (nodeCount - VISUAL_DENSITY_SOFTEN_START) /
      (VISUAL_DENSITY_SOFTEN_FULL - VISUAL_DENSITY_SOFTEN_START),
  );
}

/**
 * DepthOfField that keeps its focus target on the selected node. Stays
 * mounted whenever the tier permits — mount/unmount on selection would
 * rebuild the whole EffectPass (focus pop) — and instead damps bokehScale
 * to 0 (a visual no-op) while nothing is selected, reading selection state
 * imperatively.
 */
function FocusedDoF() {
  const ref = useRef<DepthOfFieldEffect>(null);
  useFrame((_, delta) => {
    const effect = ref.current;
    if (!effect) return;
    const id = useUiStore.getState().selectedId;
    effect.bokehScale = THREE.MathUtils.damp(
      effect.bokehScale,
      id ? DOF_BOKEH_SCALE : 0,
      DOF_DAMP,
      delta,
    );
    if (!id || !effect.target) return;
    const slot = slotOfId.get(id);
    if (slot === undefined || slot >= positionBuffer.count) return;
    const arr = positionBuffer.array;
    // The array can be detached/swapped mid-frame during worker respawn, so
    // guard the read range too (see ingestBirth.ts writeSlotTravelPosition).
    if (slot * 3 + 2 >= arr.length) return;
    effect.target.set(arr[slot * 3], arr[slot * 3 + 1], arr[slot * 3 + 2]);
  });
  // target prop makes the effect allocate its target Vector3; we then steer
  // it imperatively above (checked against installed typings: target is
  // `Vector3 | null` on DepthOfFieldEffect). bokehScale starts at the no-op
  // 0 and eases in on first selection.
  return (
    <DepthOfField ref={ref} target={[0, 0, 0]} worldFocusRange={70} bokehScale={0} />
  );
}

export default function Effects() {
  // Structural inputs only — everything continuous is read via getState in
  // the frame loop below.
  const qualityTier = useUiStore((s) => s.qualityTier);
  const flat = useUiStore((s) => s.dims === 2);

  // Callback refs (not RefObjects): wrapEffect-wrapped components spread all
  // props — ref included — through a JSON.stringify memo, and functions are
  // dropped by stringify while a populated RefObject would serialize the
  // whole effect graph on every structural rebuild.
  const bloomRef = useRef<BloomEffect | null>(null);
  const vignetteRef = useRef<VignetteEffect | null>(null);

  // Settle cue: arm the decaying boost; settleBloomBoost() is then sampled
  // per frame below, so the 800ms decay actually eases instead of flashing.
  useEffect(() => onLayoutSettled(triggerSettleCue), []);

  useFrame((_, delta) => {
    const ui = useUiStore.getState();
    const isFlat = ui.dims === 2;
    const soften = densitySoftening(useGraphStore.getState().nodes.length);
    const bloom = bloomRef.current;
    if (bloom) {
      const focusBoost =
        ui.hoveredId !== null || ui.selectedId !== null ? FOCUS_BLOOM_BOOST : 0;
      const target = isFlat
        ? FLAT_BLOOM_INTENSITY
        : BLOOM_INTENSITY - soften * 0.26 + focusBoost + settleBloomBoost();
      bloom.intensity = THREE.MathUtils.damp(bloom.intensity, target, BLOOM_DAMP, delta);
    }
    const vignette = vignetteRef.current;
    if (vignette) {
      const target = isFlat ? FLAT_VIGNETTE : VIGNETTE_DARKNESS - soften * 0.08;
      vignette.darkness = THREE.MathUtils.damp(
        vignette.darkness,
        target,
        VIGNETTE_DAMP,
        delta,
      );
    }
  });

  const halfRes = qualityTier >= 2;
  const dofMounted = qualityTier === 0 && !flat;

  // Memoized so identical structural state never hands EffectComposer a new
  // children tree (its EffectPass rebuilds on children identity).
  const passes = useMemo(
    () => (
      <>
        {halfRes ? (
          <Bloom
            ref={(e: BloomEffect | null) => {
              bloomRef.current = e;
            }}
            mipmapBlur={false}
            resolutionScale={0.5}
            intensity={flat ? FLAT_BLOOM_INTENSITY : BLOOM_INTENSITY}
            luminanceThreshold={BLOOM_THRESHOLD}
            luminanceSmoothing={BLOOM_SMOOTHING}
          />
        ) : (
          <Bloom
            ref={(e: BloomEffect | null) => {
              bloomRef.current = e;
            }}
            mipmapBlur
            intensity={flat ? FLAT_BLOOM_INTENSITY : BLOOM_INTENSITY}
            luminanceThreshold={BLOOM_THRESHOLD}
            luminanceSmoothing={BLOOM_SMOOTHING}
            radius={0.9}
          />
        )}
        {dofMounted ? <FocusedDoF /> : (null as unknown as React.ReactElement)}
        <Vignette
          ref={(e: VignetteEffect | null) => {
            vignetteRef.current = e;
          }}
          darkness={flat ? FLAT_VIGNETTE : VIGNETTE_DARKNESS}
          offset={flat ? 0.28 : 0.18}
        />
      </>
    ),
    [halfRes, flat, dofMounted],
  );

  // Geometry antialiasing lives HERE, not on the canvas: the composer renders
  // the scene into its own framebuffer, so the WebGL context's MSAA (off in
  // NebulaCanvas) could only ever smooth the final fullscreen blit. 4x is
  // visually equivalent to the library default 8x at this scene's contrast
  // and half the cost; degraded tiers drop it with the half-res bloom.
  return <EffectComposer multisampling={halfRes ? 0 : 4}>{passes}</EffectComposer>;
}

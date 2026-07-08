/**
 * The AI core (spec §7.1 addendum): a soft, camera-facing glow orb at the dead
 * center of the nebula that reads as "the mind of the AI". The teal/cyan tint
 * deliberately contrasts the violet nebula so the core stands apart from the
 * document dust around it.
 *
 * It is always faintly alive: a slow idle "breathe". While a chat reply is
 * streaming (useChatStore.isStreaming) it ramps into a faster, brighter,
 * higher-amplitude pulse and shifts white-hot — information visibly being
 * generated.
 *
 * Per-frame cost is a handful of scalar/color writes on one material; the
 * sprite is built once. Under prefers-reduced-motion the oscillation is
 * dropped entirely — the core only changes brightness (a steady, motionless
 * cue), mirroring how EdgePulses bails.
 */

import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useChatStore } from '../store/chatStore';
import { prefersReducedMotion } from '../util/motion';
import { makeSoftSprite } from './proceduralTextures';

const BASE_GLOW = 26; // sprite world size (soft halo radius ~13u)
const BASE_GLOW_OPACITY = 0.4;

const GLOW_COLOR = new THREE.Color('#2fd9c4');

const NO_RAYCAST = (): void => {
  /* the core is decoration, never pickable */
};

export default function AiCore() {
  const sprite = useMemo(makeSoftSprite, []);

  const glowRef = useRef<THREE.Sprite>(null);
  const glowMatRef = useRef<THREE.SpriteMaterial>(null);

  // isStreaming drives the pulse. Read through a ref so the (rare) toggle
  // doesn't churn React — the value is only ever sampled inside useFrame.
  const streamingRef = useRef(useChatStore.getState().isStreaming);
  useEffect(() => {
    streamingRef.current = useChatStore.getState().isStreaming;
    return useChatStore.subscribe((state) => {
      streamingRef.current = state.isStreaming;
    });
  }, []);

  // Eased "energy" (0 idle -> 1 generating) and an accumulated breathe phase.
  // Accumulating phase (rather than sampling sin(time*freq)) keeps the wave
  // continuous when the frequency jumps as energy ramps.
  const energy = useRef(0);
  const phase = useRef(0);

  useFrame((_, delta) => {
    const glow = glowRef.current;
    const glowMat = glowMatRef.current;
    if (!glow || !glowMat) return;

    // Frame-rate-independent ease toward the target energy.
    const target = streamingRef.current ? 1 : 0;
    energy.current = THREE.MathUtils.damp(energy.current, target, 4, delta);
    const e = energy.current;

    const reduced = prefersReducedMotion();
    // Breathe faster the more energetic; skipped entirely under reduced motion.
    phase.current += delta * (1.2 + e * 2.6);
    const osc = reduced ? 0 : Math.sin(phase.current);

    // Amplitude grows with energy: a faint idle breathe -> a strong pulse.
    const amp = 0.16 + e * 0.42;
    const pulse = 1 + amp * osc; // ~0.4 .. 1.6 at full energy
    const bright = 1 + e * 0.9; // steadier overall brightening while generating

    const glowScale = BASE_GLOW * pulse * (1 + e * 0.5);
    glow.scale.set(glowScale, glowScale, 1);
    glowMat.opacity = Math.min(1, BASE_GLOW_OPACITY * pulse * bright);
    // push the tint >1 to overbright toward white-hot and feed the bloom pass
    // harder while generating.
    glowMat.color.copy(GLOW_COLOR).multiplyScalar(1 + e * 0.7);
  });

  return (
    <sprite ref={glowRef} scale={[BASE_GLOW, BASE_GLOW, 1]} raycast={NO_RAYCAST}>
      <spriteMaterial
        ref={glowMatRef}
        map={sprite}
        color={GLOW_COLOR}
        transparent
        opacity={BASE_GLOW_OPACITY}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        toneMapped={false}
      />
    </sprite>
  );
}

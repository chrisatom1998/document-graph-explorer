/**
 * Camera choreography (spec §7.3): damped OrbitControls, eased glide-to-frame
 * commands from uiStore.cameraCommand, idle auto-orbit so the nebula feels
 * alive, and the 2D-mode polar clamp.
 *
 * Command tweens use maath easing.damp3 on BOTH camera.position and
 * controls.target; any user 'start' gesture on the controls cancels the
 * active tween immediately.
 */

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { easing } from 'maath';
import { CAMERA_GLIDE_MS } from '../config';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';
import type { CameraCommand } from '../store/uiStore';
import { positionBuffer, scaleOfSlot, slotOfId } from './positionBuffer';
import { cameraPose } from './cameraPose';
import { prefersReducedMotion } from '../util/motion';

const IDLE_MS = 10_000;
const SMOOTH_TIME = (CAMERA_GLIDE_MS / 1000) * 0.45; // ~800ms glide feel
const ARRIVE_EPS_SQ = 0.25; // "< 0.5u" arrival check, squared

// module-level temps — single rig instance, zero per-frame allocations
const desiredPos = new THREE.Vector3();
const desiredTarget = new THREE.Vector3();
const viewDir = new THREE.Vector3();
const centroid = new THREE.Vector3();

export default function CameraRig() {
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const dims = useUiStore((s) => s.dims);

  const lastNonce = useRef(0);
  const tweenActive = useRef(false);
  const lastInteraction = useRef(
    typeof performance !== 'undefined' ? performance.now() : 0,
  );

  // 2D mode: lock the polar angle to the equator while active (spec §7.3).
  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    if (dims === 2) {
      controls.minPolarAngle = Math.PI / 2;
      controls.maxPolarAngle = Math.PI / 2;
    } else {
      controls.minPolarAngle = 0;
      controls.maxPolarAngle = Math.PI;
    }
  }, [dims]);

  const beginCommand = (
    cmd: CameraCommand,
    camera: THREE.Camera,
    controls: OrbitControlsImpl,
  ): void => {
    const count = positionBuffer.count;
    const arr = positionBuffer.array;

    // keep the current viewing direction; only distance/target change
    viewDir.copy(camera.position).sub(controls.target);
    if (viewDir.lengthSq() < 1e-6) viewDir.set(0, 0, 1);
    viewDir.normalize();

    if (cmd.kind === 'frameNode') {
      const id = cmd.ids?.[0];
      const slot = id !== undefined ? slotOfId.get(id) : undefined;
      if (slot === undefined || slot >= count) return;
      desiredTarget.set(arr[slot * 3], arr[slot * 3 + 1], arr[slot * 3 + 2]);
      const dist = 16 + 5 * (scaleOfSlot[slot] || 1.1);
      desiredPos.copy(desiredTarget).addScaledVector(viewDir, dist);
      tweenActive.current = true;
      lastInteraction.current = performance.now(); // command = engagement
      return;
    }

    // frameSet / fitAll: bounding sphere over the id set (or every live slot)
    centroid.set(0, 0, 0);
    let n = 0;
    if (cmd.kind === 'fitAll') {
      for (let i = 0; i < count; i++) {
        centroid.x += arr[i * 3];
        centroid.y += arr[i * 3 + 1];
        centroid.z += arr[i * 3 + 2];
        n++;
      }
    } else {
      for (const id of cmd.ids ?? []) {
        const slot = slotOfId.get(id);
        if (slot === undefined || slot >= count) continue;
        centroid.x += arr[slot * 3];
        centroid.y += arr[slot * 3 + 1];
        centroid.z += arr[slot * 3 + 2];
        n++;
      }
    }
    if (n === 0) return;
    centroid.multiplyScalar(1 / n);

    let maxDistSq = 0;
    if (cmd.kind === 'fitAll') {
      for (let i = 0; i < count; i++) {
        const dx = arr[i * 3] - centroid.x;
        const dy = arr[i * 3 + 1] - centroid.y;
        const dz = arr[i * 3 + 2] - centroid.z;
        const d = dx * dx + dy * dy + dz * dz;
        if (d > maxDistSq) maxDistSq = d;
      }
    } else {
      for (const id of cmd.ids ?? []) {
        const slot = slotOfId.get(id);
        if (slot === undefined || slot >= count) continue;
        const dx = arr[slot * 3] - centroid.x;
        const dy = arr[slot * 3 + 1] - centroid.y;
        const dz = arr[slot * 3 + 2] - centroid.z;
        const d = dx * dx + dy * dy + dz * dz;
        if (d > maxDistSq) maxDistSq = d;
      }
    }
    const radius = Math.sqrt(maxDistSq);
    const fov = (camera as THREE.PerspectiveCamera).fov ?? 55;
    const dist = Math.max(
      40,
      (radius / Math.tan(THREE.MathUtils.degToRad(fov) / 2)) * 1.18,
    );
    desiredTarget.copy(centroid);
    desiredPos.copy(centroid).addScaledVector(viewDir, dist);
    tweenActive.current = true;
    lastInteraction.current = performance.now();
  };

  useFrame((state, delta) => {
    const controls = controlsRef.current;
    if (!controls) return;

    const ui = useUiStore.getState();
    const cmd = ui.cameraCommand;
    if (cmd && cmd.nonce !== lastNonce.current) {
      lastNonce.current = cmd.nonce;
      beginCommand(cmd, state.camera, controls);
    }

    if (tweenActive.current) {
      easing.damp3(state.camera.position, desiredPos, SMOOTH_TIME, delta);
      easing.damp3(controls.target, desiredTarget, SMOOTH_TIME, delta);
      if (
        state.camera.position.distanceToSquared(desiredPos) < ARRIVE_EPS_SQ &&
        controls.target.distanceToSquared(desiredTarget) < ARRIVE_EPS_SQ
      ) {
        tweenActive.current = false;
      }
    }

    // barely-perceptible idle orbit (spec §7.2), 3D only — and never for
    // users who asked the OS for reduced motion
    const idle =
      ui.dims === 3 &&
      !tweenActive.current &&
      !prefersReducedMotion() &&
      performance.now() - lastInteraction.current > IDLE_MS &&
      useGraphStore.getState().phase === 'ready';
    controls.autoRotate = idle;

    controls.update(); // damping + autoRotate need this every frame

    // Publish the pose for the Minimap overlay (plain object write, no React).
    cameraPose.px = state.camera.position.x;
    cameraPose.py = state.camera.position.y;
    cameraPose.pz = state.camera.position.z;
    cameraPose.tx = controls.target.x;
    cameraPose.ty = controls.target.y;
    cameraPose.tz = controls.target.z;
  });

  const onStart = (): void => {
    lastInteraction.current = performance.now();
    tweenActive.current = false; // user input cancels the active glide
  };
  const onEnd = (): void => {
    lastInteraction.current = performance.now();
  };

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      rotateSpeed={0.55}
      minDistance={8}
      maxDistance={1400}
      autoRotateSpeed={0.25}
      onStart={onStart}
      onEnd={onEnd}
    />
  );
}

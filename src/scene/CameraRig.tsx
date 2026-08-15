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
import { noteLocalCameraActivity, useCollabStore } from '../collab/store';
import type { CameraCommand } from '../store/uiStore';
import { positionBuffer, scaleOfSlot, slotOfId } from './positionBuffer';
import { cameraPose } from './cameraPose';
import { panInput } from './panInput';
import { prefersReducedMotion } from '../util/motion';
import { commitPendingFocusIf } from '../ui/focusNode';
import { decideFrameNode, isAlreadyNear, shouldCommitOnTweenCancel } from './cameraFocusPolicy';
import {
  computeFitAllPose,
  computeLiveFitAllPose,
  isIngestFraming,
  noteIngestCameraSteer,
  slotIsLive,
} from './ingestBirth';

const IDLE_MS = 10_000;
const SMOOTH_TIME = (CAMERA_GLIDE_MS / 1000) * 0.45; // ~800ms glide feel
/** First-ingest framing eases out slower so the growing set is followed, not yanked. */
const INGEST_SMOOTH_TIME = 1.15;
// Arrow-key pan rate as a fraction of the target distance per second, so the
// pan feels the same whether zoomed into one node or viewing the whole nebula.
const PAN_SPEED = 0.8;
const COLLAB_POSE_INTERVAL_MS = 100;

// module-level temps — single rig instance, zero per-frame allocations
const desiredPos = new THREE.Vector3();
const desiredTarget = new THREE.Vector3();
const viewDir = new THREE.Vector3();
const panRight = new THREE.Vector3();
const panUp = new THREE.Vector3();
const panDelta = new THREE.Vector3();

export function computeFrameNodePose(opts: {
  cameraPosition: THREE.Vector3;
  controlsTarget: THREE.Vector3;
  targetPosition: THREE.Vector3;
  viewDir: THREE.Vector3;
  nodeScale: number;
}): {
  desiredTarget: THREE.Vector3;
  desiredPos: THREE.Vector3;
  alreadyNear: boolean;
} {
  const desiredTarget = opts.targetPosition.clone();
  const desiredPos = desiredTarget
    .clone()
    .addScaledVector(opts.viewDir, 16 + 5 * (opts.nodeScale || 1.1));

  return {
    desiredTarget,
    desiredPos,
    alreadyNear: isAlreadyNear(
      opts.cameraPosition.distanceToSquared(desiredPos),
      opts.controlsTarget.distanceToSquared(desiredTarget),
    ),
  };
}

export default function CameraRig() {
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const dims = useUiStore((s) => s.dims);

  const lastNonce = useRef(0);
  const tweenActive = useRef(false);
  /** Node id of the in-flight frameNode command, for pending-focus commit. */
  const framingId = useRef<string | null>(null);
  const lastCollabPoseAt = useRef(0);
  /** positionBuffer.version last used for the ingest-framing fit recompute. */
  const lastFitVersion = useRef(-1);
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

    // Explicit pose (saved views): glide straight to the stored position and
    // target — no framing math, no dependence on current node positions.
    if (cmd.kind === 'pose') {
      if (!cmd.pose) return;
      framingId.current = null;
      desiredPos.set(cmd.pose.px, cmd.pose.py, cmd.pose.pz);
      desiredTarget.set(cmd.pose.tx, cmd.pose.ty, cmd.pose.tz);
      tweenActive.current = true;
      lastInteraction.current = performance.now();
      return;
    }

    // keep the current viewing direction; only distance/target change
    viewDir.copy(camera.position).sub(controls.target);
    if (viewDir.lengthSq() < 1e-6) viewDir.set(0, 0, 1);
    viewDir.normalize();

    if (cmd.kind === 'frameNode') {
      const id = cmd.ids?.[0];
      framingId.current = id ?? null;
      const slot = id !== undefined ? slotOfId.get(id) : undefined;
      // Positions refresh at tick rate: a freshly assigned slot can outrun the
      // buffer the worker last posted, so bound the read against the array too.
      const hasSlot = slot !== undefined && slot < count && slot * 3 + 2 < arr.length;
      if (!hasSlot) {
        // No layout slot — still open the panel so search/list picks work.
        commitPendingFocusIf(id);
        return;
      }
      const targetPoint = new THREE.Vector3(
        arr[slot * 3],
        arr[slot * 3 + 1],
        arr[slot * 3 + 2],
      );
      const pose = computeFrameNodePose({
        cameraPosition: camera.position.clone(),
        controlsTarget: controls.target.clone(),
        targetPosition: targetPoint,
        viewDir: viewDir.clone(),
        nodeScale: scaleOfSlot[slot] || 1.1,
      });
      desiredTarget.copy(pose.desiredTarget);
      desiredPos.copy(pose.desiredPos);
      lastInteraction.current = performance.now(); // command = engagement
      const decision = decideFrameNode({
        hasSlot: true,
        reducedMotion: prefersReducedMotion(),
        alreadyNear: pose.alreadyNear,
      });
      if (decision.action === 'commit') {
        if (decision.reason === 'reduced-motion') {
          camera.position.copy(desiredPos);
          controls.target.copy(desiredTarget);
        }
        tweenActive.current = false;
        commitPendingFocusIf(id);
        return;
      }
      tweenActive.current = true;
      return;
    }

    framingId.current = null;

    // frameSet / fitAll: bounding sphere over the id set (or every live slot)
    if (cmd.kind === 'fitAll') {
      const fov = (camera as THREE.PerspectiveCamera).fov ?? 55;
      const fit = computeLiveFitAllPose({
        viewDir: [viewDir.x, viewDir.y, viewDir.z],
        fovDeg: fov,
      });
      if (fit.radius === 0 && count === 0) return;
      desiredTarget.set(fit.target[0], fit.target[1], fit.target[2]);
      desiredPos.set(fit.position[0], fit.position[1], fit.position[2]);
      tweenActive.current = true;
      lastInteraction.current = performance.now();
      return;
    }

    const slots: number[] = [];
    for (const id of cmd.ids ?? []) {
      const slot = slotOfId.get(id);
      if (slot !== undefined && slot < count && slot * 3 + 2 < arr.length) slots.push(slot);
    }
    if (slots.length === 0) return;
    const fov = (camera as THREE.PerspectiveCamera).fov ?? 55;
    const fit = computeFitAllPose({
      array: arr,
      count,
      viewDir: [viewDir.x, viewDir.y, viewDir.z],
      fovDeg: fov,
      slots,
      isLive: slotIsLive,
    });
    desiredTarget.set(fit.target[0], fit.target[1], fit.target[2]);
    desiredPos.set(fit.position[0], fit.position[1], fit.position[2]);
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
      // Every explicit camera command takes ownership from live ingest
      // framing — a frameSet/fitAll issued during the follow would otherwise
      // be overwritten by the framing block on the same frame. (The final
      // fit sent by endIngestBirth arrives after framing has ended, so this
      // never cancels the ingest's own framing.)
      noteIngestCameraSteer();
      if (cmd.kind !== 'pose') noteLocalCameraActivity();
      beginCommand(cmd, state.camera, controls);
    }

    // First ingest of an empty corpus: keep the growing set framed (eased).
    // Incremental add never sets this flag — do not steal the camera.
    // Recompute only when the layout actually posted new positions
    // (positionBuffer.version): positions refresh at tick rate, so a
    // per-frame recompute just re-derived the identical fit between ticks.
    if (
      isIngestFraming() &&
      positionBuffer.count > 0 &&
      positionBuffer.version !== lastFitVersion.current
    ) {
      lastFitVersion.current = positionBuffer.version;
      viewDir.copy(state.camera.position).sub(controls.target);
      if (viewDir.lengthSq() < 1e-6) viewDir.set(0, 0, 1);
      viewDir.normalize();
      const fov = (state.camera as THREE.PerspectiveCamera).fov ?? 55;
      const fit = computeLiveFitAllPose({
        viewDir: [viewDir.x, viewDir.y, viewDir.z],
        fovDeg: fov,
      });
      desiredTarget.set(fit.target[0], fit.target[1], fit.target[2]);
      desiredPos.set(fit.position[0], fit.position[1], fit.position[2]);
      if (prefersReducedMotion()) {
        state.camera.position.copy(desiredPos);
        controls.target.copy(desiredTarget);
        tweenActive.current = false;
      } else {
        tweenActive.current = true;
      }
    }

    // Arrow-key pan (App writes the direction to panInput). Nudging BOTH the
    // camera and the orbit target by the same screen-space delta preserves the
    // orbit angle/distance, so controls.update() below leaves it untouched.
    if (panInput.x !== 0 || panInput.y !== 0) {
      noteLocalCameraActivity();
      if (useCollabStore.getState().followMode) {
        useCollabStore.getState().setFollowMode(false);
      }
      if (shouldCommitOnTweenCancel(tweenActive.current)) {
        commitPendingFocusIf(framingId.current ?? undefined);
      }
      noteIngestCameraSteer();
      tweenActive.current = false; // a manual pan cancels any active glide
      const cam = state.camera;
      const dist = Math.max(cam.position.distanceTo(controls.target), 1);
      const step = dist * PAN_SPEED * delta;
      panRight.set(1, 0, 0).applyQuaternion(cam.quaternion);
      panUp.set(0, 1, 0).applyQuaternion(cam.quaternion);
      panDelta
        .set(0, 0, 0)
        .addScaledVector(panRight, panInput.x * step)
        .addScaledVector(panUp, panInput.y * step);
      cam.position.add(panDelta);
      controls.target.add(panDelta);
      lastInteraction.current = performance.now(); // suppress idle auto-orbit
    }

    if (tweenActive.current) {
      const smooth = isIngestFraming() ? INGEST_SMOOTH_TIME : SMOOTH_TIME;
      easing.damp3(state.camera.position, desiredPos, smooth, delta);
      easing.damp3(controls.target, desiredTarget, smooth, delta);
      if (
        isAlreadyNear(
          state.camera.position.distanceToSquared(desiredPos),
          controls.target.distanceToSquared(desiredTarget),
        )
      ) {
        tweenActive.current = false;
        commitPendingFocusIf(framingId.current ?? undefined);
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
    const persp = state.camera as THREE.PerspectiveCamera;
    cameraPose.fov = persp.fov ?? 55;
    cameraPose.aspect = persp.aspect ?? 16 / 9;
    cameraPose.controlsEnabled = controls.enabled;

    const now = performance.now();
    if (now - lastCollabPoseAt.current >= COLLAB_POSE_INTERVAL_MS) {
      lastCollabPoseAt.current = now;
      useCollabStore.getState().syncCameraPose();
    }
  });

  const onStart = (): void => {
    noteLocalCameraActivity();
    if (useCollabStore.getState().followMode) {
      useCollabStore.getState().setFollowMode(false);
    }
    lastInteraction.current = performance.now();
    if (shouldCommitOnTweenCancel(tweenActive.current)) {
      commitPendingFocusIf(framingId.current ?? undefined);
    }
    noteIngestCameraSteer();
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
      // Mouse/touch never pans — the drag gesture always orbits around the
      // nebula's current target (whole-sphere rotation). Panning is still
      // available via the arrow keys (see panInput.ts).
      enablePan={false}
      onStart={onStart}
      onEnd={onEnd}
    />
  );
}

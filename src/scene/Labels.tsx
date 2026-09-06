/**
 * Distance-culled SDF labels (spec §7.1): a fixed pool of LABEL_BUDGET drei
 * <Text> instances (troika under the hood) assigned every ~120ms to the
 * nearest in-frustum nodes, plus two reserved instances so the hovered and
 * selected nodes are ALWAYS labeled at full opacity and can never be evicted.
 *
 * Pool entries are mounted once and mutated imperatively (.text + .sync());
 * mounting/unmounting Text per frame would thrash troika's glyph atlas.
 *
 * Labels retain a readable CSS-pixel size at both overview and close zoom.
 * A screen-space collision pass protects focused titles first, then keeps
 * only separated ordinary labels. Node picking is independent of this pool.
 */

import { Suspense, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { Text } from '@react-three/drei';
import { LABEL_BUDGET } from '../config';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';
import { idOfSlot, positionBuffer, scaleOfSlot, slotOfId } from './positionBuffer';
import { slotMeta } from './Nodes';
import { FLAT_BG, FLAT_LABEL, FLAT_LABEL_MUTED, FLAT_SELECTION, VOID } from './palette';
import { selectedDocumentTitle } from '../pipeline/codeLanguage';
import {
  flatLabelBudget,
  flatLabelOpacity,
  flatLabelPriority,
} from './flatLabelPolicy';
import { labelBounds, labelsOverlap, labelWorldScale, type LabelBounds } from './labelLayout';
import { cameraPose } from './cameraPose';
import { prefersReducedMotion } from '../util/motion';
import { slotHasMaterialized, writeSlotTravelPosition } from './ingestBirth';
import { computeEmphasis } from './emphasis';

const REFRESH_MS = 120;
const TRUNCATE_AT = 34;
const DEGRADED_BUDGET = 15; // qualityTier >= 3
const LABEL_COLOR = '#d3dfed';
const FONT_SIZE = 2.3;
const LABEL_PIXELS = 12;
const FOCUSED_LABEL_PIXELS = 14;
// Bundled locally (public/fonts, OFL-1.1) — troika's default font is a CDN
// fetch, which the privacy CSP blocks and offline use can't reach.
const LABEL_FONT = '/fonts/Inter-Regular.woff';
// Flat labels sit beside their dot; both views share the interface typeface.
const FLAT_GAP = 2.15; // world units between dot edge and label
// Everything in 2D sits on the z=0 plane, so node spheres (radius up to 3.5
// toward the camera) would z-clip the glyph quads — lift labels off the plane
// and skip the depth test so text always reads over dots and edges.
const FLAT_LIFT = 2.5;
// Scaled with the layout's shell radius (layout.worker.ts) — a wider nebula
// means larger typical camera distances, so the fade band moves out with it.
const NEAR_FULL = 75; // full opacity inside this camera distance...
const FAR_FAINT = 320; // ...fading to a readable muted tone out here

/** troika text mesh surface we mutate imperatively */
interface TroikaLabel extends THREE.Mesh {
  text: string;
  fillOpacity: number;
  sync: (onSync?: () => void) => void;
}

// module-level temps — zero per-frame allocations
const projScreen = new THREE.Matrix4();
const frustum = new THREE.Frustum();
const tmpVec = new THREE.Vector3();
const viewPosition = new THREE.Vector3();
const labelTravel = { x: 0, y: 0, z: 0 };
const CANDIDATE_BUDGET = LABEL_BUDGET * 4;
const bestD2 = new Float64Array(CANDIDATE_BUDGET);
const bestSlot = new Int32Array(CANDIDATE_BUDGET);

function truncate(title: string): string {
  return title.length > TRUNCATE_AT ? `${title.slice(0, TRUNCATE_AT - 1)}…` : title;
}

function opacityFor(distance: number): number {
  return THREE.MathUtils.clamp(
    1 - ((distance - NEAR_FULL) / (FAR_FAINT - NEAR_FULL)) * 0.3,
    0.7,
    1,
  );
}

function labelProps(reserved: boolean, flat: boolean, maxWidth: number) {
  return {
    font: LABEL_FONT,
    fontSize: FONT_SIZE,
    maxWidth: (maxWidth / (reserved ? FOCUSED_LABEL_PIXELS : LABEL_PIXELS)) * FONT_SIZE,
    overflowWrap: 'break-word' as const,
    lineHeight: 1.35,
    color: flat ? (reserved ? FLAT_LABEL : FLAT_LABEL_MUTED) : LABEL_COLOR,
    outlineWidth: 0.12,
    outlineColor: flat ? FLAT_BG : VOID,
    outlineOpacity: 1,
    anchorX: (flat ? 'left' : 'center') as 'left' | 'center',
    anchorY: (flat ? 'middle' : 'bottom') as 'middle' | 'bottom',
    visible: false,
    renderOrder: reserved ? 11 : 10,
    'material-toneMapped': false,
    'material-depthWrite': false,
    'material-depthTest': !flat && !reserved,
  };
}

export default function Labels() {
  // 2D star chart restyle (font/color/anchoring) — re-render swaps the props
  const flat = useUiStore((s) => s.dims === 2);
  const size = useThree((s) => s.size);
  const maxLabelWidth = Math.max(120, Math.min(360, size.width - 48));
  const poolRefs = useRef<(TroikaLabel | null)[]>(Array(LABEL_BUDGET).fill(null));
  const hoverRef = useRef<TroikaLabel | null>(null);
  const selectedRef = useRef<TroikaLabel | null>(null);

  const assignedSlot = useRef(new Int32Array(LABEL_BUDGET).fill(-1));
  const hoverSlot = useRef(-1);
  const selectedSlot = useRef(-1);
  const titleOfSlot = useRef<string[]>([]);
  const displayTitleOfSlot = useRef<string[]>([]);
  const degreeOfSlot = useRef<number[]>([]);
  const titlesDirty = useRef(true);
  const labelsDirty = useRef(true);
  const lastCount = useRef(-1);
  const occupiedBounds = useRef<LabelBounds[]>([]);
  const accumulator = useRef(REFRESH_MS); // refresh on first frame

  useEffect(() => {
    const offGraph = useGraphStore.subscribe((s, prev) => {
      if (s.nodes !== prev.nodes) {
        titlesDirty.current = true;
        labelsDirty.current = true;
      }
    });
    const offUi = useUiStore.subscribe((s, prev) => {
      if (
        s.hoveredId !== prev.hoveredId ||
        s.selectedId !== prev.selectedId ||
        s.searchResults !== prev.searchResults ||
        s.filter !== prev.filter ||
        s.qualityTier !== prev.qualityTier ||
        s.topicNodesEnabled !== prev.topicNodesEnabled ||
        s.clusterCollapsed !== prev.clusterCollapsed
      ) {
        labelsDirty.current = true;
      }
    });
    return () => {
      offGraph();
      offUi();
    };
  }, []);

  const refreshTitles = (): void => {
    const { nodes } = useGraphStore.getState();
    // Rebuild from scratch: freed slots (removed nodes) must not keep stale
    // titles, or the pool renders phantom labels at their old positions.
    titleOfSlot.current = [];
    displayTitleOfSlot.current = [];
    degreeOfSlot.current = [];
    for (const n of nodes) {
      const slot = slotOfId.get(n.id);
      if (slot !== undefined) {
        titleOfSlot.current[slot] = n.title;
        displayTitleOfSlot.current[slot] = selectedDocumentTitle(n);
        degreeOfSlot.current[slot] = n.degree;
      }
    }
  };

  const applyText = (label: TroikaLabel, text: string, opacity: number): void => {
    if (label.text !== text) {
      label.text = text;
      label.sync();
    }
    label.fillOpacity = opacity;
    label.visible = true;
  };

  /** Re-rank: nearest in-frustum titled slots win the pool (every ~120ms). */
  const refresh = (camera: THREE.Camera): void => {
    if (titlesDirty.current) {
      refreshTitles();
      titlesDirty.current = false;
    }
    const { hoveredId, selectedId, searchResults, filter, qualityTier, topicNodesEnabled, clusterCollapsed } =
      useUiStore.getState();
    const { nodes, edges } = useGraphStore.getState();
    const emphasis = computeEmphasis(nodes, edges, hoveredId, selectedId, searchResults, filter);

    // In cluster-collapse mode individual labels are hidden (super-node labels render in ClusterCollapse)
    if (clusterCollapsed) {
      for (let j = 0; j < LABEL_BUDGET; j++) {
        const label = poolRefs.current[j];
        if (label) label.visible = false;
      }
      const hover = hoverRef.current;
      if (hover) hover.visible = false;
      const selected = selectedRef.current;
      if (selected) selected.visible = false;
      labelsDirty.current = false;
      return;
    }

    const count = positionBuffer.count;
    const titles = titleOfSlot.current;
    const cameraDistance = Math.hypot(
      camera.position.x - cameraPose.tx,
      camera.position.y - cameraPose.ty,
      camera.position.z - cameraPose.tz,
    );
    const budget = flat
      ? flatLabelBudget(cameraDistance, count, qualityTier, LABEL_BUDGET)
      : qualityTier >= 3
        ? Math.min(DEGRADED_BUDGET, LABEL_BUDGET)
        : LABEL_BUDGET;
    const candidateBudget = Math.min(CANDIDATE_BUDGET, budget * 4);
    const now = performance.now();
    const reducedMotion = prefersReducedMotion();

    hoverSlot.current = hoveredId ? (slotOfId.get(hoveredId) ?? -1) : -1;
    selectedSlot.current = selectedId ? (slotOfId.get(selectedId) ?? -1) : -1;

    projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projScreen);

    let filled = 0;
    for (let i = 0; i < count; i++) {
      if (i === hoverSlot.current || i === selectedSlot.current) continue; // reserved
      if (slotMeta.kind[i] === 1 && !topicNodesEnabled) continue; // hidden topic node
      if (!titles[i]) continue;
      if (!slotHasMaterialized(i, now)) continue; // pre-spawn: no label on an invisible node
      writeSlotTravelPosition(labelTravel, i, now, { reducedMotion, flat });
      tmpVec.set(labelTravel.x, labelTravel.y, labelTravel.z);
      if (!frustum.containsPoint(tmpVec)) continue;
      const d2 = tmpVec.distanceToSquared(camera.position);
      const priority = flat
        ? flatLabelPriority(d2, degreeOfSlot.current[i] ?? 0)
        : d2;
      if (filled === candidateBudget && priority >= bestD2[filled - 1]) continue;
      let j = Math.min(filled, candidateBudget - 1);
      while (j > 0 && bestD2[j - 1] > priority) {
        bestD2[j] = bestD2[j - 1];
        bestSlot[j] = bestSlot[j - 1];
        j--;
      }
      bestD2[j] = priority;
      bestSlot[j] = i;
      if (filled < candidateBudget) filled++;
    }

    // Reserved labels: always on, full opacity, FULL title (spec §7.1).
    const hover = hoverRef.current;
    if (hover) {
      const slot = hoverSlot.current;
      if (slot >= 0 && slot < count && titles[slot]) {
        const hoverText =
          slot === selectedSlot.current
            ? (displayTitleOfSlot.current[slot] ?? titles[slot])
            : titles[slot];
        applyText(hover, hoverText, 1);
      } else hover.visible = false;
    }
    const selected = selectedRef.current;
    if (selected) {
      const slot = selectedSlot.current;
      const selectedTitle = displayTitleOfSlot.current[slot] ?? titles[slot];
      // when hovered === selected the hover label already covers it
      if (slot >= 0 && slot < count && slot !== hoverSlot.current && selectedTitle) {
        applyText(selected, selectedTitle, 1);
      } else {
        selected.visible = false;
      }
    }

    const occupied = occupiedBounds.current;
    occupied.length = 0;
    const screenBounds = (label: TroikaLabel, text: string, reserved: boolean): LabelBounds => {
      tmpVec.copy(label.position).project(camera);
      return labelBounds(
        (tmpVec.x + 1) * size.width / 2,
        (1 - tmpVec.y) * size.height / 2,
        text,
        reserved ? FOCUSED_LABEL_PIXELS : LABEL_PIXELS,
        flat,
        maxLabelWidth,
      );
    };
    // Protect the full focused titles before choosing ordinary nearby labels.
    if (hover?.visible) {
      place(hover, hoverSlot.current, camera, true);
      occupied.push(screenBounds(hover, hover.text, true));
    }
    if (selected?.visible) {
      place(selected, selectedSlot.current, camera, true);
      occupied.push(screenBounds(selected, selected.text, true));
    }
    let shown = 0;
    for (let j = 0; j < filled && shown < budget; j++) {
      const label = poolRefs.current[shown];
      if (!label) break;
      const slot = bestSlot[j];
      const title = truncate(titles[slot]);
      place(label, slot, camera);
      const bounds = screenBounds(label, title, false);
      if (
        bounds.left < 8 || bounds.right > size.width - 8 ||
        bounds.top < 8 || bounds.bottom > size.height - 8 ||
        occupied.some((other) => labelsOverlap(bounds, other))
      ) continue;
      occupied.push(bounds);
      assignedSlot.current[shown] = slot;
      const opacity = flat ? flatLabelOpacity(cameraDistance) : opacityFor(Math.sqrt(bestD2[j]));
      const dimmed = emphasis !== null && !emphasis.has(idOfSlot[slot] ?? '');
      applyText(label, title, opacity * (dimmed ? 0.28 : 1));
      shown++;
    }
    for (let j = shown; j < LABEL_BUDGET; j++) {
      assignedSlot.current[j] = -1;
      const label = poolRefs.current[j];
      if (label) label.visible = false;
    }
  };

  /** Cheap per-frame pass: track node motion + billboard toward the camera. */
  const place = (label: TroikaLabel, slot: number, camera: THREE.Camera, reserved = false): void => {
    writeSlotTravelPosition(labelTravel, slot, performance.now(), {
      reducedMotion: prefersReducedMotion(),
      flat,
    });
    if (flat) {
      // star chart: label sits to the RIGHT of the dot, vertically centered
      label.position.set(
        labelTravel.x + (scaleOfSlot[slot] || 1.1) + FLAT_GAP,
        labelTravel.y,
        labelTravel.z + FLAT_LIFT,
      );
    } else {
      label.position.set(
        labelTravel.x,
        labelTravel.y + (scaleOfSlot[slot] || 1.1) + 1.6,
        labelTravel.z,
      );
    }
    viewPosition.copy(label.position).applyMatrix4(camera.matrixWorldInverse);
    label.scale.setScalar(labelWorldScale(
      FONT_SIZE,
      reserved ? FOCUSED_LABEL_PIXELS : LABEL_PIXELS,
      -viewPosition.z,
      camera.projectionMatrix.elements[5],
      size.height,
    ));
    label.quaternion.copy(camera.quaternion);
  };

  useFrame((state, delta) => {
    const count = positionBuffer.count;
    if (count !== lastCount.current) {
      lastCount.current = count;
      titlesDirty.current = true;
      labelsDirty.current = true;
    }
    accumulator.current += delta * 1000;
    if (accumulator.current >= REFRESH_MS || labelsDirty.current) {
      accumulator.current = 0;
      labelsDirty.current = false;
      refresh(state.camera);
    }
    for (let j = 0; j < LABEL_BUDGET; j++) {
      const label = poolRefs.current[j];
      const slot = assignedSlot.current[j];
      if (label?.visible && slot >= 0) place(label, slot, state.camera);
    }
    const hover = hoverRef.current;
    if (hover?.visible && hoverSlot.current >= 0) {
      place(hover, hoverSlot.current, state.camera, true);
    }
    const selected = selectedRef.current;
    if (selected?.visible && selectedSlot.current >= 0) {
      place(selected, selectedSlot.current, state.camera, true);
    }
  });

  return (
    <Suspense fallback={null}>
      <group>
        {Array.from({ length: LABEL_BUDGET }, (_, i) => (
          <Text
            key={i}
            ref={(t: TroikaLabel | null) => {
              poolRefs.current[i] = t;
            }}
            {...labelProps(false, flat, maxLabelWidth)}
          >
            {''}
          </Text>
        ))}
        <Text
          ref={(t: TroikaLabel | null) => {
            hoverRef.current = t;
          }}
          {...labelProps(true, flat, maxLabelWidth)}
          color={flat ? FLAT_SELECTION : LABEL_COLOR}
        >
          {''}
        </Text>
        <Text
          ref={(t: TroikaLabel | null) => {
            selectedRef.current = t;
          }}
          {...labelProps(true, flat, maxLabelWidth)}
        >
          {''}
        </Text>
      </group>
    </Suspense>
  );
}

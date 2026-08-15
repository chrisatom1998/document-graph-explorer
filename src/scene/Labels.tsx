/**
 * Distance-culled SDF labels (spec §7.1): a fixed pool of LABEL_BUDGET drei
 * <Text> instances (troika under the hood) assigned every ~120ms to the
 * nearest in-frustum nodes, plus two reserved instances so the hovered and
 * selected nodes are ALWAYS labeled at full opacity and can never be evicted.
 *
 * Pool entries are mounted once and mutated imperatively (.text + .sync());
 * mounting/unmounting Text per frame would thrash troika's glyph atlas.
 *
 * BLOOM TENSION (documented per spec §9 "labels must stay readable"):
 * labels must NOT feed the bloom pass. Bloom in Effects.tsx uses
 * luminanceThreshold 0.32 and the label color below sits near that line —
 * #c9cfee has enough blue to pick up a faint halo, which reads as "glow",
 * not "smear". If labels ever bloom too hard: darken LABEL_COLOR first,
 * raise the Effects luminanceThreshold second (raising it too far kills the
 * halo glow on cool-hued clusters, which have low relative luminance).
 */

import { Suspense, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Text } from '@react-three/drei';
import { LABEL_BUDGET, MAX_NODES } from '../config';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';
import { positionBuffer, scaleOfSlot, slotOfId } from './positionBuffer';
import { kindOfSlot } from './Nodes';
import { FLAT_BG, FLAT_LABEL, FLAT_LABEL_MUTED, FLAT_SELECTION, VOID } from './palette';
import { selectedDocumentTitle } from '../pipeline/codeLanguage';
import { prefersReducedMotion } from '../util/motion';
import { slotHasMaterialized, writeSlotTravelPosition } from './ingestBirth';

const REFRESH_MS = 120;
const TRUNCATE_AT = 34;
const DEGRADED_BUDGET = 15; // qualityTier >= 3
const LABEL_COLOR = '#c9cfee'; // see bloom-tension note above
// Bundled locally (public/fonts, OFL-1.1) — troika's default font is a CDN
// fetch, which the privacy CSP blocks and offline use can't reach.
const LABEL_FONT = '/fonts/Inter-Regular.woff';
// 2D star chart: monospace labels beside the dot (anchored left, centered
// vertically) instead of above it — same pool/eviction machinery.
const FLAT_FONT = '/fonts/JetBrainsMono-Regular.ttf';
const FLAT_GAP = 1.85; // world units between dot edge and label
// Everything in 2D sits on the z=0 plane, so node spheres (radius up to 1.3
// toward the camera) would z-clip the glyph quads — lift labels off the plane
// and skip the depth test so text always reads over dots and edges.
const FLAT_LIFT = 2.5;
// Scaled with the layout's shell radius (layout.worker.ts) — a wider nebula
// means larger typical camera distances, so the fade band moves out with it.
const NEAR_FULL = 75; // full opacity inside this camera distance...
const FAR_FAINT = 320; // ...fading to 0.15 out here

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
const labelTravel = { x: 0, y: 0, z: 0 };
const bestD2 = new Float64Array(LABEL_BUDGET);
const bestSlot = new Int32Array(LABEL_BUDGET);
// Sticky assignment scratch (cleared each refresh): candidate slots of this
// re-rank, and slot -> pool label index for slots that keep/gain a label.
const candidateSlots = new Set<number>();
const slotToLabel = new Map<number, number>();
// Hysteresis: a slot already showing a label survives while within ~1.25x the
// DISTANCE of the worst admitted candidate (compared in squared space below).
// Binding pool index j to rank j meant small camera motion permuted ranks and
// swapped which node each label belonged to, firing troika's async sync() and
// rendering blank/stale text for frames.
const STICKY_DISTANCE_RATIO = 1.25;
const STICKY_D2 = STICKY_DISTANCE_RATIO * STICKY_DISTANCE_RATIO;

function truncate(title: string): string {
  return title.length > TRUNCATE_AT ? `${title.slice(0, TRUNCATE_AT - 1)}…` : title;
}

function opacityFor(distance: number): number {
  return THREE.MathUtils.clamp(
    1 - ((distance - NEAR_FULL) / (FAR_FAINT - NEAR_FULL)) * 0.85,
    0.15,
    1,
  );
}

function labelProps(reserved: boolean, flat: boolean) {
  return {
    font: flat ? FLAT_FONT : LABEL_FONT,
    fontSize: flat ? 2.35 : 2.3,
    color: flat ? (reserved ? FLAT_LABEL : FLAT_LABEL_MUTED) : LABEL_COLOR,
    outlineWidth: flat ? 0.14 : 0.06,
    outlineColor: flat ? FLAT_BG : VOID,
    outlineOpacity: flat ? 1 : 0.85,
    anchorX: (flat ? 'left' : 'center') as 'left' | 'center',
    anchorY: (flat ? 'middle' : 'bottom') as 'middle' | 'bottom',
    visible: false,
    renderOrder: reserved ? 11 : 10,
    'material-toneMapped': false,
    'material-depthWrite': false,
    'material-depthTest': !flat, // see FLAT_LIFT note
  };
}

export default function Labels() {
  // 2D star chart restyle (font/color/anchoring) — re-render swaps the props
  const flat = useUiStore((s) => s.dims === 2);
  const poolRefs = useRef<(TroikaLabel | null)[]>(Array(LABEL_BUDGET).fill(null));
  const hoverRef = useRef<TroikaLabel | null>(null);
  const selectedRef = useRef<TroikaLabel | null>(null);

  const assignedSlot = useRef(new Int32Array(LABEL_BUDGET).fill(-1));
  const hoverSlot = useRef(-1);
  const selectedSlot = useRef(-1);
  const titleOfSlot = useRef<string[]>([]);
  const displayTitleOfSlot = useRef<string[]>([]);
  const titlesDirty = useRef(true);
  const labelsDirty = useRef(true);
  /** Hover/selection changed: only the two reserved labels need retargeting. */
  const reservedDirty = useRef(false);
  const lastCount = useRef(-1);
  const accumulator = useRef(REFRESH_MS); // refresh on first frame

  useEffect(() => {
    const offGraph = useGraphStore.subscribe((s, prev) => {
      if (s.nodes !== prev.nodes) {
        titlesDirty.current = true;
        labelsDirty.current = true;
      }
    });
    const offUi = useUiStore.subscribe((s, prev) => {
      // Hover/selection only move the two reserved labels — a full pool
      // re-rank (and its batch of troika sync() calls) per hover transition
      // is exactly the flicker this flag split avoids.
      if (s.hoveredId !== prev.hoveredId || s.selectedId !== prev.selectedId) {
        reservedDirty.current = true;
      }
      if (
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
    for (const n of nodes) {
      const slot = slotOfId.get(n.id);
      if (slot !== undefined && slot < MAX_NODES) {
        titleOfSlot.current[slot] = n.title;
        displayTitleOfSlot.current[slot] = selectedDocumentTitle(n);
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
    const { hoveredId, selectedId, qualityTier, topicNodesEnabled, clusterCollapsed } =
      useUiStore.getState();

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

    const budget = qualityTier >= 3 ? Math.min(DEGRADED_BUDGET, LABEL_BUDGET) : LABEL_BUDGET;
    const count = Math.min(positionBuffer.count, MAX_NODES);
    const titles = titleOfSlot.current;
    const now = performance.now();
    const reducedMotion = prefersReducedMotion();

    hoverSlot.current = hoveredId ? (slotOfId.get(hoveredId) ?? -1) : -1;
    selectedSlot.current = selectedId ? (slotOfId.get(selectedId) ?? -1) : -1;

    projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projScreen);

    let filled = 0;
    for (let i = 0; i < count; i++) {
      if (i === hoverSlot.current || i === selectedSlot.current) continue; // reserved
      if (kindOfSlot[i] === 1 && !topicNodesEnabled) continue; // hidden topic node
      if (!titles[i]) continue;
      if (!slotHasMaterialized(i, now)) continue; // pre-spawn: no label on an invisible node
      writeSlotTravelPosition(labelTravel, i, now, { reducedMotion, flat });
      tmpVec.set(labelTravel.x, labelTravel.y, labelTravel.z);
      if (!frustum.containsPoint(tmpVec)) continue;
      const d2 = tmpVec.distanceToSquared(camera.position);
      if (filled === budget && d2 >= bestD2[filled - 1]) continue;
      let j = Math.min(filled, budget - 1);
      while (j > 0 && bestD2[j - 1] > d2) {
        bestD2[j] = bestD2[j - 1];
        bestSlot[j] = bestSlot[j - 1];
        j--;
      }
      bestD2[j] = d2;
      bestSlot[j] = i;
      if (filled < budget) filled++;
    }

    // ---- sticky assignment: keep, evict, then hand freed labels to newcomers.
    candidateSlots.clear();
    for (let r = 0; r < filled; r++) candidateSlots.add(bestSlot[r]);
    const keepD2 = filled > 0 ? bestD2[filled - 1] * STICKY_D2 : 0;

    // Pass 1: a label already showing a still-eligible slot keeps it while
    // the slot is an admitted candidate OR within the hysteresis band of the
    // worst admitted distance — same node, same text, no sync() churn.
    slotToLabel.clear();
    for (let j = 0; j < LABEL_BUDGET; j++) {
      const label = poolRefs.current[j];
      if (!label) continue;
      const slot = assignedSlot.current[j];
      let keep = false;
      if (
        slot >= 0 &&
        j < budget && // a shrunken (degraded) budget evicts the tail
        slot < count &&
        slot !== hoverSlot.current &&
        slot !== selectedSlot.current &&
        titles[slot] &&
        !(kindOfSlot[slot] === 1 && !topicNodesEnabled) &&
        slotHasMaterialized(slot, now)
      ) {
        writeSlotTravelPosition(labelTravel, slot, now, { reducedMotion, flat });
        tmpVec.set(labelTravel.x, labelTravel.y, labelTravel.z);
        if (frustum.containsPoint(tmpVec)) {
          const d2 = tmpVec.distanceToSquared(camera.position);
          if (candidateSlots.has(slot) || d2 <= keepD2) {
            keep = true;
            slotToLabel.set(slot, j);
            applyText(label, truncate(titles[slot]), opacityFor(Math.sqrt(d2)));
          }
        }
      }
      if (!keep) {
        assignedSlot.current[j] = -1;
        label.visible = false;
      }
    }

    // Pass 2: nearest unshown candidates take the freed label indices.
    let shown = slotToLabel.size;
    let nextFree = 0;
    for (let r = 0; r < filled && shown < budget; r++) {
      const slot = bestSlot[r];
      if (slotToLabel.has(slot)) continue;
      while (
        nextFree < budget &&
        (assignedSlot.current[nextFree] !== -1 || !poolRefs.current[nextFree])
      ) {
        nextFree++;
      }
      if (nextFree >= budget) break;
      const label = poolRefs.current[nextFree];
      if (!label) break; // unreachable: the scan above skipped unmounted refs
      assignedSlot.current[nextFree] = slot;
      slotToLabel.set(slot, nextFree);
      applyText(label, truncate(titles[slot]), opacityFor(Math.sqrt(bestD2[r])));
      shown++;
      nextFree++;
    }

    applyReservedLabels(count);
  };

  /** Reserved labels: always on, full opacity, FULL title (spec §7.1). */
  const applyReservedLabels = (count: number): void => {
    const titles = titleOfSlot.current;
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
  };

  /**
   * Hover/selection-only update between re-ranks: retarget the two reserved
   * labels without touching the pool (no full re-rank, no sync() batch). A
   * pool label already on a newly reserved slot is hidden so the text isn't
   * doubled under the full-opacity reserved label; the freed index refills at
   * the next periodic refresh (<= REFRESH_MS away).
   */
  const refreshReserved = (): void => {
    if (titlesDirty.current) {
      refreshTitles();
      titlesDirty.current = false;
    }
    const { hoveredId, selectedId, clusterCollapsed } = useUiStore.getState();
    hoverSlot.current = hoveredId ? (slotOfId.get(hoveredId) ?? -1) : -1;
    selectedSlot.current = selectedId ? (slotOfId.get(selectedId) ?? -1) : -1;
    if (clusterCollapsed) {
      if (hoverRef.current) hoverRef.current.visible = false;
      if (selectedRef.current) selectedRef.current.visible = false;
      return;
    }
    for (let j = 0; j < LABEL_BUDGET; j++) {
      const slot = assignedSlot.current[j];
      if (slot >= 0 && (slot === hoverSlot.current || slot === selectedSlot.current)) {
        assignedSlot.current[j] = -1;
        const label = poolRefs.current[j];
        if (label) label.visible = false;
      }
    }
    applyReservedLabels(Math.min(positionBuffer.count, MAX_NODES));
  };

  /** Cheap per-frame pass: track node motion + billboard toward the camera. */
  const place = (label: TroikaLabel, slot: number, camera: THREE.Camera): void => {
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
      label.scale.setScalar(1.05);
    } else {
      label.position.set(
        labelTravel.x,
        labelTravel.y + (scaleOfSlot[slot] || 1.1) + 1.6,
        labelTravel.z,
      );
      label.scale.setScalar(1);
    }
    label.quaternion.copy(camera.quaternion);
  };

  useFrame((state, delta) => {
    const count = Math.min(positionBuffer.count, MAX_NODES);
    if (count !== lastCount.current) {
      lastCount.current = count;
      titlesDirty.current = true;
      labelsDirty.current = true;
    }
    accumulator.current += delta * 1000;
    if (accumulator.current >= REFRESH_MS || labelsDirty.current) {
      accumulator.current = 0;
      labelsDirty.current = false;
      reservedDirty.current = false; // refresh re-derives the reserved labels too
      refresh(state.camera);
    } else if (reservedDirty.current) {
      reservedDirty.current = false;
      refreshReserved();
    }
    for (let j = 0; j < LABEL_BUDGET; j++) {
      const label = poolRefs.current[j];
      const slot = assignedSlot.current[j];
      if (label?.visible && slot >= 0) place(label, slot, state.camera);
    }
    const hover = hoverRef.current;
    if (hover?.visible && hoverSlot.current >= 0) {
      place(hover, hoverSlot.current, state.camera);
    }
    const selected = selectedRef.current;
    if (selected?.visible && selectedSlot.current >= 0) {
      place(selected, selectedSlot.current, state.camera);
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
            {...labelProps(false, flat)}
          >
            {''}
          </Text>
        ))}
        <Text
          ref={(t: TroikaLabel | null) => {
            hoverRef.current = t;
          }}
          {...labelProps(true, flat)}
          color={flat ? FLAT_SELECTION : LABEL_COLOR}
        >
          {''}
        </Text>
        <Text
          ref={(t: TroikaLabel | null) => {
            selectedRef.current = t;
          }}
          {...labelProps(true, flat)}
        >
          {''}
        </Text>
      </group>
    </Suspense>
  );
}

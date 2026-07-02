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

const REFRESH_MS = 120;
const TRUNCATE_AT = 34;
const DEGRADED_BUDGET = 15; // qualityTier >= 3
const LABEL_COLOR = '#c9cfee'; // see bloom-tension note above
// Bundled locally (public/fonts, OFL-1.1) — troika's default font is a CDN
// fetch, which the privacy CSP blocks and offline use can't reach.
const LABEL_FONT = '/fonts/Inter-Regular.woff';
const NEAR_FULL = 60; // full opacity inside this camera distance...
const FAR_FAINT = 260; // ...fading to 0.15 out here

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
const bestD2 = new Float64Array(LABEL_BUDGET);
const bestSlot = new Int32Array(LABEL_BUDGET);

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

function labelProps(reserved: boolean) {
  return {
    font: LABEL_FONT,
    fontSize: 2.3,
    color: LABEL_COLOR,
    outlineWidth: 0.06,
    outlineColor: '#050510',
    outlineOpacity: 0.85,
    anchorX: 'center' as const,
    anchorY: 'bottom' as const,
    visible: false,
    renderOrder: reserved ? 11 : 10,
    'material-toneMapped': false,
    'material-depthWrite': false,
  };
}

export default function Labels() {
  const poolRefs = useRef<(TroikaLabel | null)[]>(Array(LABEL_BUDGET).fill(null));
  const hoverRef = useRef<TroikaLabel | null>(null);
  const selectedRef = useRef<TroikaLabel | null>(null);

  const assignedSlot = useRef(new Int32Array(LABEL_BUDGET).fill(-1));
  const hoverSlot = useRef(-1);
  const selectedSlot = useRef(-1);
  const titleOfSlot = useRef<string[]>([]);
  const titlesDirty = useRef(true);
  const labelsDirty = useRef(true);
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
      if (
        s.hoveredId !== prev.hoveredId ||
        s.selectedId !== prev.selectedId ||
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
    for (const n of nodes) {
      const slot = slotOfId.get(n.id);
      if (slot !== undefined && slot < MAX_NODES) titleOfSlot.current[slot] = n.title;
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
    const arr = positionBuffer.array;
    const titles = titleOfSlot.current;

    hoverSlot.current = hoveredId ? (slotOfId.get(hoveredId) ?? -1) : -1;
    selectedSlot.current = selectedId ? (slotOfId.get(selectedId) ?? -1) : -1;

    projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projScreen);

    let filled = 0;
    for (let i = 0; i < count; i++) {
      if (i === hoverSlot.current || i === selectedSlot.current) continue; // reserved
      if (kindOfSlot[i] === 1 && !topicNodesEnabled) continue; // hidden topic node
      if (!titles[i]) continue;
      tmpVec.set(arr[i * 3], arr[i * 3 + 1], arr[i * 3 + 2]);
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

    for (let j = 0; j < LABEL_BUDGET; j++) {
      const label = poolRefs.current[j];
      if (!label) continue;
      if (j >= filled) {
        assignedSlot.current[j] = -1;
        label.visible = false;
        continue;
      }
      const slot = bestSlot[j];
      assignedSlot.current[j] = slot;
      applyText(label, truncate(titles[slot]), opacityFor(Math.sqrt(bestD2[j])));
    }

    // Reserved labels: always on, full opacity, FULL title (spec §7.1).
    const hover = hoverRef.current;
    if (hover) {
      const slot = hoverSlot.current;
      if (slot >= 0 && slot < count && titles[slot]) applyText(hover, titles[slot], 1);
      else hover.visible = false;
    }
    const selected = selectedRef.current;
    if (selected) {
      const slot = selectedSlot.current;
      // when hovered === selected the hover label already covers it
      if (slot >= 0 && slot < count && slot !== hoverSlot.current && titles[slot]) {
        applyText(selected, titles[slot], 1);
      } else {
        selected.visible = false;
      }
    }
  };

  /** Cheap per-frame pass: track node motion + billboard toward the camera. */
  const place = (label: TroikaLabel, slot: number, camera: THREE.Camera): void => {
    const arr = positionBuffer.array;
    const o = slot * 3;
    label.position.set(
      arr[o],
      arr[o + 1] + (scaleOfSlot[slot] || 1.1) + 1.6,
      arr[o + 2],
    );
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
      refresh(state.camera);
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
            {...labelProps(false)}
          >
            {''}
          </Text>
        ))}
        <Text
          ref={(t: TroikaLabel | null) => {
            hoverRef.current = t;
          }}
          {...labelProps(true)}
        >
          {''}
        </Text>
        <Text
          ref={(t: TroikaLabel | null) => {
            selectedRef.current = t;
          }}
          {...labelProps(true)}
        >
          {''}
        </Text>
      </group>
    </Suspense>
  );
}

/**
 * Corner minimap (bottom-right): a 2D orthographic projection of the whole
 * nebula for orientation once the graph outgrows one screenful — node dots in
 * cluster colors, faint edge filaments, the selected node ringed, plus a
 * camera indicator: a heading-aligned viewport box over the region currently
 * on screen and an arrow at the camera's own map position pointing where it
 * looks. When the camera sits outside the fitted bounds the arrow pins to
 * the map border with its orientation intact, so "you are here" never lies
 * or disappears.
 *
 * Deliberately outside the R3F tree: a plain <canvas> driven imperatively
 * from positionBuffer + cameraPose (both out-of-React bridges). The graph
 * layer (dots + filaments) is cached on an offscreen canvas refreshed on a
 * 10Hz cadence; each animation frame merely re-composites that layer and
 * redraws the indicator, and only when the pose actually changed — so the
 * arrow tracks the camera at full frame rate while costing nothing at idle.
 * Only appears at MINIMAP_MIN_NODES+ — small graphs fit on screen and don't
 * need a "you are here".
 *
 * Projection is a fixed top-down view (x/z) in 3D — a compass, not a mirror
 * of the camera — and the layout plane (x/y) in 2D mode. Clicking flies the
 * camera to the nearest document.
 */

import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { MINIMAP_MIN_NODES } from '../config';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';
import { positionBuffer, scaleOfSlot, slotOfId } from '../scene/positionBuffer';
import { cameraPose } from '../scene/cameraPose';
import { hexFor } from '../scene/palette';
import {
  arrowVertices,
  boxCorners,
  clampToRect,
  headingOnMap,
  projU,
  projV,
  viewportHalfExtents,
} from './minimapMath';

const W = 200;
const H = 148;
const PAD = 14;
const SCENE_MS = 100; // graph-layer refresh cadence; the arrow redraws per frame
const EDGE_DRAW_CAP = 1200; // beyond this, dots alone read better anyway
const CLICK_RADIUS = 12; // px
const SMOOTH = 0.25; // bounds-fit lerp per scene tick (layout settles without jitter)
const ARROW_SIZE = 5.5; // px
const ARROW_INSET = 7; // border pin margin, keeps the whole arrow on-map

interface MapTransform {
  scale: number;
  cx: number; // world-space center (projected u)
  cy: number;
}

export default function Minimap() {
  const visible = useGraphStore((s) => s.nodes.length >= MINIMAP_MIN_NODES);
  // Slide out of the way of the right-docked SidePanel while a node is open.
  const shifted = useUiStore((s) => s.selectedId !== null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fit = useRef<MapTransform | null>(null);

  useEffect(() => {
    if (!visible) {
      fit.current = null; // next appearance re-fits instantly instead of lerping in
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    const ctx = canvas.getContext('2d');
    const scene = document.createElement('canvas');
    scene.width = W * dpr;
    scene.height = H * dpr;
    const sctx = scene.getContext('2d');
    if (!ctx || !sctx) return;
    ctx.scale(dpr, dpr);
    sctx.scale(dpr, dpr);

    const drawScene = (): void => {
      const { nodes, edges } = useGraphStore.getState();
      const ui = useUiStore.getState();
      const arr = positionBuffer.array;
      const count = positionBuffer.count;
      const dims = ui.dims;

      // --- fit the live positions into the canvas (smoothed) ---------------
      let minU = Infinity;
      let maxU = -Infinity;
      let minV = Infinity;
      let maxV = -Infinity;
      let placed = 0;
      for (const n of nodes) {
        const slot = slotOfId.get(n.id);
        if (slot === undefined || slot >= count) continue;
        const o = slot * 3;
        const u = projU(arr[o], arr[o + 1], arr[o + 2]);
        const v = projV(arr[o + 1], arr[o + 2], dims);
        if (u < minU) minU = u;
        if (u > maxU) maxU = u;
        if (v < minV) minV = v;
        if (v > maxV) maxV = v;
        placed++;
      }
      sctx.clearRect(0, 0, W, H);
      if (placed === 0) {
        fit.current = null; // also hides the indicator until positions return
        return;
      }

      const spanU = Math.max(maxU - minU, 1);
      const spanV = Math.max(maxV - minV, 1);
      const targetScale = Math.min((W - PAD * 2) / spanU, (H - PAD * 2) / spanV);
      const targetCx = (minU + maxU) / 2;
      const targetCy = (minV + maxV) / 2;
      let f = fit.current;
      if (!f) {
        f = { scale: targetScale, cx: targetCx, cy: targetCy };
        fit.current = f;
      } else {
        f.scale += (targetScale - f.scale) * SMOOTH;
        f.cx += (targetCx - f.cx) * SMOOTH;
        f.cy += (targetCy - f.cy) * SMOOTH;
      }
      const toX = (u: number): number => W / 2 + (u - f.cx) * f.scale;
      const toY = (v: number): number => H / 2 + (v - f.cy) * f.scale;

      // --- edges: faintest possible filaments, straight is fine at this size
      if (edges.length <= EDGE_DRAW_CAP && !ui.clusterCollapsed) {
        sctx.strokeStyle = 'rgba(140, 150, 255, 0.10)';
        sctx.lineWidth = 1;
        sctx.beginPath();
        for (const e of edges) {
          if (e.weight < ui.filter.minEdgeWeight) continue;
          if (e.kind === 'topic' && !ui.topicNodesEnabled) continue;
          const s = slotOfId.get(e.source);
          const t = slotOfId.get(e.target);
          if (s === undefined || t === undefined || s >= count || t >= count) continue;
          const so = s * 3;
          const to = t * 3;
          sctx.moveTo(
            toX(projU(arr[so], arr[so + 1], arr[so + 2])),
            toY(projV(arr[so + 1], arr[so + 2], dims)),
          );
          sctx.lineTo(
            toX(projU(arr[to], arr[to + 1], arr[to + 2])),
            toY(projV(arr[to + 1], arr[to + 2], dims)),
          );
        }
        sctx.stroke();
      }

      // --- nodes: cluster-colored dots, hubs slightly larger ---------------
      for (const n of nodes) {
        const slot = slotOfId.get(n.id);
        if (slot === undefined || slot >= count) continue;
        if (n.kind === 'topic' && !ui.topicNodesEnabled) continue;
        const o = slot * 3;
        const x = toX(projU(arr[o], arr[o + 1], arr[o + 2]));
        const y = toY(projV(arr[o + 1], arr[o + 2], dims));
        const r = 0.9 + 0.5 * (scaleOfSlot[slot] || 1);
        sctx.globalAlpha = n.status === 'ok' ? 0.9 : 0.35;
        sctx.fillStyle = hexFor(n.cluster);
        sctx.beginPath();
        sctx.arc(x, y, r, 0, Math.PI * 2);
        sctx.fill();
      }
      sctx.globalAlpha = 1;

      // --- selected node: accent ring --------------------------------------
      if (ui.selectedId) {
        const slot = slotOfId.get(ui.selectedId);
        if (slot !== undefined && slot < count) {
          const o = slot * 3;
          sctx.strokeStyle = '#a996ff';
          sctx.lineWidth = 1.5;
          sctx.beginPath();
          sctx.arc(
            toX(projU(arr[o], arr[o + 1], arr[o + 2])),
            toY(projV(arr[o + 1], arr[o + 2], dims)),
            5,
            0,
            Math.PI * 2,
          );
          sctx.stroke();
        }
      }
    };

    const drawIndicator = (): void => {
      const f = fit.current;
      if (!f) return;
      const dims = useUiStore.getState().dims;
      const toX = (u: number): number => W / 2 + (u - f.cx) * f.scale;
      const toY = (v: number): number => H / 2 + (v - f.cy) * f.scale;

      const { hu, hv } = headingOnMap(cameraPose, dims);
      const { halfU, halfV } = viewportHalfExtents(cameraPose, f.scale, W, H);
      // Box at the TRUE target position — off-map it just clips at the canvas
      // edge; the border-pinned arrow below is the visibility guarantee.
      const bx = toX(projU(cameraPose.tx, cameraPose.ty, cameraPose.tz));
      const by = toY(projV(cameraPose.ty, cameraPose.tz, dims));
      const corners = boxCorners(bx, by, hu, hv, halfU, halfV);
      ctx.fillStyle = 'rgba(169, 150, 255, 0.10)';
      ctx.strokeStyle = 'rgba(169, 150, 255, 0.7)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(corners[0][0], corners[0][1]);
      ctx.lineTo(corners[1][0], corners[1][1]);
      ctx.lineTo(corners[2][0], corners[2][1]);
      ctx.lineTo(corners[3][0], corners[3][1]);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // arrow: the camera itself, pointing along the view heading (coincides
      // with the box center in 2D, where it points map-up = screen-up)
      const pin = clampToRect(
        toX(projU(cameraPose.px, cameraPose.py, cameraPose.pz)),
        toY(projV(cameraPose.py, cameraPose.pz, dims)),
        ARROW_INSET,
        W - ARROW_INSET,
        ARROW_INSET,
        H - ARROW_INSET,
      );
      const tri = arrowVertices(pin.x, pin.y, hu, hv, ARROW_SIZE);
      ctx.beginPath();
      ctx.moveTo(tri[0][0], tri[0][1]);
      ctx.lineTo(tri[1][0], tri[1][1]);
      ctx.lineTo(tri[2][0], tri[2][1]);
      ctx.closePath();
      ctx.fillStyle = '#a996ff';
      ctx.fill();
      ctx.strokeStyle = 'rgba(12, 10, 30, 0.6)';
      ctx.lineWidth = 1;
      ctx.stroke();
    };

    let raf = 0;
    let lastSceneAt = -Infinity;
    const seen = {
      px: NaN,
      py: NaN,
      pz: NaN,
      tx: NaN,
      ty: NaN,
      tz: NaN,
      fov: NaN,
      aspect: NaN,
    };
    const frame = (now: number): void => {
      raf = requestAnimationFrame(frame);
      const poseChanged =
        cameraPose.px !== seen.px ||
        cameraPose.py !== seen.py ||
        cameraPose.pz !== seen.pz ||
        cameraPose.tx !== seen.tx ||
        cameraPose.ty !== seen.ty ||
        cameraPose.tz !== seen.tz ||
        cameraPose.fov !== seen.fov ||
        cameraPose.aspect !== seen.aspect;
      const sceneDue = now - lastSceneAt >= SCENE_MS;
      if (!poseChanged && !sceneDue) return;
      if (sceneDue) {
        drawScene();
        lastSceneAt = now;
      }
      seen.px = cameraPose.px;
      seen.py = cameraPose.py;
      seen.pz = cameraPose.pz;
      seen.tx = cameraPose.tx;
      seen.ty = cameraPose.ty;
      seen.tz = cameraPose.tz;
      seen.fov = cameraPose.fov;
      seen.aspect = cameraPose.aspect;
      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(scene, 0, 0, W, H);
      drawIndicator();
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [visible]);

  const handleClick = (ev: ReactMouseEvent<HTMLCanvasElement>): void => {
    const f = fit.current;
    const canvas = canvasRef.current;
    if (!f || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = ev.clientX - rect.left;
    const my = ev.clientY - rect.top;
    const { nodes } = useGraphStore.getState();
    const ui = useUiStore.getState();
    const arr = positionBuffer.array;
    const count = positionBuffer.count;
    const dims = ui.dims;
    let bestId: string | null = null;
    let bestD2 = CLICK_RADIUS * CLICK_RADIUS;
    for (const n of nodes) {
      if (n.kind === 'topic' && !ui.topicNodesEnabled) continue;
      const slot = slotOfId.get(n.id);
      if (slot === undefined || slot >= count) continue;
      const o = slot * 3;
      const x = W / 2 + (projU(arr[o], arr[o + 1], arr[o + 2]) - f.cx) * f.scale;
      const y = H / 2 + (projV(arr[o + 1], arr[o + 2], dims) - f.cy) * f.scale;
      const d2 = (x - mx) * (x - mx) + (y - my) * (y - my);
      if (d2 < bestD2) {
        bestD2 = d2;
        bestId = n.id;
      }
    }
    if (bestId) ui.sendCamera('frameNode', [bestId]);
  };

  // Keyboard equivalent of the click-to-fly behavior above: a click flies to
  // whichever node is nearest the pointer, which has no keyboard analog, so
  // Enter/Space instead fly to the currently selected node (or reset to the
  // full overview when nothing is selected).
  const handleKeyDown = (ev: ReactKeyboardEvent<HTMLCanvasElement>): void => {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    ev.preventDefault();
    const ui = useUiStore.getState();
    if (ui.selectedId) ui.sendCamera('frameNode', [ui.selectedId]);
    else ui.sendCamera('fitAll');
  };

  if (!visible) return null;

  return (
    <div className={`minimap glass-panel${shifted ? ' minimap--shifted' : ''}`}>
      <canvas
        ref={canvasRef}
        style={{ width: W, height: H }}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        role="button"
        tabIndex={0}
        aria-label="Minimap — click, or press Enter, to fly to the nearest document"
        title="Click to fly to a document"
      />
    </div>
  );
}

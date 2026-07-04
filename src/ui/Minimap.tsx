/**
 * Corner minimap (bottom-right): a 2D orthographic projection of the whole
 * nebula for orientation once the graph outgrows one screenful — node dots in
 * cluster colors, faint edge filaments, the selected node ringed, and a
 * camera wedge showing where you are and which way you're looking.
 *
 * Deliberately outside the R3F tree: a plain <canvas> redrawn on a 10Hz
 * interval from positionBuffer + cameraPose (both imperative bridges), so it
 * costs nothing per 3D frame and never re-renders with React state. Only
 * appears at MINIMAP_MIN_NODES+ — small graphs fit on screen and don't need
 * a "you are here".
 *
 * Projection is a fixed top-down view (x/z) in 3D — a compass, not a mirror
 * of the camera — and the layout plane (x/y) in 2D mode. Clicking flies the
 * camera to the nearest document.
 */

import { useEffect, useRef, type MouseEvent as ReactMouseEvent } from 'react';
import { MINIMAP_MIN_NODES } from '../config';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';
import { positionBuffer, scaleOfSlot, slotOfId } from '../scene/positionBuffer';
import { cameraPose } from '../scene/cameraPose';
import { hexFor } from '../scene/palette';

const W = 200;
const H = 148;
const PAD = 14;
const TICK_MS = 100;
const EDGE_DRAW_CAP = 1200; // beyond this, dots alone read better anyway
const CLICK_RADIUS = 12; // px
const SMOOTH = 0.25; // bounds-fit lerp per tick (layout settles without jitter)

interface MapTransform {
  scale: number;
  cx: number; // world-space center (projected u)
  cy: number;
}

/** Project world position to the map plane: top-down in 3D, layout plane in 2D. */
function projU(x: number, _y: number, _z: number): number {
  return x;
}
function projV(y: number, z: number, dims: 2 | 3): number {
  return dims === 3 ? z : -y;
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
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    const draw = (): void => {
      if (document.hidden) return;
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
      ctx.clearRect(0, 0, W, H);
      if (placed === 0) return;

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
        ctx.strokeStyle = 'rgba(140, 150, 255, 0.10)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (const e of edges) {
          if (e.weight < ui.filter.minEdgeWeight) continue;
          if (e.kind === 'topic' && !ui.topicNodesEnabled) continue;
          const s = slotOfId.get(e.source);
          const t = slotOfId.get(e.target);
          if (s === undefined || t === undefined || s >= count || t >= count) continue;
          const so = s * 3;
          const to = t * 3;
          ctx.moveTo(
            toX(projU(arr[so], arr[so + 1], arr[so + 2])),
            toY(projV(arr[so + 1], arr[so + 2], dims)),
          );
          ctx.lineTo(
            toX(projU(arr[to], arr[to + 1], arr[to + 2])),
            toY(projV(arr[to + 1], arr[to + 2], dims)),
          );
        }
        ctx.stroke();
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
        ctx.globalAlpha = n.status === 'ok' ? 0.9 : 0.35;
        ctx.fillStyle = hexFor(n.cluster);
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // --- selected node: accent ring --------------------------------------
      if (ui.selectedId) {
        const slot = slotOfId.get(ui.selectedId);
        if (slot !== undefined && slot < count) {
          const o = slot * 3;
          ctx.strokeStyle = '#a996ff';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(
            toX(projU(arr[o], arr[o + 1], arr[o + 2])),
            toY(projV(arr[o + 1], arr[o + 2], dims)),
            5,
            0,
            Math.PI * 2,
          );
          ctx.stroke();
        }
      }

      // --- camera: wedge at the eye, opening toward the orbit target -------
      const camX = toX(projU(cameraPose.px, cameraPose.py, cameraPose.pz));
      const camY = toY(projV(cameraPose.py, cameraPose.pz, dims));
      const tgtX = toX(projU(cameraPose.tx, cameraPose.ty, cameraPose.tz));
      const tgtY = toY(projV(cameraPose.ty, cameraPose.tz, dims));
      // Camera can orbit far outside the graph bounds — keep its marker on
      // the map so "you are here" never silently disappears off the edge.
      const px = Math.min(Math.max(camX, 6), W - 6);
      const py = Math.min(Math.max(camY, 6), H - 6);
      let dx = tgtX - px;
      let dy = tgtY - py;
      const len = Math.hypot(dx, dy);
      if (len > 1e-3) {
        dx /= len;
        dy /= len;
      } else {
        dx = 0;
        dy = -1; // looking straight down the projection axis: point "north"
      }
      const wedge = 11;
      const half = 0.45; // ~26° half-angle
      ctx.fillStyle = 'rgba(169, 150, 255, 0.22)';
      ctx.strokeStyle = 'rgba(169, 150, 255, 0.7)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(
        px + (dx * Math.cos(half) - dy * Math.sin(half)) * wedge,
        py + (dx * Math.sin(half) + dy * Math.cos(half)) * wedge,
      );
      ctx.lineTo(
        px + (dx * Math.cos(-half) - dy * Math.sin(-half)) * wedge,
        py + (dx * Math.sin(-half) + dy * Math.cos(-half)) * wedge,
      );
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#a996ff';
      ctx.beginPath();
      ctx.arc(px, py, 2, 0, Math.PI * 2);
      ctx.fill();
    };

    draw();
    const timer = window.setInterval(draw, TICK_MS);
    return () => window.clearInterval(timer);
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

  if (!visible) return null;

  return (
    <div
      className={`minimap glass-panel${shifted ? ' minimap--shifted' : ''}`}
      aria-hidden="true"
    >
      <canvas
        ref={canvasRef}
        style={{ width: W, height: H }}
        onClick={handleClick}
        title="Click to fly to a document"
      />
    </div>
  );
}

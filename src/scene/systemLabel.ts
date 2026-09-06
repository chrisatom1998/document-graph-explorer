import * as THREE from 'three';
import { needsSystemFont } from './interGlyphCoverage';

export interface SceneLabel extends THREE.Mesh {
  text: string;
  sync: (onSync?: () => void) => void;
  fontSize?: number;
  maxWidth?: number;
  lineHeight?: number | string;
  anchorX?: number | string;
  anchorY?: number | string;
  color?: THREE.ColorRepresentation | null;
  fillOpacity?: number;
  outlineColor?: THREE.ColorRepresentation;
  outlineWidth?: number | string;
  outlineOpacity?: number;
}

export const MAX_LABEL_TEXTURE_SIZE = 1024;
const FONT_PIXELS = 32;
const SYSTEM_FONT = 'system-ui, "Segoe UI", "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

interface SystemLabel {
  text: string;
  style: string;
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  texture: THREE.CanvasTexture;
  hiddenMaterials: Map<THREE.Material, boolean>;
  dispose: () => void;
}

const fallbacks = new WeakMap<SceneLabel, SystemLabel>();

export function disposeSceneLabel(label: SceneLabel): void {
  fallbacks.get(label)?.dispose();
}

export function sceneLabelText(label: SceneLabel): string {
  return fallbacks.get(label)?.text ?? label.text;
}

export function setSceneLabelOpacity(label: SceneLabel, opacity: number): void {
  label.fillOpacity = opacity;
  const fallback = fallbacks.get(label);
  if (fallback) fallback.mesh.material.opacity = opacity;
}

function wrapText(context: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r\n|\r|\n/)) {
    let line = '';
    for (const { segment } of graphemes.segment(paragraph)) {
      if (line && context.measureText(line + segment).width > maxWidth) {
        lines.push(line);
        line = '';
      }
      line += segment;
    }
    lines.push(line);
  }
  return lines;
}

function createFallback(label: SceneLabel): SystemLabel {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Document labels require a Canvas 2D context for system fonts.');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }),
  );
  mesh.name = 'system-font-label';
  mesh.raycast = () => {};
  const hiddenMaterials = new Map<THREE.Material, boolean>();
  const dispose = () => {
    label.remove(mesh);
    mesh.geometry.dispose();
    mesh.material.dispose();
    texture.dispose();
    for (const [material, visible] of hiddenMaterials) material.visible = visible;
    fallbacks.delete(label);
  };
  const fallback = { text: '', style: '', canvas, context, mesh, texture, hiddenMaterials, dispose };
  fallbacks.set(label, fallback);
  label.add(mesh);
  return fallback;
}

/** Keep unsupported glyphs out of Troika's network-backed font resolver. */
export function syncSceneLabel(label: SceneLabel, text: string): void {
  if (!needsSystemFont(text)) {
    fallbacks.get(label)?.dispose();
    if (label.text !== text) {
      label.text = text;
      label.sync();
    }
    return;
  }
  if (label.text !== '') {
    label.text = '';
    label.sync();
  }
  const fallback = fallbacks.get(label) ?? createFallback(label);
  const materials = Array.isArray(label.material) ? label.material : [label.material];
  // Emptying Troika is asynchronous. Hide its old glyphs immediately while
  // leaving this label's child plane visible, including any outline material.
  for (const material of materials) {
    if (!fallback.hiddenMaterials.has(material)) fallback.hiddenMaterials.set(material, material.visible);
    material.visible = false;
  }
  const material = materials[0];
  fallback.mesh.material.depthTest = material.depthTest;
  fallback.mesh.material.depthWrite = material.depthWrite;
  fallback.mesh.material.toneMapped = material.toneMapped;
  fallback.mesh.material.opacity = label.fillOpacity ?? 1;
  fallback.mesh.renderOrder = label.renderOrder;

  const fontSize = label.fontSize || 1;
  const maxWidth = label.maxWidth ?? Infinity;
  const lineHeight = typeof label.lineHeight === 'number' ? label.lineHeight : 1.35;
  const color = new THREE.Color(label.color ?? 'white').getStyle();
  const outlineColor = new THREE.Color(label.outlineColor ?? 'black').getStyle();
  const outlineWidth = typeof label.outlineWidth === 'number' ? label.outlineWidth : 0;
  const outlineOpacity = label.outlineOpacity ?? 1;
  const style = JSON.stringify([
    fontSize, maxWidth, lineHeight, color, outlineColor, outlineWidth, outlineOpacity,
    label.anchorX, label.anchorY,
  ]);
  if (fallback.text === text && fallback.style === style) return;
  fallback.text = text;
  fallback.style = style;

  const { canvas, context, mesh, texture } = fallback;
  context.font = `${FONT_PIXELS}px ${SYSTEM_FONT}`;
  const pixelsPerUnit = FONT_PIXELS / fontSize;
  const padding = Math.ceil(Math.max(3, outlineWidth * pixelsPerUnit + 2));
  const lines = wrapText(context, text, Math.max(1, maxWidth * pixelsPerUnit));
  const width = Math.max(1, ...lines.map((line) => context.measureText(line).width)) + 2 * padding;
  const height = Math.max(1, lines.length * FONT_PIXELS * lineHeight) + 2 * padding;
  const resolution = Math.min(1, MAX_LABEL_TEXTURE_SIZE / width, MAX_LABEL_TEXTURE_SIZE / height);
  canvas.width = Math.max(1, Math.ceil(width * resolution));
  canvas.height = Math.max(1, Math.ceil(height * resolution));
  context.scale(resolution, resolution);
  context.font = `${FONT_PIXELS}px ${SYSTEM_FONT}`;
  context.textBaseline = 'top';
  context.textAlign = 'left';
  context.lineJoin = 'round';
  context.lineWidth = 2 * outlineWidth * pixelsPerUnit;
  context.strokeStyle = outlineColor;
  context.fillStyle = color;
  lines.forEach((line, index) => {
    const y = padding + index * FONT_PIXELS * lineHeight;
    if (outlineWidth > 0) {
      context.globalAlpha = outlineOpacity;
      context.strokeText(line, padding, y);
    }
    context.globalAlpha = 1;
    context.fillText(line, padding, y);
  });
  const worldWidth = width / pixelsPerUnit;
  const worldHeight = height / pixelsPerUnit;
  mesh.scale.set(worldWidth, worldHeight, 1);
  mesh.position.set(
    label.anchorX === 'left' ? worldWidth / 2 : label.anchorX === 'right' ? -worldWidth / 2 : 0,
    label.anchorY === 'bottom' ? worldHeight / 2 : label.anchorY === 'top' ? -worldHeight / 2 : 0,
    0,
  );
  texture.needsUpdate = true;
}

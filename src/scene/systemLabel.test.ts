// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  MAX_LABEL_TEXTURE_SIZE, disposeSceneLabel, sceneLabelText, setSceneLabelOpacity, syncSceneLabel, type SceneLabel,
} from './systemLabel';

describe('offline system-font labels', () => {
  let label: SceneLabel & { material: THREE.MeshBasicMaterial };
  let context: CanvasRenderingContext2D;

  const plane = () => label.children[0] as THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;

  beforeEach(() => {
    context = {
      measureText: (text: string) => ({ width: Array.from(text).length * 16 }),
      scale: vi.fn(), fillText: vi.fn(), strokeText: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
    label = Object.assign(new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial()), {
      text: 'Previous title', sync: vi.fn(), fontSize: 2, maxWidth: 8,
      anchorX: 'left', anchorY: 'middle', color: '#d3dfed', fillOpacity: 0.65,
      outlineColor: '#000000', outlineWidth: 0.1, outlineOpacity: 1,
    });
    label.material.depthTest = false;
    label.material.depthWrite = false;
    label.material.toneMapped = false;
    label.renderOrder = 11;
  });

  afterEach(() => {
    disposeSceneLabel(label);
    label.geometry.dispose();
    vi.restoreAllMocks();
  });

  it('draws the Unicode title without passing unsupported glyphs to Troika', () => {
    const text = '東京 計画 📚';
    syncSceneLabel(label, text);
    expect(label.text).toBe('');
    expect(label.sync).toHaveBeenCalledOnce();
    expect(sceneLabelText(label)).toBe(text);
    expect(context.fillText).toHaveBeenCalledWith(text, expect.any(Number), expect.any(Number));
    expect(label.material.visible).toBe(false);
    expect(plane().material.visible).toBe(true);
  });

  it('loads and renders code points when Intl.Segmenter is unavailable', async () => {
    vi.spyOn(Intl, 'Segmenter');
    Object.defineProperty(Intl, 'Segmenter', { value: undefined, configurable: true });
    vi.resetModules();
    const fallbackModule = await import('./systemLabel');
    try {
      label.maxWidth = 1;
      fallbackModule.syncSceneLabel(label, '東京📚');
      expect(vi.mocked(context.fillText).mock.calls.map(([line]) => line)).toEqual(['東', '京', '📚']);
      expect(label.text).toBe('');
    } finally {
      fallbackModule.disposeSceneLabel(label);
      vi.resetModules();
    }
  });

  it('preserves style, depth, opacity and anchored world width', () => {
    syncSceneLabel(label, 'مرحبا بالعالم');
    const child = plane();
    expect(child.material.depthTest).toBe(false);
    expect(child.material.depthWrite).toBe(false);
    expect(child.material.toneMapped).toBe(false);
    expect(child.renderOrder).toBe(11);
    expect(child.material.opacity).toBe(0.65);
    expect(child.scale.x).toBeLessThanOrEqual(8.5);
    expect(child.position.x).toBe(child.scale.x / 2);
    expect(child.position.y).toBe(0);
    expect(context.fillStyle).toBe(new THREE.Color('#d3dfed').getStyle());
    setSceneLabelOpacity(label, 0.28);
    expect(child.material.opacity).toBe(0.28);
    label.anchorX = 'center';
    label.anchorY = 'bottom';
    syncSceneLabel(label, 'مرحبا بالعالم');
    expect(child.position.x).toBe(0);
    expect(child.position.y).toBe(child.scale.y / 2);
  });

  it('reuses its child and texture, and redraws only changed text or style', () => {
    syncSceneLabel(label, '東京');
    const child = plane();
    const texture = child.material.map;
    const draws = vi.mocked(context.fillText).mock.calls.length;
    for (let i = 0; i < 50; i++) syncSceneLabel(label, '東京');
    expect(context.fillText).toHaveBeenCalledTimes(draws);
    syncSceneLabel(label, '大阪');
    expect(label.children).toEqual([child]);
    expect(child.material.map).toBe(texture);
    expect(context.fillText).toHaveBeenCalledTimes(draws + 1);
    expect(sceneLabelText(label)).toBe('大阪');
  });

  it('disposes the fallback and restores Troika when returning to supported text', () => {
    syncSceneLabel(label, '東京');
    const child = plane();
    const disposeTexture = vi.spyOn(child.material.map!, 'dispose');
    const disposeGeometry = vi.spyOn(child.geometry, 'dispose');
    const disposeMaterial = vi.spyOn(child.material, 'dispose');
    syncSceneLabel(label, 'Café — overview…');
    expect(label.children).toHaveLength(0);
    expect(label.material.visible).toBe(true);
    expect(label.text).toBe('Café — overview…');
    expect(disposeTexture).toHaveBeenCalledOnce();
    expect(disposeGeometry).toHaveBeenCalledOnce();
    expect(disposeMaterial).toHaveBeenCalledOnce();
  });

  it('retains the fallback during Troika buffer resizing and releases it explicitly', () => {
    syncSceneLabel(label, '東京');
    const disposeTexture = vi.spyOn(plane().material.map!, 'dispose');
    label.geometry.dispose();
    expect(label.children).toHaveLength(1);
    expect(disposeTexture).not.toHaveBeenCalled();
    disposeSceneLabel(label);
    expect(label.children).toHaveLength(0);
    expect(disposeTexture).toHaveBeenCalledOnce();
  });

  it('bounds texture dimensions and never splits an emoji grapheme', () => {
    label.maxWidth = 2;
    const emoji = '👩🏽‍💻';
    syncSceneLabel(label, emoji.repeat(1000));
    const canvas = plane().material.map!.image as HTMLCanvasElement;
    expect(canvas.width).toBeLessThanOrEqual(MAX_LABEL_TEXTURE_SIZE);
    expect(canvas.height).toBeLessThanOrEqual(MAX_LABEL_TEXTURE_SIZE);
    for (const [line] of vi.mocked(context.fillText).mock.calls) expect(line).toBe(emoji);
  });
});

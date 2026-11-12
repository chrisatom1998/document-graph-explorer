import type { GraphClarity } from '../store/settingsMigration';
import type { QualityTier } from '../store/uiStore';

const PIXEL_BUDGET = { high: 8_000_000, ultra: 12_000_000, performance: 4_000_000 };
const PERFORMANCE_CAPS = [2, 2, 1.5, 1.25, 1] as const;
const HIGH_CAPS = [3, 3, 2.5, 2, 1.5] as const;

/** SwiftShader, llvmpipe, and the other software rasterizers. */
export function isSoftwareRendererName(name: string): boolean {
  return /swiftshader|llvmpipe|softpipe|software rasterizer|microsoft basic render/i.test(name);
}

type RendererInfoContext = {
  getExtension(name: string): { UNMASKED_RENDERER_WEBGL: number } | null;
  getParameter(parameter: number): unknown;
};

/** True when the live WebGL context is a software rasterizer. */
export function readSoftwareRenderer(gl: { getContext(): RendererInfoContext }): boolean {
  try {
    const context = gl.getContext();
    const info = context.getExtension('WEBGL_debug_renderer_info');
    if (!info) return false;
    return isSoftwareRendererName(String(context.getParameter(info.UNMASKED_RENDERER_WEBGL) ?? ''));
  } catch {
    return false;
  }
}

/** Supersample both views without allocating an unbounded full-screen buffer.
 * High keeps at least native detail (up to 2x) as effects are reduced. Ultra
 * keeps its resolution at every tier. Device limits always take precedence.
 * `oneToOne` stays at 1x. Callers set it for a software rasterizer and for
 * prefers-reduced-motion: a supersampled bloom buffer is what stops frames.
 */
export function graphPixelRatio({
  deviceRatio, clarity, tier = 0, width = 1, height = 1, maxDimension = 8192, oneToOne = false,
}: {
  deviceRatio: number; clarity: GraphClarity; tier?: QualityTier;
  width?: number; height?: number; maxDimension?: number; oneToOne?: boolean;
}): number {
  const native = Number.isFinite(deviceRatio) && deviceRatio > 0 ? deviceRatio : 1;
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const target = clarity === 'ultra' ? Math.min(4, Math.max(3, native * 2))
    : clarity === 'performance' ? Math.min(native, PERFORMANCE_CAPS[tier])
    : Math.min(Math.max(Math.min(2, Math.max(1.5, native)), HIGH_CAPS[tier]), Math.max(2, native * 1.5));
  const ratio = Math.min(target, Math.sqrt(PIXEL_BUDGET[clarity] / (w * h)), maxDimension / w, maxDimension / h);
  return oneToOne ? Math.min(1, ratio) : ratio;
}

/** Keep geometry antialiasing even when glow and animation are reduced. */
export function graphSamples(maxSamples: number, clarity: GraphClarity): number {
  return Math.min(maxSamples, clarity === 'performance' ? 2 : 4);
}

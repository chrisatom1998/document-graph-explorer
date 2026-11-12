import { describe, expect, it } from 'vitest';
import { graphPixelRatio, graphSamples, isSoftwareRendererName } from './renderQuality';

describe('graph resolution budgets', () => {
  it.each([[1, 2], [2, 3], [3, 3]])('supersamples a %sx screen at %sx in High', (deviceRatio, expected) => {
    expect(graphPixelRatio({ deviceRatio, clarity: 'high', width: 900, height: 650 })).toBe(expected);
  });
  it('keeps a retina display at native resolution on the lowest automatic tier', () => {
    expect(graphPixelRatio({ deviceRatio: 2, clarity: 'high', tier: 4 })).toBe(2);
    expect(graphPixelRatio({ deviceRatio: 2, clarity: 'ultra', tier: 4 })).toBe(4);
  });
  it('bounds both total pixels and GPU dimensions, even for a huge viewport', () => {
    const ratio = graphPixelRatio({ deviceRatio: 3, clarity: 'high', width: 3840, height: 2160 });
    expect(3840 * 2160 * ratio ** 2).toBeLessThanOrEqual(8_000_001);
    const narrow = graphPixelRatio({ deviceRatio: 3, clarity: 'ultra', width: 3000, height: 100, maxDimension: 4096 });
    expect(3000 * narrow).toBeLessThanOrEqual(4096);
  });
  it('offers the original low-resolution fallback only in Performance', () => {
    expect(graphPixelRatio({ deviceRatio: 2, clarity: 'performance', tier: 4 })).toBe(1);
  });
  it('uses a safe fallback for an invalid display scale', () => {
    expect(graphPixelRatio({ deviceRatio: NaN, clarity: 'high' })).toBe(2);
  });
  it('stays at 1x on a software rasterizer', () => {
    expect(graphPixelRatio({ deviceRatio: 2, clarity: 'high', oneToOne: true })).toBe(1);
    expect(graphPixelRatio({ deviceRatio: 3, clarity: 'ultra', width: 800, height: 500, oneToOne: true })).toBe(1);
    expect(graphPixelRatio({ deviceRatio: 2, clarity: 'high', width: 900, height: 650 })).toBe(3);
  });
  it('recognises the software rasterizers Playwright and headless Chrome use', () => {
    expect(isSoftwareRendererName('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)')).toBe(true);
    expect(isSoftwareRendererName('llvmpipe (LLVM 15.0.6, 256 bits)')).toBe(true);
    expect(isSoftwareRendererName('ANGLE (NVIDIA, NVIDIA GeForce RTX 4090 Direct3D11 vs_5_0 ps_5_0)')).toBe(false);
  });
  it('keeps antialiasing within the device sample limit', () => {
    expect(graphSamples(8, 'high')).toBe(4);
    expect(graphSamples(2, 'ultra')).toBe(2);
    expect(graphSamples(0, 'high')).toBe(0);
    expect(graphSamples(4, 'performance')).toBe(2);
  });
});

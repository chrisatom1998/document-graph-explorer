import { describe, expect, it } from 'vitest';
import {
  isSoftwareWebGLRenderer,
  patchContextAttributes,
  readContextAttributes,
  readRendererName,
  shouldUseEffectComposer,
} from './composerSupport';

function fakeGl(opts: {
  attrs?: WebGLContextAttributes | null;
  renderer?: string;
  throwOnAttrs?: boolean;
  noContext?: boolean;
}): {
  getContext: () => WebGLRenderingContext | null;
} {
  if (opts.noContext) return { getContext: () => null };
  const ctx = {
    RENDERER: 0x1f01,
    getContextAttributes: opts.throwOnAttrs
      ? () => {
          throw new Error('context lost');
        }
      : () => opts.attrs ?? null,
    getParameter: (pname: number) => (pname === 0x1f01 ? (opts.renderer ?? 'ANGLE') : ''),
  };
  return { getContext: () => ctx as unknown as WebGLRenderingContext };
}

describe('composerSupport', () => {
  it('reads attributes and renderer names without throwing', () => {
    expect(readContextAttributes(fakeGl({ attrs: { alpha: false } }))).toEqual({ alpha: false });
    expect(readContextAttributes(fakeGl({ attrs: null }))).toBeNull();
    expect(readContextAttributes(fakeGl({ throwOnAttrs: true }))).toBeNull();
    expect(readContextAttributes(fakeGl({ noContext: true }))).toBeNull();
    expect(readRendererName(fakeGl({ renderer: 'SwiftShader' }))).toBe('SwiftShader');
    expect(readRendererName(fakeGl({ noContext: true }))).toBe('');
  });

  it('flags software rasterizers', () => {
    expect(isSoftwareWebGLRenderer('ANGLE (NVIDIA)')).toBe(false);
    expect(isSoftwareWebGLRenderer('Google SwiftShader')).toBe(true);
    expect(isSoftwareWebGLRenderer('llvmpipe (LLVM 15)')).toBe(true);
  });

  it('disables the composer when attributes are missing or the renderer is software', () => {
    expect(shouldUseEffectComposer(fakeGl({ attrs: { alpha: false }, renderer: 'ANGLE' }))).toBe(true);
    expect(shouldUseEffectComposer(fakeGl({ attrs: null, renderer: 'ANGLE' }))).toBe(false);
    expect(shouldUseEffectComposer(fakeGl({ attrs: { alpha: false }, renderer: 'SwiftShader' }))).toBe(false);
  });

  it('patches getContextAttributes so a null read becomes a fallback object', () => {
    const gl = fakeGl({ attrs: null });
    patchContextAttributes(gl);
    const attrs = gl.getContext()!.getContextAttributes();
    expect(attrs).not.toBeNull();
    expect(attrs?.alpha).toBe(false);
  });

  it('leaves a live attributes object unchanged', () => {
    const gl = fakeGl({ attrs: { alpha: true, depth: true } });
    patchContextAttributes(gl);
    expect(gl.getContext()!.getContextAttributes()).toEqual({ alpha: true, depth: true });
  });

  it('is a no-op when there is no context', () => {
    const gl = fakeGl({ noContext: true });
    expect(() => patchContextAttributes(gl)).not.toThrow();
  });
});

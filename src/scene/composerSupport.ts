/**
 * EffectComposer (postprocessing) reads
 * `renderer.getContext().getContextAttributes().alpha` when a pass is added
 * or the renderer is set. Software WebGL and a lost context can make
 * `getContextAttributes()` return null, which throws
 * "Cannot read properties of null (reading 'alpha')" and takes down the
 * React tree via the app error boundary.
 */

const SOFTWARE_RENDERER = /swiftshader|llvmpipe|softpipe|software rasterizer/i;

const FALLBACK_ATTRIBUTES: WebGLContextAttributes = {
  alpha: false,
  depth: true,
  stencil: false,
  antialias: false,
  premultipliedAlpha: true,
  preserveDrawingBuffer: false,
  powerPreference: 'default',
  failIfMajorPerformanceCaveat: false,
  desynchronized: false,
};

export interface ComposerContextProbe {
  getContext: () => WebGLRenderingContext | WebGL2RenderingContext | null;
}

/** Safe read — never throws. */
export function readContextAttributes(
  gl: ComposerContextProbe,
): WebGLContextAttributes | null {
  try {
    const ctx = gl.getContext();
    if (!ctx || typeof ctx.getContextAttributes !== 'function') return null;
    return ctx.getContextAttributes() ?? null;
  } catch {
    return null;
  }
}

export function readRendererName(gl: ComposerContextProbe): string {
  try {
    const ctx = gl.getContext();
    if (!ctx) return '';
    return String(ctx.getParameter(ctx.RENDERER) ?? '');
  } catch {
    return '';
  }
}

export function isSoftwareWebGLRenderer(rendererName: string): boolean {
  return SOFTWARE_RENDERER.test(rendererName);
}

/**
 * True when the postprocessing composer can safely call
 * `getContextAttributes().alpha` and is not running on a software rasterizer
 * that remounts passes unreliably.
 */
export function shouldUseEffectComposer(gl: ComposerContextProbe): boolean {
  if (readContextAttributes(gl) == null) return false;
  if (isSoftwareWebGLRenderer(readRendererName(gl))) return false;
  return true;
}

/**
 * Make `getContextAttributes()` never return null so a later composer pass
 * add cannot throw if the context flickers after we decided to mount it.
 */
export function patchContextAttributes(gl: ComposerContextProbe): void {
  const ctx = gl.getContext();
  if (!ctx || typeof ctx.getContextAttributes !== 'function') return;
  const original = ctx.getContextAttributes.bind(ctx);
  ctx.getContextAttributes = () => original() ?? FALLBACK_ATTRIBUTES;
}

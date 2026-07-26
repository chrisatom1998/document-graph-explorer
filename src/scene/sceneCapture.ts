/**
 * Bridge for one-shot canvas snapshots (Export PNG) now that the scene
 * renders WITHOUT preserveDrawingBuffer (keeping the backbuffer alive after
 * every swap taxed each frame, worst on tiled GPUs like Apple Silicon).
 *
 * The WebGL backbuffer is cleared after the compositor swap, so reading the
 * canvas at an arbitrary later time returns blank pixels. The registered
 * callback renders a fresh frame synchronously; the caller must extract
 * pixels (toBlob/toDataURL) in the same task, before yielding to the
 * event loop.
 *
 * NebulaCanvas registers on mount; exportScenePNG consumes.
 */

let renderAndGetCanvas: (() => HTMLCanvasElement) | null = null;

export function registerSceneCapture(fn: (() => HTMLCanvasElement) | null): void {
  renderAndGetCanvas = fn;
}

/** Render one frame now and return the canvas, or null when no scene is mounted. */
export function captureSceneCanvas(): HTMLCanvasElement | null {
  return renderAndGetCanvas ? renderAndGetCanvas() : null;
}

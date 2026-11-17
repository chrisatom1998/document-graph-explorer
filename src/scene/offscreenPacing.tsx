/**
 * Pacing for a graph canvas that is scrolled out of view.
 *
 * Night Session puts the graph in a scrolling column, so it is often off-screen.
 * The browser does not hold back animation frames for an off-screen canvas, so
 * the scene kept issuing full frames faster than a slow GPU (or a software
 * renderer) could draw them. The unfinished frames queued up, and the next call
 * that needed an answer from the GPU (a shader link on a 2D/3D switch, a reload,
 * a screenshot) waited for the whole queue: close to a minute in CI.
 *
 * Off-screen, the scene now draws on demand at a low rate, and only once the GPU
 * has finished the previous frame. Camera focus and selection still commit,
 * because frames keep coming; they just cannot pile up.
 */
import { useEffect, useState, type RefObject } from 'react';
import { useThree } from '@react-three/fiber';

/** How often an off-screen scene may draw. */
export const OFFSCREEN_FRAME_INTERVAL_MS = 250;

let onScreen = true;
/** Whether the graph canvas is currently in view. Frame-rate monitors skip their samples while it is not. */
export function isSceneOnScreen(): boolean {
  return onScreen;
}

/** Track whether the element is in view. Without IntersectionObserver (tests, old browsers) it counts as in view. */
export function useSceneOnScreen(target: RefObject<Element | null>): boolean {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const element = target.current;
    if (!element || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(entries => {
      const entry = entries[entries.length - 1];
      onScreen = entry.isIntersecting;
      setVisible(entry.isIntersecting);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      onScreen = true;
    };
  }, [target]);
  return visible;
}

/** Mounted inside the Canvas. While `active`, requests one frame at a time and waits for the GPU to finish it. */
export function OffscreenPacer({ active }: { active: boolean }) {
  const gl = useThree(s => s.gl);
  const invalidate = useThree(s => s.invalidate);
  useEffect(() => {
    if (!active) return;
    const context = gl.getContext() as WebGL2RenderingContext;
    const canFence = typeof context.fenceSync === 'function';
    let fence: WebGLSync | null = null;
    let frame = 0;
    const timer = window.setInterval(() => {
      if (fence) {
        // The last off-screen frame is still being drawn: do not queue another behind it.
        if (context.clientWaitSync(fence, 0, 0) === context.TIMEOUT_EXPIRED) return;
        context.deleteSync(fence);
        fence = null;
      }
      invalidate();
      if (!canFence) return;
      // The invalidated frame renders on the next animation frame; mark the end of its commands after that.
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => {
          if (fence) return;
          fence = context.fenceSync(context.SYNC_GPU_COMMANDS_COMPLETE, 0);
          context.flush();
        });
      });
    }, OFFSCREEN_FRAME_INTERVAL_MS);
    return () => {
      window.clearInterval(timer);
      cancelAnimationFrame(frame);
      if (fence) context.deleteSync(fence);
    };
  }, [active, gl, invalidate]);
  return null;
}

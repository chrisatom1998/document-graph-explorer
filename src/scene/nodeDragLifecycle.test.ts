import { describe, expect, it, vi } from 'vitest';
import { startNodeDragLifecycle } from './nodeDragLifecycle';

describe('node drag lifecycle', () => {
  it('does not disable camera controls for a plain click', () => {
    const target = new EventTarget() as unknown as Window;
    const controls = { enabled: true };
    const lifecycle = startNodeDragLifecycle({
      target,
      controls,
      onMove: vi.fn(),
      onFinish: vi.fn(),
    });

    expect(controls.enabled).toBe(true);
    lifecycle.finish();
    expect(controls.enabled).toBe(true);
  });

  it.each(['pointerup', 'pointercancel', 'blur', 'pagehide'])(
    'restores camera controls after %s',
    (endEvent) => {
      const target = new EventTarget() as unknown as Window;
      const controls = { enabled: true };
      const onFinish = vi.fn();

      const lifecycle = startNodeDragLifecycle({
        target,
        controls,
        onMove: vi.fn(),
        onFinish,
      });

      lifecycle.engage();
      expect(controls.enabled).toBe(false);
      target.dispatchEvent(new Event(endEvent));
      expect(controls.enabled).toBe(true);
      expect(onFinish).toHaveBeenCalledOnce();
    },
  );

  it('finishes once when cleanup and a late browser event both run', () => {
    const target = new EventTarget() as unknown as Window;
    const controls = { enabled: true };
    const onFinish = vi.fn();
    const lifecycle = startNodeDragLifecycle({
      target,
      controls,
      onMove: vi.fn(),
      onFinish,
    });

    lifecycle.engage();
    lifecycle.finish();
    target.dispatchEvent(new Event('pointerup'));

    expect(controls.enabled).toBe(true);
    expect(onFinish).toHaveBeenCalledOnce();
  });

  it('ignores a late drag engagement after the gesture has finished', () => {
    const target = new EventTarget() as unknown as Window;
    const controls = { enabled: true };
    const lifecycle = startNodeDragLifecycle({
      target,
      controls,
      onMove: vi.fn(),
      onFinish: vi.fn(),
    });

    lifecycle.finish();
    lifecycle.engage();

    expect(controls.enabled).toBe(true);
  });
});

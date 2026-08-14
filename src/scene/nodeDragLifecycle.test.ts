import { describe, expect, it, vi } from 'vitest';
import { startNodeDragLifecycle } from './nodeDragLifecycle';

describe('node drag lifecycle', () => {
  it.each(['pointerup', 'pointercancel', 'blur'])(
    'restores camera controls after %s',
    (endEvent) => {
      const target = new EventTarget() as unknown as Window;
      const controls = { enabled: true };
      const onFinish = vi.fn();

      startNodeDragLifecycle({
        target,
        controls,
        onMove: vi.fn(),
        onFinish,
      });

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
    const finish = startNodeDragLifecycle({
      target,
      controls,
      onMove: vi.fn(),
      onFinish,
    });

    finish();
    target.dispatchEvent(new Event('pointerup'));

    expect(controls.enabled).toBe(true);
    expect(onFinish).toHaveBeenCalledOnce();
  });
});

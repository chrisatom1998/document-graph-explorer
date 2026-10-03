// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { useUiStore } from '../store/uiStore';
import AutoQuality from './AutoQuality';
import { useSettingsStore } from '../store/settingsStore';

const scene = vi.hoisted(() => ({
  frame: (_state: unknown, _delta: number): void => {},
  setDpr: vi.fn(),
  size: { width: 800, height: 600 },
  gl: {
    capabilities: { maxTextureSize: 8192 },
    getContext: () => ({ MAX_RENDERBUFFER_SIZE: 0x84e8, getParameter: () => 8192 }),
  },
}));

vi.mock('@react-three/fiber', () => ({
  useFrame: (callback: typeof scene.frame) => { scene.frame = callback; },
  useThree: (selector: (state: typeof scene) => unknown) => selector(scene),
}));
vi.mock('../layout/layoutBridge', () => ({ layoutPause: vi.fn(), layoutResume: vi.fn() }));
vi.mock('./dimensionTransition', () => ({ switchGraphDimensions: vi.fn() }));

describe('automatic quality recovery', () => {
  let now = 100;

  const runFrames = (seconds: number, fps: number) => {
    act(() => {
      for (let frame = 0; frame < seconds * fps; frame++) {
        now += 1000 / fps;
        scene.frame({}, 1 / fps);
      }
    });
  };

  beforeEach(() => {
    now = 100;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    useUiStore.setState({ autoQuality: true, qualityTier: 0, dims: 3, toasts: [] });
    useSettingsStore.setState({ graphClarity: 'high' });
    scene.setDpr.mockClear();
    vi.stubGlobal('devicePixelRatio', 2);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each([60, 120])('recovers after a slowdown on a %s Hz display', (fps) => {
    render(<AutoQuality />);
    runFrames(8, 30);
    expect(useUiStore.getState().qualityTier).toBeGreaterThan(0);
    runFrames(40, fps);
    expect(useUiStore.getState().qualityTier).toBe(0);
  });

  it('re-measures cadence after moving from a 120 Hz to a 60 Hz display', () => {
    useUiStore.setState({ qualityTier: 4 });
    render(<AutoQuality />);
    runFrames(3, 120);
    runFrames(40, 60);
    expect(useUiStore.getState().qualityTier).toBe(0);
  });

  it.each([30, 50])('does not promote quality without headroom at %s fps', (fps) => {
    useUiStore.setState({ qualityTier: 4 });
    render(<AutoQuality />);
    runFrames(40, fps);
    expect(useUiStore.getState().qualityTier).toBe(4);
  });

  it('requires sustained headroom before recovering', () => {
    useUiStore.setState({ qualityTier: 4 });
    render(<AutoQuality />);
    runFrames(4, 60);
    expect(useUiStore.getState().qualityTier).toBe(4);
    runFrames(4, 60);
    expect(useUiStore.getState().qualityTier).toBe(3);
  });

  it('preserves retina sharpness under load, with a separate performance option', () => {
    const publishRatio = vi.fn();
    render(<AutoQuality onPixelRatioChange={publishRatio} />);
    expect(scene.setDpr).toHaveBeenLastCalledWith(3);
    expect(publishRatio).toHaveBeenLastCalledWith(3);
    act(() => useUiStore.setState({ qualityTier: 4 }));
    expect(scene.setDpr).toHaveBeenLastCalledWith(2);
    act(() => useSettingsStore.setState({ graphClarity: 'performance' }));
    expect(scene.setDpr).toHaveBeenLastCalledWith(1);
    act(() => useSettingsStore.setState({ graphClarity: 'ultra' }));
    expect(scene.setDpr).toHaveBeenLastCalledWith(4);
    expect(publishRatio).toHaveBeenLastCalledWith(4);
  });

  it('recalculates resolution when the display scale changes', () => {
    render(<AutoQuality />);
    vi.stubGlobal('devicePixelRatio', 1);
    act(() => { window.dispatchEvent(new Event('resize')); });
    expect(scene.setDpr).toHaveBeenLastCalledWith(2);
  });
});

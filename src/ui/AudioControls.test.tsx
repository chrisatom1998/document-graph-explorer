// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import AudioControls, { useWaveform, type AudioControlState } from './AudioControls';
afterEach(cleanup);
const state = (): AudioControlState => ({ playing: false, currentTime: 0, duration: 12, volume: 1, available: true, peaks: [.2, .4], onToggle: vi.fn(), onSeek: vi.fn(), onVolume: vi.fn() });
describe('sample playback controls', () => {
  it('wires play, seek, and volume to the shared player', () => {
    const player = state(); render(<AudioControls state={player} dock />);
    fireEvent.click(screen.getByRole('button', { name: 'Play sample' }));
    expect(player.onToggle).toHaveBeenCalledOnce();
    fireEvent.change(screen.getByLabelText('Playback position'), { target: { value: '6' } });
    expect(player.onSeek).toHaveBeenCalledWith(6);
    fireEvent.change(screen.getByLabelText('Playback volume'), { target: { value: '.5' } });
    expect(player.onVolume).toHaveBeenCalledWith(.5);
  });
  it('disables playback and seeking when original audio is unavailable', () => {
    render(<AudioControls state={{ ...state(), available: false }} />);
    expect(screen.getByRole('button', { name: 'Play sample' })).toBeDisabled();
    expect(screen.getByLabelText('Sample position')).toBeDisabled();
  });
});

it('keeps playback available when the browser cannot create a waveform audio context', () => {
  vi.stubGlobal('AudioContext', class { constructor() { throw new DOMException('Too many audio contexts', 'NotSupportedError'); } });
  try {
    const blob = new Blob(['audio']);
    const { result } = renderHook(() => useWaveform(blob));
    expect(result.current).toEqual([]);
    render(<AudioControls state={{ ...state(), peaks: result.current }} />);
    expect(screen.getByRole('button', { name: 'Play sample' })).toBeEnabled();
  } finally { vi.unstubAllGlobals(); }
});

// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import VoiceQuery from './VoiceQuery';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('does not request the microphone until pressed and reports a denial', async () => {
  const getUserMedia = vi.fn(async () => { throw new DOMException('Denied', 'NotAllowedError'); });
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
  vi.stubGlobal('MediaRecorder', class {});
  render(<VoiceQuery onTranscript={vi.fn()} />);
  expect(getUserMedia).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Speak your request' }));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Microphone access was denied'));
  expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
});
it('stops a microphone granted after the panel has closed', async () => {
  let grant!: (value: MediaStream) => void;
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: () => new Promise<MediaStream>(resolve => { grant = resolve; }) } });
  vi.stubGlobal('MediaRecorder', class {});
  const stop = vi.fn();
  const { unmount } = render(<VoiceQuery onTranscript={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Speak your request' }));
  unmount();
  grant({ getTracks: () => [{ stop }] } as unknown as MediaStream);
  await waitFor(() => expect(stop).toHaveBeenCalledOnce());
});

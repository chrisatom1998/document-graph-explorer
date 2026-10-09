import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareListeningClips } from './copilotListening';
import { validateCopilotWave } from './copilotWave';
import { getOriginal } from '../persistence/originals';
import { openMusicDecoder } from './decodeMusic';
import type { DocNode } from '../model/types';

vi.mock('../persistence/originals', () => ({ getOriginal: vi.fn() }));
vi.mock('./decodeMusic', () => ({ openMusicDecoder: vi.fn() }));
const nodes = [{ id: 'one' }, { id: 'two' }] as DocNode[];
beforeEach(() => vi.resetAllMocks());
describe('listening excerpt preparation', () => {
  it('decodes bounded excerpts and sends only aliases and canonical audio', async () => {
    const close = vi.fn(); const read = vi.fn(async () => new Float32Array(16000));
    vi.mocked(getOriginal).mockResolvedValue({ blob: new Blob(), name: 'private.wav' } as never);
    vi.mocked(openMusicDecoder).mockResolvedValue({ durationSeconds: 300, read, close });
    const clips = await prepareListeningClips(nodes, new AbortController().signal);
    expect(read).toHaveBeenCalledWith(0, 10, 16000);
    expect(close).toHaveBeenCalledTimes(2);
    expect(clips.map(c => c.ref)).toEqual(['Sample 1', 'Sample 2']);
    expect(clips.every(c => validateCopilotWave(Buffer.from(c.wav, 'base64')) === 1)).toBe(true);
    expect(JSON.stringify(clips)).not.toContain('private.wav');
  });
  it('closes the decoder on failure and avoids uploads without all originals', async () => {
    const close = vi.fn();
    vi.mocked(getOriginal).mockResolvedValueOnce({ blob: new Blob(), name: 'private.wav' } as never);
    vi.mocked(openMusicDecoder).mockResolvedValue({ durationSeconds: 2, read: vi.fn(async () => { throw Error('Decode failed'); }), close });
    await expect(prepareListeningClips(nodes, new AbortController().signal)).rejects.toThrow('Decode failed');
    expect(close).toHaveBeenCalledOnce();
    vi.mocked(getOriginal).mockResolvedValue(undefined);
    await expect(prepareListeningClips(nodes, new AbortController().signal)).rejects.toThrow('original audio');
  });
  it('checks cancellation after asynchronous decoding and still releases resources', async () => {
    const controller = new AbortController(); const close = vi.fn();
    vi.mocked(getOriginal).mockResolvedValue({ blob: new Blob(), name: 'private.wav' } as never);
    vi.mocked(openMusicDecoder).mockResolvedValue({ durationSeconds: 2, read: vi.fn(async () => { controller.abort(); return new Float32Array(16000); }), close });
    await expect(prepareListeningClips(nodes, controller.signal)).rejects.toThrow();
    expect(close).toHaveBeenCalledOnce();
  });
});

// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocNode } from '../../model/types';
import type { OriginalFileRecord } from '../../persistence/db';
import { getOriginal } from '../../persistence/originals';
import { clearDecodedPeaks, useClipPeaks } from './parts';

const peaksFor = new Map<Blob, number[]>();
const decodedBlobs = new WeakSet<Blob>();
let decodeCount = 0;

vi.mock('../../persistence/originals', () => ({ getOriginal: vi.fn() }));
vi.mock('../../ui/AudioControls', () => {
  const empty: number[] = [];
  return {
    useWaveform: (blob: Blob | null) => {
      if (!blob) return empty;
      if (!decodedBlobs.has(blob)) { decodedBlobs.add(blob); decodeCount += 1; }
      return peaksFor.get(blob) ?? empty;
    },
  };
});

const clip = (id: string): DocNode => ({
  id, kind: 'document', title: id, fileType: 'audio', topics: [], entities: [], keywords: [], wordCount: 0, cluster: 0, degree: 0, status: 'ok',
});

const record = (id: string, bytes: string): OriginalFileRecord => {
  const blob = new Blob([bytes]);
  peaksFor.set(blob, id === 'a' ? [1, 0] : [0, 1]);
  return { hash: id, name: `${id}.wav`, blob };
};

describe('useClipPeaks', () => {
  beforeEach(() => {
    decodeCount = 0;
    clearDecodedPeaks();
    vi.mocked(getOriginal).mockReset();
  });

  it('does not read a file when decoding is off', () => {
    renderHook(() => useClipPeaks(clip('row'), 8, false));
    expect(getOriginal).not.toHaveBeenCalled();
  });

  it('does not store the previous clip when the next file is missing', async () => {
    const stored = new Map<string, OriginalFileRecord | undefined>([['a', record('a', 'aaa')]]);
    vi.mocked(getOriginal).mockImplementation(async id => stored.get(id));
    const { result, rerender } = renderHook(({ node }) => useClipPeaks(node, 4, true), { initialProps: { node: clip('a') } });
    await waitFor(() => expect(result.current.real).toBe(true));
    rerender({ node: clip('gone') });
    await waitFor(() => expect(getOriginal).toHaveBeenCalledWith('gone'));
    await waitFor(() => expect(result.current.real).toBe(false));
  });

  it('decodes a clip once, then reuses the peaks for the same file', async () => {
    vi.mocked(getOriginal).mockImplementation(async id => record(id, 'aaa'));
    const first = renderHook(() => useClipPeaks(clip('a'), 4, true));
    await waitFor(() => expect(first.result.current.real).toBe(true));
    const second = renderHook(() => useClipPeaks(clip('a'), 4, true));
    await waitFor(() => expect(second.result.current.real).toBe(true));
    expect(decodeCount).toBe(1);
  });
});

import { describe, expect, it } from 'vitest';
import type { DocNode } from '../model/types';
import type { MusicAnalysis } from './musicTypes';
import { clipShape, lastsWholeBars } from './clipShape';

const clip = (path: string, durationSeconds: number, tempo?: MusicAnalysis['tempo']): DocNode => ({
  id: path, kind: 'document', title: path.split('/').pop()!, path, fileType: 'audio', topics: [], entities: [], keywords: [], wordCount: 0, cluster: 0, degree: 0, status: 'ok',
  audio: { version: 2, durationSeconds, analyzedSeconds: Math.min(durationSeconds, 90), instruments: [], notes: [], ...(tempo ? { tempo } : {}) } as MusicAnalysis,
});

describe('clipShape', () => {
  it('trusts the file name, then the nearest folder that says', () => {
    expect(clipShape(clip('Pack/One Shots/Bass Loop C.wav', 3))).toBe('loop');
    expect(clipShape(clip('Pack/Drum Loops/Kick_One-Shot.wav', 0.4))).toBe('one-shot');
    expect(clipShape(clip('Pack/Melodic One Shots/Bell C.wav', 9))).toBe('one-shot');
    expect(clipShape(clip('Pack/Loop Stems/Helix 135 Kick.wav', 7.1))).toBe('loop');
  });
  it('calls a clip that lasts whole bars at a steady tempo a loop', () => {
    // 24 bars at 112 BPM, like the Cymatics melody loops; the BPM comes from the name.
    expect(clipShape(clip('Pack/Blender - 112 BPM D Min.wav', 51.43))).toBe('loop');
    expect(clipShape(clip('Pack/groove.wav', 8, { bpm: 120, confidence: 0.8 }))).toBe('loop');
    // Half-time estimate: the alternative tempo still fits.
    expect(clipShape(clip('Pack/groove2.wav', 6, { bpm: 80, confidence: 0.8, alternatives: [120] }))).toBe('loop');
  });
  it('leaves unsure clips out of both rather than guessing', () => {
    expect(clipShape(clip('Pack/groove.wav', 8, { bpm: 120, confidence: 0.3 }))).toBeUndefined();
    expect(clipShape(clip('Pack/pad.wav', 9.3, { bpm: 120, confidence: 0.8 }))).toBeUndefined();
    expect(clipShape(clip('Music/song.mp3', 240, { bpm: 120, confidence: 0.9 }))).toBeUndefined();
  });
  it('calls a short clip off the grid a one-shot', () => {
    expect(clipShape(clip('Pack/kick.wav', 0.6, { bpm: 120, confidence: 0.8 }))).toBe('one-shot');
    expect(clipShape(clip('Pack/hit.wav', 1.2))).toBe('one-shot');
  });
  it('allows a little slack for trimmed tails', () => {
    expect(lastsWholeBars(8.05, 120)).toBe(true);
    expect(lastsWholeBars(8.2, 120)).toBe(false);
    expect(lastsWholeBars(0.9, 120)).toBe(false);
  });
});

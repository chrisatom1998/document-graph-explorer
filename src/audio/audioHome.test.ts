import { describe, expect, it } from 'vitest';
import type { DocNode } from '../model/types';
import { forYouShelves, isAudioLibrary } from './audioHome';

const clip = (id: string, title: string, embedding?: number[]): DocNode => ({
  id, kind: 'document', title, fileType: 'audio', topics: [], keywords: [], entities: [],
  wordCount: 0, cluster: -1, degree: 0, status: 'ok',
  audio: embedding
    ? { version: 2, durationSeconds: 4, analyzedSeconds: 4, instruments: [], notes: [], embedding }
    : { version: 2, durationSeconds: 4, analyzedSeconds: 4, instruments: [], notes: [] },
});

const unit = (hot: number[]) => {
  const vector = new Array(512).fill(0);
  hot.forEach((index, place) => { vector[index] = 1 - place * 0.01; });
  const norm = Math.hypot(...vector);
  return vector.map(value => value / norm);
};

describe('audio library home', () => {
  it('treats a library as audio only when every document is a sound', () => {
    expect(isAudioLibrary([clip('a', 'Pad')])).toBe(true);
    expect(isAudioLibrary([])).toBe(false);
    const note: DocNode = { ...clip('note', 'Note'), fileType: 'txt', audio: undefined };
    expect(isAudioLibrary([clip('a', 'Pad'), note])).toBe(false);
  });

  it('ranks the Sounds like shelf by the stored fingerprint', () => {
    const focus = clip('focus', 'Pad', unit([1, 2, 3]));
    const alike = clip('alike', 'Pluck', unit([1, 2, 3, 4]));
    const other = clip('other', 'Kick', unit([300, 301, 302]));
    const shelves = forYouShelves(focus, [focus, other, alike], []);
    const similar = shelves.find(shelf => shelf.id === 'similar');
    expect(similar?.title).toBe('Sounds like Pad');
    expect(similar?.items.map(item => item.id)).toEqual(['alike']);
    expect(similar?.subtitle).toMatch(/fingerprint/i);
  });

  it('groups loops and one-shots from their names', () => {
    const focus = clip('focus', 'Hat one-shot');
    const loop = clip('loop', 'Bass loop');
    const shelves = forYouShelves(focus, [focus, loop], []);
    expect(shelves.find(shelf => shelf.id === 'shots')?.items.map(item => item.id)).toEqual(['focus']);
    expect(shelves.find(shelf => shelf.id === 'loops')?.items.map(item => item.id)).toEqual(['loop']);
  });
});

import { describe, expect, it } from 'vitest';
import type { DocNode, Edge } from '../../model/types';
import type { MusicAnalysis } from '../../audio/musicTypes';
import { clipFacts, clipTags, clock, neighborsOf, shelvesFor } from './library';

const clip = (path: string, durationSeconds: number, cluster = 0): DocNode => ({
  id: path, kind: 'document', title: path.split('/').pop()!.replace('.wav', ''), path, fileType: 'audio', topics: [], entities: [], keywords: [], wordCount: 0, cluster, degree: 0, status: 'ok',
  audio: { version: 2, durationSeconds, analyzedSeconds: durationSeconds, instruments: [], notes: [] } as MusicAnalysis,
});
const edge = (source: string, target: string, kind: Edge['kind'], weight: number): Edge => ({ id: `${source}->${target}:${kind}`, source, target, kind, weight, evidence: ['test'] });

const pad = clip('demo/pad-loop-Am-100.wav', 2.4);
const bass = clip('demo/bass-loop-A-120.wav', 2);
const shaker = clip('demo/shaker-loop-120.wav', 2);
const kick = clip('demo/kick-one-shot.wav', 0.4);
const docs = [pad, bass, shaker, kick];
const index = Object.fromEntries(docs.map((d, i) => [d.id, i]));

describe('music design library helpers', () => {
  it('reads key, tempo and shape from the file name like the inspector does', () => {
    expect(clipFacts(pad)).toMatchObject({ bpm: 100, key: 'A minor', shape: 'Loop', kind: 'Sample' });
    expect(clipFacts(kick).shape).toBe('One-shot');
  });
  it('lists every tag category, key and tempo first, without duplicates', () => {
    const tags = clipTags(pad);
    expect(tags.slice(0, 3)).toEqual([
      { group: 'Key', label: 'A minor' },
      { group: 'Tempo', label: '100 BPM' },
      { group: 'Shape', label: 'Loop' },
    ]);
    expect(new Set(tags.map(t => `${t.group}:${t.label}`)).size).toBe(tags.length);
  });
  it('orders neighbours by their strongest link and names each reason once', () => {
    const edges = [edge(bass.id, shaker.id, 'tempo', 0.6), edge(bass.id, pad.id, 'title', 0.4), edge(bass.id, shaker.id, 'title', 0.9)];
    const near = neighborsOf(bass.id, docs, index, edges);
    expect(near.map(n => n.node.id)).toEqual([shaker.id, pad.id]);
    expect(near[0].reasons).toEqual(['Similar tempo', 'Similar name']);
  });
  it('builds shelves around the focus clip', () => {
    const near = neighborsOf(bass.id, docs, index, [edge(bass.id, shaker.id, 'tempo', 0.6)]);
    const shelves = shelvesFor(bass, docs, near);
    expect(shelves.map(s => s.id)).toEqual(['similar', 'tempo', 'keys', 'loops', 'shots']);
    expect(shelves.find(s => s.id === 'tempo')?.items.map(n => n.id)).toEqual([shaker.id]);
  });
  it('formats short clips in seconds and longer ones as a clock', () => {
    expect(clock(0.4)).toBe('0.4 s');
    expect(clock(75)).toBe('1:15');
    expect(clock(null)).toBe('--:--');
  });
});

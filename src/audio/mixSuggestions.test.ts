import { describe, expect, it } from 'vitest';
import type { DocNode } from '../model/types';
import type { MusicAnalysis } from './musicTypes';
import { camelotCode, camelotRelation, mixSuggestions, tempoMatch } from './mixSuggestions';

const node = (id: string, features: Partial<MusicAnalysis> = {}, path?: string): DocNode => ({ id, title: id, path, kind: 'document', fileType: 'audio', wordCount: 0, topics: [], entities: [], keywords: [], degree: 0, cluster: 0, status: 'ok', audio: { version: 2, durationSeconds: 100, analyzedSeconds: 60, instruments: [], notes: [], ...features } });
const tempo = (bpm: number, confidence = .9) => ({ bpm, confidence });
const key = (tonic: number, mode: 'major' | 'minor' = 'minor', strength = .9) => ({ tonic, mode, strength });
const vec = (angle: number) => Array.from({ length: 512 }, (_, i) => i === 0 ? Math.cos(angle) : i === 1 ? Math.sin(angle) : 0);

describe('Camelot codes', () => {
  it('maps every key onto the wheel', () => {
    expect(camelotCode({ tonic: 0, mode: 'major' })).toBe('8B');
    expect(camelotCode({ tonic: 9, mode: 'minor' })).toBe('8A');
    expect(camelotCode({ tonic: 7, mode: 'major' })).toBe('9B');
    expect(camelotCode({ tonic: 2, mode: 'minor' })).toBe('7A');
    expect(camelotCode({ tonic: 11, mode: 'major' })).toBe('1B');
    expect(camelotCode({ tonic: 8, mode: 'minor' })).toBe('1A');
    const codes = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].flatMap(tonic => (['major', 'minor'] as const).map(mode => camelotCode({ tonic, mode }))));
    expect(codes.size).toBe(24);
  });
  it('classifies harmonic relations', () => {
    const am = { tonic: 9, mode: 'minor' as const };
    expect(camelotRelation(am, am)).toBe('same key');
    expect(camelotRelation(am, { tonic: 4, mode: 'minor' })).toBe('adjacent'); // 9A
    expect(camelotRelation(am, { tonic: 2, mode: 'minor' })).toBe('adjacent'); // 7A
    expect(camelotRelation(am, { tonic: 0, mode: 'major' })).toBe('relative'); // 8B
    expect(camelotRelation(am, { tonic: 7, mode: 'major' })).toBe('diagonal'); // 9B
    expect(camelotRelation(am, { tonic: 11, mode: 'minor' })).toBe('two steps'); // 10A
    expect(camelotRelation(am, { tonic: 3, mode: 'minor' })).toBe('clash'); // 2A
    // 12A and 1A wrap around.
    expect(camelotRelation({ tonic: 1, mode: 'minor' }, { tonic: 8, mode: 'minor' })).toBe('adjacent');
  });
});

describe('tempo matching', () => {
  it('allows half and double time', () => {
    expect(tempoMatch(128, 126)).toMatchObject({ relation: 'same' });
    expect(tempoMatch(170, 86).relation).toBe('double');
    expect(tempoMatch(85, 172).relation).toBe('half');
    expect(tempoMatch(128, 126).changePct).toBeCloseTo(100 * 2 / 126);
  });
});

describe('mix suggestions', () => {
  it('ranks compatible key and tempo first and drops tracks outside the pitch range', () => {
    const target = node('target', { tempo: tempo(128), key: key(9) });
    const rows = mixSuggestions(target, [
      target,
      node('perfect', { tempo: tempo(128), key: key(9) }),
      node('adjacent', { tempo: tempo(126), key: key(4) }),
      node('clash', { tempo: tempo(128), key: key(3) }),
      node('half', { tempo: tempo(64), key: key(9) }),
      node('tooFast', { tempo: tempo(140), key: key(9) }),
    ]);
    expect(rows.map(r => r.node.id)).toEqual(['perfect', 'half', 'adjacent', 'clash']);
    expect(rows[0]).toMatchObject({ camelot: '8A', keyRelation: 'same key', tempoRelation: 'same', bpm: 128 });
    expect(rows[1].tempoRelation).toBe('double');
    expect(rows[3].reasons.join(' ')).toContain('keys clash');
  });
  it('uses file-name BPM and key like graph links do', () => {
    const target = node('a', {}, 'loops/SHADOW_UK1_Melodic_Loop_Ice_Dm_140.wav');
    const rows = mixSuggestions(target, [node('b', { tempo: tempo(100), key: key(0, 'major') }, 'loops/Other_Am_70.wav'), node('c', { key: key(2) })]);
    expect(rows.map(r => r.node.id)).toEqual(['b', 'c']);
    expect(rows[0]).toMatchObject({ camelot: '8A', keyRelation: 'adjacent', tempoRelation: 'double', bpm: 70 });
    expect(rows[1]).toMatchObject({ camelot: '7A', keyRelation: 'same key' });
  });
  it('breaks ties between equally mixable tracks by how alike they sound', () => {
    const target = node('t', { tempo: tempo(124), key: key(5, 'major'), embedding: vec(0) });
    const rows = mixSuggestions(target, [
      node('far', { tempo: tempo(124), key: key(5, 'major'), embedding: vec(1.2) }),
      node('near', { tempo: tempo(124), key: key(5, 'major'), embedding: vec(.2) }),
    ]);
    expect(rows.map(r => r.node.id)).toEqual(['near', 'far']);
    expect(rows[0].reasons.at(-1)).toMatch(/sounds 9\d% alike/);
    expect(rows[1].reasons.join(' ')).not.toContain('alike');
  });
  it('never suggests a track on sound alone', () => {
    const target = node('t', { embedding: vec(0) });
    expect(mixSuggestions(target, [node('twin', { embedding: vec(.05) })])).toEqual([]);
    const keyed = node('k', { key: key(9), embedding: vec(0) });
    expect(mixSuggestions(keyed, [node('clash', { key: key(3), embedding: vec(.05) })])).toEqual([]);
  });
  it('ignores uncertain estimates and non-audio nodes', () => {
    const target = node('t', { tempo: tempo(120), key: key(0) });
    const doc = { ...node('doc'), fileType: 'pdf' } as DocNode;
    expect(mixSuggestions(target, [doc, node('weak', { tempo: tempo(120, .2), key: key(0, 'minor', .3) })])).toEqual([]);
    expect(mixSuggestions(doc, [target])).toEqual([]);
  });
  it('respects the limit', () => {
    const target = node('t', { tempo: tempo(120) });
    const many = Array.from({ length: 30 }, (_, i) => node(`n${i}`, { tempo: tempo(120) }));
    expect(mixSuggestions(target, many)).toHaveLength(10);
    expect(mixSuggestions(target, many, { limit: 3 })).toHaveLength(3);
  });
});

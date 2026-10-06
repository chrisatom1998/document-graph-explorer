import type { DocNode } from '../model/types';
import { musicNameHints } from './nameHints';
import { keyName, type MusicAnalysis } from './musicTypes';

type Key = { tonic: number; mode: 'major' | 'minor' };
export type KeyRelation = 'same key' | 'adjacent' | 'relative' | 'diagonal' | 'two steps' | 'clash';
export type TempoRelation = 'same' | 'half' | 'double';
export interface MixSuggestion {
  node: DocNode;
  /** 0-1 ranking score; describes evidence agreement, not a probability that the mix works. */
  score: number;
  bpm?: number;
  camelot?: string;
  keyRelation?: KeyRelation;
  tempoRelation?: TempoRelation;
  /** Percent the other track's tempo must change to match this one (after halving/doubling). */
  tempoChangePct?: number;
  similarity?: number;
  reasons: string[];
}
export interface MixOptions { limit?: number; tempoTolerancePct?: number }

/** Camelot wheel code: minor keys are A, major keys B; C major = 8B, A minor = 8A. */
export function camelotCode(key: Key): string {
  const number = ((7 * key.tonic + (key.mode === 'major' ? 7 : 4)) % 12) + 1;
  return `${number}${key.mode === 'major' ? 'B' : 'A'}`;
}
function camelotParts(key: Key) { return { number: ((7 * key.tonic + (key.mode === 'major' ? 7 : 4)) % 12) + 1, letter: key.mode === 'major' ? 'B' : 'A' }; }
const KEY_SCORE: Record<KeyRelation, number> = { 'same key': 1, adjacent: .85, relative: .85, diagonal: .55, 'two steps': .4, clash: 0 };
const KEY_TEXT: Record<KeyRelation, string> = {
  'same key': 'same key', adjacent: 'one step on the Camelot wheel', relative: 'relative major/minor',
  diagonal: 'one step and major/minor switch', 'two steps': 'two steps on the Camelot wheel', clash: 'keys clash',
};
export function camelotRelation(a: Key, b: Key): KeyRelation {
  const x = camelotParts(a), y = camelotParts(b);
  const step = Math.min((x.number - y.number + 12) % 12, (y.number - x.number + 12) % 12);
  if (x.letter === y.letter) return step === 0 ? 'same key' : step === 1 ? 'adjacent' : step === 2 ? 'two steps' : 'clash';
  return step === 0 ? 'relative' : step === 1 ? 'diagonal' : 'clash';
}

const validScore = (n: number) => Number.isFinite(n) && n >= 0 && n <= 1;
/** Same evidence and gates as graph tempo/key links: file-name tags win over audio estimates. */
export function mixFeatures(node: DocNode): Features {
  // Nodes are replaced, not mutated, when analysis or names change, so the node object is a safe cache key.
  let features = featureCache.get(node);
  if (!features) featureCache.set(node, features = projectFeatures(node));
  return features;
}
function projectFeatures(node: DocNode) {
  const audio = node.audio as MusicAnalysis;
  const hints = musicNameHints(node);
  const tempo = hints.tempo ? { bpm: hints.tempo.value, confidence: .65, source: hints.tempo.source } : audio.tempo && { ...audio.tempo, source: 'audio estimate' as const };
  const key = hints.key ? { ...hints.key.value, strength: .65, source: hints.key.source, display: hints.key.displayName } : audio.key && { ...audio.key, source: 'audio estimate' as const, display: keyName(audio.key) };
  // Keep the saved embedding and its inverse norm rather than copying a normalized 512-value array per track.
  let vector: { values: number[]; scale: number } | undefined;
  if (audio.embedding?.length === 512) {
    let sum = 0;
    for (const v of audio.embedding) sum += v * v;
    const norm = Math.sqrt(sum);
    if (Number.isFinite(norm) && norm > 1e-8) vector = { values: audio.embedding, scale: 1 / norm };
  }
  return {
    tempo: tempo && tempo.bpm >= 40 && tempo.bpm <= 250 && validScore(tempo.confidence) && tempo.confidence >= .5 ? tempo : undefined,
    key: key && Number.isInteger(key.tonic) && key.tonic >= 0 && key.tonic < 12 && validScore(key.strength) && key.strength >= .6 ? key : undefined,
    vector,
  };
}
type Features = ReturnType<typeof projectFeatures>;
const featureCache = new WeakMap<DocNode, Features>();

/** Best of same, half and double time; `changePct` is how far the candidate must be pitched to match. */
export function tempoMatch(target: number, other: number): { relation: TempoRelation; changePct: number } {
  const options: { relation: TempoRelation; bpm: number }[] = [{ relation: 'same', bpm: other }, { relation: 'double', bpm: other * 2 }, { relation: 'half', bpm: other / 2 }];
  return options.map(o => ({ relation: o.relation, changePct: Math.abs(target - o.bpm) / o.bpm * 100 }))
    .sort((a, b) => a.changePct - b.changePct)[0];
}

/** CLAP cosines between unrelated music sit around .5; .9+ is very close. */
const soundScore = (similarity: number) => Math.max(0, Math.min(1, (similarity - .5) / .4));

function suggestion(target: Features, node: DocNode, other: Features, tolerance: number): MixSuggestion | null {
  const reasons: string[] = [];
  const row: MixSuggestion = { node, score: 0, reasons };
  if (other.tempo) row.bpm = other.tempo.bpm;
  if (other.key) row.camelot = camelotCode(other.key);
  let tempoScore = 0, keyScore = 0, sound = 0;
  if (target.tempo && other.tempo) {
    const match = tempoMatch(target.tempo.bpm, other.tempo.bpm);
    // Tracks a DJ can't beatmatch within the pitch range are not mix suggestions, however alike they sound.
    if (match.changePct > tolerance) return null;
    row.tempoRelation = match.relation;
    row.tempoChangePct = match.changePct;
    tempoScore = (1 - .5 * match.changePct / tolerance) * (match.relation === 'same' ? 1 : .8) * Math.min(target.tempo.confidence, other.tempo.confidence);
    const pct = match.changePct < .05 ? 'same tempo' : `${match.changePct.toFixed(1)}% tempo change`;
    reasons.push(`${other.tempo.bpm.toFixed(0)} BPM${match.relation === 'same' ? '' : ` (${match.relation} time)`}: ${pct}`);
  }
  if (target.key && other.key) {
    const relation = camelotRelation(target.key, other.key);
    row.keyRelation = relation;
    keyScore = KEY_SCORE[relation] * Math.min(target.key.strength, other.key.strength);
    reasons.push(`${camelotCode(other.key)} (${other.key.display}): ${KEY_TEXT[relation]}`);
  }
  if (target.vector && other.vector) {
    const a = target.vector.values, b = other.vector.values;
    let dot = 0;
    for (let i = 0; i < 512; i++) dot += a[i] * b[i];
    dot *= target.vector.scale * other.vector.scale;
    row.similarity = dot;
    sound = soundScore(dot);
    if (dot >= .7) reasons.push(`sounds ${Math.floor(dot * 100)}% alike`);
  }
  // Key and tempo decide whether two tracks mix; sound-alike only breaks ties between compatible tracks.
  if (tempoScore <= 0 && keyScore <= 0) return null;
  row.score = .4 * tempoScore + .4 * keyScore + .2 * sound;
  return row;
}

/** Rank the rest of the library as tracks to mix into or out of `target`. */
export function mixSuggestions(target: DocNode, nodes: DocNode[], options: MixOptions = {}): MixSuggestion[] {
  if (target.fileType !== 'audio' || !target.audio) return [];
  const { limit = 10, tempoTolerancePct = 6 } = options;
  if (limit < 1) return [];
  const self = mixFeatures(target);
  if (!self.tempo && !self.key && !self.vector) return [];
  const order = (a: MixSuggestion, b: MixSuggestion) => b.score - a.score || a.node.title.localeCompare(b.node.title) || a.node.id.localeCompare(b.node.id);
  // Keep only the best `limit` rows so large libraries never sort every candidate.
  const rows: MixSuggestion[] = [];
  for (const node of nodes) {
    if (node.id === target.id || node.fileType !== 'audio' || !node.audio) continue;
    const row = suggestion(self, node, mixFeatures(node), tempoTolerancePct);
    if (!row || (rows.length >= limit && order(row, rows[rows.length - 1]) >= 0)) continue;
    let at = rows.length;
    while (at > 0 && order(row, rows[at - 1]) < 0) at--;
    rows.splice(at, 0, row);
    if (rows.length > limit) rows.pop();
  }
  return rows;
}

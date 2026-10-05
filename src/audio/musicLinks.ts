import { musicNameHints } from './nameHints';
import { confirmedInstrumentList, reliableInstruments, sourceReviewAllows } from './instrumentEvidence';
import { soundMatchLabels, MATCH_ORIGIN_TEXT, type MatchLabel } from './soundMatchLabels';
import { confidentSoundSummary } from './confidentSoundSummary';
import type { DocNode, Edge } from '../model/types';
import { keyName, type MusicAnalysis } from './musicTypes';
export const MUSIC_EDGE_KINDS = ['tempo', 'key', 'instrument', 'sound', 'similar'] as const;
type MusicKind = typeof MUSIC_EDGE_KINDS[number];
export const MUSIC_NEIGHBOR_LIMIT = 8;
export const MUSIC_NEIGHBORS_PER_KIND = 4;
const CANDIDATES_PER_BUCKET = 12;
const MAX_CANDIDATES = 128;
/** CLAP audio cosines run high, so each track's `neighbors` closest sounds are always candidates and a pair links
 * at `floor` or above. A mutual-top-3 rule at 0.5 was tried with scripts/sound-links: more song links but lower
 * precision (45% vs 63% same genre), so this keeps the original policy. */
export interface SoundLinkPolicy { neighbors: number; floor: number }
export const SOUND_LINK_POLICY: SoundLinkPolicy = { neighbors: 3, floor: .7 };
/** All-pairs similarity up to this many fingerprints; larger libraries compare within hashed neighbourhoods. */
const EXACT_SIMILARITY_LIMIT = 800;
const cosine = (a: number[], b: number[]) => { let dot = 0; for (let i = 0; i < a.length; i++) dot += a[i] * b[i]; return dot; };
const validScore = (n: number) => Number.isFinite(n) && n >= 0 && n <= 1;
function keyRelation(a: NonNullable<MusicAnalysis['key']>, b: NonNullable<MusicAnalysis['key']>): string | null {
  if (a.tonic === b.tonic && a.mode === b.mode) return 'same estimated key';
  const relative = a.mode === 'major' ? (a.tonic + 9) % 12 === b.tonic : (b.tonic + 9) % 12 === a.tonic;
  if (a.mode !== b.mode && relative) return 'relative major/minor keys';
  if (a.mode === b.mode && [5, 7].includes((a.tonic - b.tonic + 12) % 12)) return 'neighboring keys on the circle of fifths';
  return null;
}
/** Project evidence once per rebuild; never mutate saved estimates or corrections. */
function features(node: DocNode) {
  const audio = node.audio!;
  const hints = musicNameHints(node);
  const tempo = hints.tempo ? { bpm: hints.tempo.value, confidence: .65 } : audio.tempo;
  const key = hints.key ? { ...hints.key.value, strength: .65 } : audio.key;
  const human = confirmedInstrumentList(audio) !== undefined;
  // Names are useful search clues, but cannot replace stronger audio evidence.
  const reliable = reliableInstruments(audio);
  const named = !human && !reliable.length && hints.instruments;
  const base = named ? named.value.filter(label => sourceReviewAllows(audio, label)).map(label => ({ label, score: .45 })) : reliable;
  // Source labels the panel's Sounds / Other model guesses sections show also count, at their own strength.
  const matches = soundMatchLabels(node);
  const shownSources = matches.filter(m => m.group === 'source' && !(human && m.origin !== 'confirmed'));
  const instruments = [...base, ...shownSources.filter(m => !base.some(i => i.label === m.label)).map(m => ({ label: m.label, score: m.weight }))];
  return {
    node, hints, human, matches, shownSources, vector: audio.embedding && audio.embedding.length === 512 ? audio.embedding : undefined,
     named: !!named, instruments: instruments.filter(i => validScore(i.score)),
    tempo: tempo && Number.isFinite(tempo.bpm) && tempo.bpm >= 40 && tempo.bpm <= 250 && validScore(tempo.confidence) && tempo.confidence >= .5 ? tempo : undefined,
    key: key && Number.isInteger(key.tonic) && key.tonic >= 0 && key.tonic < 12 && ['major','minor'].includes(key.mode) && validScore(key.strength) && key.strength >= .6 ? key : undefined,
    // Exactly what the Sounds and Other model guesses sections list; rejected/unsure reviews are already excluded.
    sound: matches.filter(m => m.group !== 'source'),
    // The Sounds panel's tested tags (and your confirmations) explain what two similar-sounding tracks share.
    alikeTags: confidentSoundSummary(audio).filter(t => t.origin === 'confirmed by you' || (!t.maybe && t.tier === 'likely')),
  };
}
type Features = ReturnType<typeof features>;
function pairEdges(a: Features, b: Features, floor = SOUND_LINK_POLICY.floor): Edge[] {
  const [source, target] = [a.node.id, b.node.id].sort();
  const edges: Edge[] = [];
  const add = (kind: MusicKind, weight: number, evidence: string) => edges.push({ id: `${source}->${target}:${kind}`, source, target, kind, weight, evidence: [evidence, 'Match strength reflects available evidence, not a probability. Musical similarities are not proof of sampling or influence.'] });
  const sources = (kind: 'tempo' | 'key') => ` Sources: ${a.hints[kind]?.source ?? 'audio estimate'} and ${b.hints[kind]?.source ?? 'audio estimate'}. Name tags are not verified audio detections.`;
  if (a.tempo && b.tempo) {
    const at = a.tempo.bpm; const bt = b.tempo.bpm;
    const low = Math.min(at, bt); const high = Math.max(at, bt);
    const directDelta = high - low;
    const directTolerance = Math.max(3, low * .04);
    const halfDelta = Math.abs(high - low * 2);
    const halfTolerance = Math.max(3, high * .04);
    const direct = directDelta <= directTolerance;
    if (direct || halfDelta <= halfTolerance) {
      const proximity = 1 - (direct ? directDelta / directTolerance : halfDelta / halfTolerance);
      const weight = Math.min(a.tempo.confidence, b.tempo.confidence) * (.7 + .3 * proximity) * (direct ? 1 : .75);
      const reason = direct
        ? `Similar estimated tempo: ${at.toFixed(1)} and ${bt.toFixed(1)} BPM (${directDelta.toFixed(1)} BPM apart).`
        : `Half/double-time tempo: ${at.toFixed(1)} and ${bt.toFixed(1)} BPM (${halfDelta.toFixed(1)} BPM apart after doubling ${low.toFixed(1)}). Related pulse rates, not the same measured tempo.`;
      add('tempo', weight, reason + (a.hints.tempo || b.hints.tempo ? sources('tempo') : ' Based on audio estimates.'));
    }
  }
  if (a.key && b.key) {
    const relation = keyRelation(a.key, b.key);
    if (relation) add('key', Math.min(a.key.strength, b.key.strength) * (relation === 'same estimated key' ? 1 : .8), `${a.hints.key?.displayName ?? keyName(a.key)} and ${b.hints.key?.displayName ?? keyName(b.key)}: ${relation}.${a.hints.key || b.hints.key ? sources('key') : ' Based on audio estimates.'}`);
  }
  const shared = a.instruments.filter(i => b.instruments.some(j => j.label === i.label));
  if (shared.length) {
    const hasName = a.named || b.named;
    const provenance = hasName
      ? `Sources: ${a.human ? 'confirmed by you' : a.named ? a.hints.instruments!.source : 'audio estimate'} and ${b.human ? 'confirmed by you' : b.named ? b.hints.instruments!.source : 'audio estimate'}. Name tags are not verified audio detections.`
      : a.human && b.human ? 'Confirmed by you on both tracks.'
      : a.human || b.human ? 'Confirmed by you on one track; estimated from audio on the other.'
      : 'Supported by strong or repeated audio detections; not confirmed instrumentation.';
    const modelShown = shared.some(i => [a, b].some(f => f.shownSources.some(m => m.label === i.label && m.origin !== 'confirmed')));
    add('instrument', Math.max(...shared.map(i => Math.min(i.score, b.instruments.find(j => j.label === i.label)!.score))), `${hasName ? 'Shared instrument hints' : 'Shared instruments'}: ${shared.map(i => i.label).join(', ')}. ${provenance}${modelShown ? ' Includes source labels from the Sounds / Other model guesses lists, which are model estimates or untested guesses.' : ''}`);
  }
  const find = (side: MatchLabel[], i: MatchLabel) => side.find(j => j.group === i.group && j.label === i.label);
  const sound = a.sound.filter(i => find(b.sound, i));
  if (sound.length) {
    const pairs = sound.map(i => ({ i, other: find(b.sound, i)! }));
    const confirmed = pairs.every(({ i, other }) => i.origin === 'confirmed' && other.origin === 'confirmed');
    const names = pairs.map(({ i }) => `${i.label} (${i.group === 'production' ? 'production / effect' : 'character'})`).join(', ');
    const basis = pairs.map(({ i, other }) => `${i.label}: ${MATCH_ORIGIN_TEXT[i.origin]} / ${MATCH_ORIGIN_TEXT[other.origin]}`).join('; ');
    add('sound', Math.max(...pairs.map(({ i, other }) => Math.min(i.weight, other.weight))), `Shared sound properties: ${names}. ${confirmed ? 'Confirmed by you on both tracks.' : `Not confirmed by you on at least one track (${basis}). Matches the Sounds and Other model guesses lists.`}`);
  }
  const similarity = a.vector && b.vector ? cosine(a.vector, b.vector) : undefined;
  if (similarity !== undefined && similarity >= floor) {
    // Tags already explained by the instrument link are not repeated.
    const both = a.alikeTags.filter(t => b.alikeTags.some(u => u.dimension === t.dimension && u.label === t.label) && !(t.dimension === 'source' && shared.some(i => i.label === t.label)));
    const confirmed = both.filter(t => t.origin === 'confirmed by you' && b.alikeTags.find(u => u.dimension === t.dimension && u.label === t.label)!.origin === 'confirmed by you');
    const detail = both.length ? ` Both also have: ${both.map(t => `${t.label.replaceAll('_', ' ')} (${t.dimension === 'effect' ? 'production / effect' : t.dimension})`).join(', ')}${confirmed.length === both.length ? ', confirmed by you on both tracks' : confirmed.length ? ', some confirmed by you' : ', detected by tested sound models'}.` : '';
    add('similar', Math.min(1, similarity), `Sounds alike: the two recordings' sound fingerprints are ${Math.floor(similarity * 100)}% similar.${detail} Similar sound is not proof of sampling, a shared source or influence.`);
  }
  return edges;
}
export function musicPairEdges(a: DocNode, b: DocNode): Edge[] {
  if (a.fileType !== 'audio' || b.fileType !== 'audio' || !a.audio || !b.audio || a.id === b.id) return [];
  return pairEdges(features(a), features(b));
}
const keyToken = (k: NonNullable<Features['key']>) => `k:${k.tonic}:${k.mode}`;
function tokens(f: Features, query = false): string[] {
  const result = [...f.instruments.map(i => `i:${i.label}`), ...f.sound.map(i => `s:${i.group === 'production' ? 'effect' : 'character'}:${i.label}`)];
  if (f.key) {
    result.push(keyToken(f.key));
    if (query) {
      result.push(keyToken({ ...f.key, tonic: (f.key.tonic + 5) % 12 }), keyToken({ ...f.key, tonic: (f.key.tonic + 7) % 12 }));
      result.push(keyToken({ ...f.key, tonic: (f.key.tonic + (f.key.mode === 'major' ? 9 : 3)) % 12, mode: f.key.mode === 'major' ? 'minor' : 'major' }));
    }
  }
  if (f.tempo) for (const bpm of query ? [f.tempo.bpm, f.tempo.bpm * 2, f.tempo.bpm / 2] : [f.tempo.bpm]) {
    const bin = Math.floor(bpm / 10);
    for (const delta of query ? [-1,0,1] : [0]) result.push(`t:${bin + delta}`);
  }
  return result;
}
/** Deterministic random hyperplanes (fixed seed) for libraries too large to compare all pairs. */
function hyperplanes(count: number, dimensions: number): Float32Array[] {
  let seed = 0x2f6b1d3;
  const next = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32 - .5; };
  return Array.from({ length: count }, () => Float32Array.from({ length: dimensions }, next));
}
/** Each fingerprinted track's closest-sounding tracks (by index), most similar first. */
function soundNeighbors(audio: Features[], keep: number): Map<number, { other: number; similarity: number }[]> {
  const result = new Map<number, { other: number; similarity: number }[]>();
  const members = audio.flatMap((f, i) => f.vector ? [i] : []);
  const vector = (i: number) => audio[i].vector!;
  const offer = (i: number, other: number, similarity: number) => {
    const list = result.get(i) ?? [];
    if (list.length >= keep && similarity <= list[list.length - 1].similarity) return;
    list.push({ other, similarity });
    list.sort((x, y) => y.similarity - x.similarity || x.other - y.other);
    if (list.length > keep) list.pop();
    result.set(i, list);
  };
  if (members.length <= EXACT_SIMILARITY_LIMIT) {
    for (let x = 0; x < members.length; x++) for (let y = x + 1; y < members.length; y++) {
      const similarity = cosine(vector(members[x]), vector(members[y]));
      offer(members[x], members[y], similarity); offer(members[y], members[x], similarity);
    }
    return result;
  }
  // Hash the common-component-removed fingerprints into buckets; compare within shared buckets only.
  const dimensions = vector(members[0]).length;
  const mean = new Float32Array(dimensions);
  for (const i of members) { const v = vector(i); for (let d = 0; d < dimensions; d++) mean[d] += v[d] / members.length; }
  const TABLES = 12, BITS = 10, planes = hyperplanes(TABLES * BITS, dimensions);
  const buckets = new Map<string, number[]>();
  const codes = members.map(i => {
    const v = vector(i);
    return Array.from({ length: TABLES }, (_, t) => {
      let code = 0;
      for (let b = 0; b < BITS; b++) { const p = planes[t * BITS + b]; let dot = 0; for (let d = 0; d < dimensions; d++) dot += p[d] * (v[d] - mean[d]); code = code * 2 + (dot > 0 ? 1 : 0); }
      return `${t}:${code}`;
    });
  });
  members.forEach((i, m) => { for (const code of codes[m]) { const list = buckets.get(code) ?? []; list.push(i); buckets.set(code, list); } });
  members.forEach((i, m) => {
    const seen = new Set<number>();
    for (const code of codes[m]) for (const other of buckets.get(code)!) {
      if (other === i || seen.has(other) || seen.size >= 256) continue;
      seen.add(other);
      if (other > i) continue; // each pair is scored from its higher index
      const similarity = cosine(vector(i), vector(other));
      offer(i, other, similarity); offer(other, i, similarity);
    }
  });
  return result;
}
/** Bounded candidate search, then strongest-first selection with hard bounds at
 * BOTH endpoints. Large identical packs use deterministic local neighborhoods,
 * not exhaustive all-pairs ranking; work/memory scale with the candidate budget. */
export function buildMusicEdges(nodes: DocNode[], policy: SoundLinkPolicy = SOUND_LINK_POLICY): Edge[] {
  const audio = nodes.filter(n => n.fileType === 'audio' && n.audio).sort((a,b) => a.id.localeCompare(b.id)).map(features);
  const nearest = soundNeighbors(audio, policy.neighbors);
  const buckets = new Map<string, number[]>();
  audio.forEach((f, index) => { for (const token of tokens(f)) { const list = buckets.get(token) ?? []; list.push(index); buckets.set(token, list); } });
  const pairs = new Map<string, Edge[]>();
  audio.forEach((f, index) => {
    const candidates = new Set<number>((nearest.get(index) ?? []).filter(n => n.similarity >= policy.floor).map(n => n.other));
    for (const token of tokens(f, true)) {
      const list = buckets.get(token);
      if (!list) continue;
      let lo = 0; let hi = list.length;
      while (lo < hi) { const mid = (lo + hi) >>> 1; if (list[mid] < index) lo = mid + 1; else hi = mid; }
      for (let offset = 0; offset <= CANDIDATES_PER_BUCKET / 2; offset++) for (const direction of [-1, 1]) {
        const candidate = list[((lo + offset * direction) % list.length + list.length) % list.length];
        if (candidate !== index && candidates.size < MAX_CANDIDATES) candidates.add(candidate);
      }
    }
    for (const other of candidates) {
      const key = `${Math.min(index, other)}:${Math.max(index, other)}`;
      if (!pairs.has(key)) pairs.set(key, pairEdges(f, audio[other], policy.floor));
    }
  });
  const score = (edges: Edge[]) => Math.max(...edges.map(e => e.weight)) + .05 * (edges.length - 1);
  const ranked = [...pairs.values()].filter(edges => edges.length).sort((a,b) => score(b) - score(a) || a[0].id.localeCompare(b[0].id));
  const neighbors = new Map<string, Set<string>>(); const counts = new Map<string, number>(); const result: Edge[] = [];
  for (const edges of ranked) {
    const { source, target } = edges[0];
    const a = neighbors.get(source) ?? new Set<string>(); const b = neighbors.get(target) ?? new Set<string>();
    if (a.size >= MUSIC_NEIGHBOR_LIMIT || b.size >= MUSIC_NEIGHBOR_LIMIT) continue;
    for (const edge of edges) {
      const ak = `${source}:${edge.kind}`; const bk = `${target}:${edge.kind}`;
      if ((counts.get(ak) ?? 0) >= MUSIC_NEIGHBORS_PER_KIND || (counts.get(bk) ?? 0) >= MUSIC_NEIGHBORS_PER_KIND) continue;
      result.push(edge); counts.set(ak, (counts.get(ak) ?? 0) + 1); counts.set(bk, (counts.get(bk) ?? 0) + 1);
      a.add(target); b.add(source); neighbors.set(source,a); neighbors.set(target,b);
    }
  }
  return result;
}
/** Refresh derived links without disturbing document links or authored edges. */
export function refreshMusicEdges(nodes: DocNode[], edges: Edge[]): Edge[] {
  const preserved = edges.filter(edge => edge.authored || !(MUSIC_EDGE_KINDS as readonly string[]).includes(edge.kind));
  const ids = new Set(preserved.map(edge => edge.id));
  return [...preserved, ...buildMusicEdges(nodes).filter(edge => !ids.has(edge.id))];
}

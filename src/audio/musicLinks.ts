import { musicNameHints } from './nameHints';
import { confirmedInstrumentList, reliableInstruments, sourceReviewAllows } from './instrumentEvidence';
import { soundMatchLabels, MATCH_ORIGIN_TEXT, type MatchLabel, type MatchOrigin } from './soundMatchLabels';
import { SHORT_CLIP_MAX_SECONDS } from './shortClipModel';
import type { DocNode, Edge } from '../model/types';
import { keyName, type MusicAnalysis } from './musicTypes';
export const MUSIC_EDGE_KINDS = ['tempo', 'key', 'instrument', 'sound', 'similar'] as const;
type MusicKind = typeof MUSIC_EDGE_KINDS[number];
export const MUSIC_NEIGHBOR_LIMIT = 8;
export const MUSIC_NEIGHBORS_PER_KIND = 4;
const CANDIDATES_PER_BUCKET = 12;
const MAX_CANDIDATES = 128;
/** CLAP audio cosines run high, so rank by nearest neighbors and keep only a soft floor. */
const SIMILAR_FLOOR = .7;
const SIMILAR_NEIGHBORS = 3;
/** Selection heuristic, not a calibrated listening-similarity threshold. */
const SIMILAR_RELATIVE_MARGIN = .03;
/** Above this many fingerprints, all-pairs is skipped; sound-alike links then only appear for already-bucketed pairs. */
const SIMILAR_ALL_PAIRS_MAX = 1000;
const cosine = (a: number[], b: number[]) => { let dot = 0; for (let i = 0; i < a.length; i++) dot += a[i] * b[i]; return dot; };
function unitVector(vector: number[] | undefined): number[] | undefined {
  if (!vector || vector.length !== 512 || !vector.every(Number.isFinite)) return;
  const norm = Math.hypot(...vector);
  if (!Number.isFinite(norm) || norm < 1e-8) return;
  return vector.map(value => value / norm);
}
const GENERIC_LABELS = new Set(['synthesizer', 'drums', 'sound effect', 'noise', 'percussion', 'environmental sound', 'airy', 'metallic', 'warm', 'bright', 'dry', 'reverberant', 'sustained', 'plucked']);
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
  const rawHints = musicNameHints(node);
  const hints = { ...rawHints, tempo: audio.durationSeconds > SHORT_CLIP_MAX_SECONDS ? rawHints.tempo : undefined,
    key: audio.durationSeconds >= 3 ? rawHints.key : undefined };
  // Names retain their existing precedence only when this is long enough to
  // describe rhythm/mode. Single notes and hits must not inherit a pack's BPM/key.
  const tempo = hints.tempo
    ? { bpm: hints.tempo.value, confidence: .65 }
    : audio.durationSeconds >= 2 && audio.analyzedSeconds >= 2 ? audio.tempo : undefined;
  const key = hints.key
    ? { ...hints.key.value, strength: .65 }
    : audio.durationSeconds >= 3 && audio.analyzedSeconds >= 3 ? audio.key : undefined;
  const human = confirmedInstrumentList(audio) !== undefined;
  // Names are useful search clues, but cannot replace stronger audio evidence.
  const reliable = reliableInstruments(audio);
  const named = !human && !reliable.length && hints.instruments;
  type Instrument = { label: string; score: number; origin: MatchOrigin | 'reliable' };
  const base: Instrument[] = named ? named.value.filter(label => sourceReviewAllows(audio, label)).map(label => ({ label, score: .45, origin: 'filename' }))
    : reliable.map(i => ({ ...i, origin: human ? 'confirmed' : 'reliable' }));
  // Source labels the panel's Sounds / Other model guesses sections show also count, at their own strength.
  const matches = soundMatchLabels(node);
  const shownSources = matches.filter(m => m.group === 'source' && !(human && m.origin !== 'confirmed'));
  const instruments = [...base, ...shownSources.filter(m => !base.some(i => i.label === m.label)).map(m => ({ label: m.label, score: m.weight, origin: m.origin }))];
  return {
    node, hints, human, vector: unitVector(audio.embedding),
     named: !!named, instruments: instruments.filter(i => validScore(i.score)),
    tempo: tempo && Number.isFinite(tempo.bpm) && tempo.bpm >= 40 && tempo.bpm <= 250 && validScore(tempo.confidence) && tempo.confidence >= .5 ? tempo : undefined,
    key: key && Number.isInteger(key.tonic) && key.tonic >= 0 && key.tonic < 12 && ['major','minor'].includes(key.mode) && validScore(key.strength) && key.strength >= .6 ? key : undefined,
    // Exactly what the Sounds and Other model guesses sections list; rejected/unsure reviews are already excluded.
    sound: matches.filter(m => m.group !== 'source'),
  };
}
type Features = ReturnType<typeof features>;
function pairEdges(a: Features, b: Features, includeSimilar = true): Edge[] {
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
    if (relation) add('key', Math.min(a.key.strength, b.key.strength) * (relation === 'same estimated key' ? 1 : .8), `Harmonic key relation: ${a.hints.key?.displayName ?? keyName(a.key)} and ${b.hints.key?.displayName ?? keyName(b.key)}: ${relation}.${a.hints.key || b.hints.key ? sources('key') : ' Based on audio estimates.'} This does not establish similar sound or mix quality.`);
  }
  const shared = a.instruments.filter(i => b.instruments.some(j => j.label === i.label));
  if (shared.length) {
    const pairs = shared.map(i => ({ i, other: b.instruments.find(j => j.label === i.label)! }));
    // Provenance follows the shared labels' own origins, not the node: a track named piano.wav can still
    // share a model-estimated guitar, and that edge must not claim the file name as its source.
    const aNamed = pairs.some(({ i }) => i.origin === 'filename'), bNamed = pairs.some(({ other }) => other.origin === 'filename');
    const hasName = aNamed || bNamed;
    const sideSource = (f: Features, named: boolean) => f.human ? 'confirmed by you' : named ? f.hints.instruments!.source : 'audio estimate';
    const provenance = hasName
      ? `Sources: ${sideSource(a, aNamed)} and ${sideSource(b, bNamed)}. Name tags are not verified audio detections.`
      : a.human && b.human ? 'Confirmed by you on both tracks.'
      : a.human || b.human ? 'Confirmed by you on one track; estimated from audio on the other.'
      : 'Not confirmed instrumentation.';
    const originText = (i: Features['instruments'][number]) => i.origin === 'reliable' ? 'strong or repeated audio detection (unconfirmed)' : MATCH_ORIGIN_TEXT[i.origin];
    const basis = pairs.map(({ i, other }) => `${i.label}: ${originText(i)} / ${originText(other)}`).join('; ');
    const modelShown = pairs.some(({ i, other }) => [i, other].some(j => ['sounds', 'maybe', 'guess', 'unverified'].includes(j.origin)));
    add('instrument', Math.max(...pairs.map(({ i, other }) => Math.min(i.score, other.score))), `${hasName ? 'Shared instrument hints' : 'Shared instruments'}: ${shared.map(i => i.label).join(', ')}. ${provenance} ${basis}.${modelShown ? ' Includes source labels from the Sounds / Other model guesses lists, which are model estimates or untested guesses.' : ''}`);
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
  if (includeSimilar && a.vector && b.vector) {
    const sim = cosine(a.vector, b.vector);
    if (sim >= SIMILAR_FLOOR) add('similar', Math.min(1, sim), `Nearby audio fingerprints (cosine similarity ${sim.toFixed(2)}). Model similarity is not a listening judgment and is not proof of exact duplicates, sampling, a shared source or influence.`);
  }
  const labels = [...shared.map(i => ({ label: i.label, weight: Math.min(i.score, b.instruments.find(j => j.label === i.label)!.score) })),
    ...sound.map(i => ({ label: i.label, weight: Math.min(i.weight, find(b.sound, i)!.weight) }))];
  const informative = labels.some(i => !GENERIC_LABELS.has(i.label) || i.weight >= .7);
  const corroborated = edges.some(e => e.kind === 'tempo' || e.kind === 'similar');
  return edges.filter(e => e.kind !== 'instrument' && e.kind !== 'sound' || informative || corroborated);
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
/** Nearest sounds by audio fingerprint; every such pair is evaluated whether or not any label is shared. */
function nearestByAudio(audio: Features[], index: number, fingerprintCount: number): number[] {
  const me = audio[index].vector;
  if (!me || fingerprintCount > SIMILAR_ALL_PAIRS_MAX) return [];
  const scored: { other: number; sim: number }[] = [];
  audio.forEach((f, other) => { if (other !== index && f.vector) { const sim = cosine(me, f.vector); if (sim >= SIMILAR_FLOOR) scored.push({ other, sim }); } });
  return scored.sort((x, y) => y.sim - x.sim || x.other - y.other).slice(0, SIMILAR_NEIGHBORS).map(s => s.other);
}
/** Bounded candidate search, then strongest-first selection with hard bounds at
 * BOTH endpoints. Large identical packs use deterministic local neighborhoods,
 * not exhaustive all-pairs ranking; work/memory scale with the candidate budget. */
export function buildMusicEdges(nodes: DocNode[]): Edge[] {
  const audio = nodes.filter(n => n.fileType === 'audio' && n.audio).sort((a,b) => a.id.localeCompare(b.id)).map(features);
  const fingerprintCount = audio.filter(f => f.vector).length;
  const buckets = new Map<string, number[]>();
  audio.forEach((f, index) => { for (const token of tokens(f)) { const list = buckets.get(token) ?? []; list.push(index); buckets.set(token, list); } });
  const pairs = new Map<string, Edge[]>();
  audio.forEach((f, index) => {
    const candidates = new Set<number>();
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
    for (const other of nearestByAudio(audio, index, fingerprintCount)) candidates.add(other);
    for (const other of candidates) {
      const key = `${Math.min(index, other)}:${Math.max(index, other)}`;
      if (!pairs.has(key)) pairs.set(key, pairEdges(f, audio[other]));
    }
  });
  // A label bucket must not give a mediocre fingerprint extra neighbors. The
  // closest three propose pairs; both ends must also be near their own best.
  // Above the all-pairs cap these ranks are approximate within the bounded buckets.
  const fingerprintRanks = new Map<string, Edge[]>();
  for (const edges of pairs.values()) for (const edge of edges) if (edge.kind === 'similar') for (const id of [edge.source, edge.target]) {
    const list = fingerprintRanks.get(id) ?? []; list.push(edge); fingerprintRanks.set(id, list);
  }
  for (const list of fingerprintRanks.values()) list.sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id));
  const nearby = (edge: Edge) => {
    const a = fingerprintRanks.get(edge.source)!; const b = fingerprintRanks.get(edge.target)!;
    return edge.weight >= a[0].weight - SIMILAR_RELATIVE_MARGIN && edge.weight >= b[0].weight - SIMILAR_RELATIVE_MARGIN
      && (a.slice(0, SIMILAR_NEIGHBORS).includes(edge) || b.slice(0, SIMILAR_NEIGHBORS).includes(edge));
  };
  const featuresById = new Map(audio.map(f => [f.node.id, f]));
  const byId = new Map(audio.map(f => [f.node.id, new Set(tokens(f).filter(t => t.startsWith('i:') || t.startsWith('s:')))]));
  const score = (edges: Edge[]) => {
    const sharedTokens = [...byId.get(edges[0].source)!].filter(t => byId.get(edges[0].target)!.has(t));
    // Specificity affects selection only; edge strength still describes provenance.
    const specificity = sharedTokens.length ? Math.max(...sharedTokens.map(t => 1 - ((buckets.get(t)?.length ?? 2) - 2) / Math.max(1, audio.length - 2))) : 1;
    return Math.max(...edges.map(e => e.weight)) * (.75 + .25 * specificity)
      + .05 * Math.max(0, edges.filter(e => e.kind !== 'key').length - 1) + .025 * Math.min(3, Math.max(0, sharedTokens.length - 1));
  };
  const ranked = [...pairs.values()].map(edges => {
    const selected = edges.filter(e => e.kind !== 'similar' || nearby(e));
    if (selected.length === edges.length) return selected;
    // Recheck generic clues after removing their fingerprint corroboration.
    return pairEdges(featuresById.get(edges[0].source)!, featuresById.get(edges[0].target)!, false);
  })
    .filter(edges => edges.length).map(edges => ({ edges, score: score(edges) }))
    .sort((a,b) => b.score - a.score || a.edges[0].id.localeCompare(b.edges[0].id));
  const neighbors = new Map<string, Set<string>>(); const counts = new Map<string, number>(); const result: Edge[] = [];
  for (const { edges } of ranked) {
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

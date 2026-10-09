import { resolveTempoKey } from './resolvedTempoKey';
import { confirmedInstrumentList, reliableInstruments, sourceReviewAllows } from './instrumentEvidence';
import { soundMatchLabels, MATCH_ORIGIN_TEXT, type MatchLabel, type MatchOrigin } from './soundMatchLabels';
import { confidentSoundSummary } from './confidentSoundSummary';
import type { DocNode, Edge } from '../model/types';
import { keyName, type MusicAnalysis } from './musicTypes';
import { buildVersionEdges, versionRelation } from './versionLinks';
import { energyFromScore, genreFromScores, genreText } from './genreEnergy';
import { MUSIC_EDGE_KINDS } from './musicEdgeKinds';
import center from './soundAlikeCenter.json';
export { MUSIC_EDGE_KINDS } from './musicEdgeKinds';
type MusicKind = Exclude<typeof MUSIC_EDGE_KINDS[number], 'version'>;
export const MUSIC_NEIGHBOR_LIMIT = 8;
export const MUSIC_NEIGHBORS_PER_KIND = 4;
const CANDIDATES_PER_BUCKET = 12;
const MAX_CANDIDATES = 128;
/** Each track's `neighbors` closest sounds are always candidates and a pair links when its sound-alike score
 * (soundAlikeScore) is `floor` or above. A mutual-top-3 rule at 0.5 was tried with scripts/sound-links: more song
 * links but lower precision (45% vs 63% same genre), so this keeps the closest-neighbours policy. */
export interface SoundLinkPolicy { neighbors: number; floor: number }
export const SOUND_LINK_POLICY: SoundLinkPolicy = { neighbors: 3, floor: .6 };
/** Share of the sound-alike score taken from the tracks' Discogs music styles; the rest is the centered CLAP fingerprint.
 * Picked on the sound-link tuning songs (scripts/sound-links), where it raised same-genre precision at every link count. */
const STYLE_SHARE = .2;
/** The style model reads whole-track context; on single notes and one-shots its styles are noise (they lowered
 * same-instrument nearest-neighbour precision on the tuning notes), so shorter audio compares fingerprints only. */
const STYLE_MIN_SECONDS = 8;
const CLAP_CENTER = Float64Array.from(center.mean);
/** All-pairs similarity up to this many valid fingerprints; larger libraries use bounded hashed neighborhoods. */
const EXACT_SIMILARITY_LIMIT = 800;
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
/** The fingerprint minus the part every music recording shares, so that shared part does not count as similarity. */
function centeredVector(vector: number[] | undefined): number[] | undefined {
  if (!vector) return;
  return unitVector(vector.map((value, i) => value - CLAP_CENTER[i]));
}
/** Square-rooted strengths of the stored strongest styles, unit length, for a cosine between two tracks. */
function styleVector(audio: MusicAnalysis): Map<string, number> | undefined {
  if (audio.stage === 'preview' || !(audio.durationSeconds >= STYLE_MIN_SECONDS) || !audio.styles?.length) return;
  const roots = audio.styles.filter(s => validScore(s.score) && s.score > 0).map(s => [s.label, Math.sqrt(s.score)] as const);
  const norm = Math.hypot(...roots.map(([, v]) => v));
  return norm > 1e-8 ? new Map(roots.map(([label, v]) => [label, v / norm])) : undefined;
}
/** What decides a sound-alike link: centered fingerprint cosine, blended with music-style agreement when both tracks
 * have styles. Only used to choose links; the link's strength and text keep the plain fingerprint similarity. */
function soundAlikeScore(a: Features, b: Features): number | undefined {
  if (!a.centered || !b.centered) return;
  const sound = cosine(a.centered, b.centered);
  if (!a.styles || !b.styles) return sound;
  let style = 0;
  for (const [label, v] of a.styles) style += v * (b.styles.get(label) ?? 0);
  return (1 - STYLE_SHARE) * sound + STYLE_SHARE * style;
}
/** Project evidence once per rebuild; never mutate saved estimates or corrections. */
function features(node: DocNode) {
  const audio = node.audio!;
  const { hints, tempo, key } = resolveTempoKey(node);
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
  const settled = audio.stage !== 'preview';
  const vector = unitVector(audio.embedding);
  return {
    node, hints, human, vector, centered: centeredVector(vector), styles: styleVector(audio),
    genre: settled ? genreFromScores(audio.genreScores?.scores) : undefined,
    energy: settled ? energyFromScore(audio.energyScore) : undefined,
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
  const alike = soundAlikeScore(a, b);
  const similarity = a.vector && b.vector ? cosine(a.vector, b.vector) : undefined;
  if (similarity !== undefined && alike !== undefined && alike >= floor) {
    // Tags already explained by the instrument link are not repeated.
    const both = a.alikeTags.filter(t => b.alikeTags.some(u => u.dimension === t.dimension && u.label === t.label) && !(t.dimension === 'source' && shared.some(i => i.label === t.label)));
    const origins = both.map(t => [t.origin, b.alikeTags.find(u => u.dimension === t.dimension && u.label === t.label)!.origin]);
    const byYou = (o: string) => o === 'confirmed by you';
    const source = origins.every(o => o.every(byYou)) ? ', confirmed by you on both tracks' : origins.some(o => o.some(byYou)) ? ', some confirmed by you' : ', detected by tested sound models';
    const detail = both.length ? ` Both also have: ${both.map(t => `${t.label.replaceAll('_', ' ')} (${t.dimension === 'effect' ? 'production / effect' : t.dimension})`).join(', ')}${source}.` : '';
    add('similar', Math.min(1, similarity), `Sounds alike: the two recordings' sound fingerprints are ${Math.floor(similarity * 100)}% similar.${detail} Similar sound is not proof of an exact duplicate, sampling, a shared source or influence.`);
  }
  if (a.genre && b.genre && a.genre.label === b.genre.label) {
    const maybe = !a.genre.tested || !b.genre.tested;
    const energy = a.energy && b.energy && a.energy.level === b.energy.level ? ` Both are estimated ${a.energy.level} energy.` : '';
    // A tested genre on both sides links at the strength of the weaker estimate; an untested one is weighted lower.
    add('genre', Math.min(a.genre.score, b.genre.score) * (maybe ? .6 : 1), `Same estimated genre: ${genreText(a.genre.label)}.${energy} Estimated from the audio by a music style model${maybe ? '; this genre has not reached 70% precision and recall in testing, so treat it as a maybe' : ''}. Not a confirmed label.`);
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
  if (f.genre) result.push(`g:${f.genre.label}`);
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
/** Deterministic random hyperplanes (fixed seed) for libraries too large to compare all pairs; built once. */
const planeCache = new Map<string, Float32Array[]>();
function hyperplanes(count: number, dimensions: number): Float32Array[] {
  const cached = planeCache.get(`${count}:${dimensions}`);
  if (cached) return cached;
  let seed = 0x2f6b1d3;
  const next = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32 - .5; };
  const planes = Array.from({ length: count }, () => Float32Array.from({ length: dimensions }, next));
  planeCache.set(`${count}:${dimensions}`, planes);
  return planes;
}
/** Each fingerprinted track's closest-sounding tracks (by index), most similar first. */
function soundNeighbors(audio: Features[], keep: number): Map<number, { other: number; similarity: number }[]> {
  const result = new Map<number, { other: number; similarity: number }[]>();
  const members = audio.flatMap((f, i) => f.centered ? [i] : []);
  const vector = (i: number) => audio[i].centered!;
  const score = (i: number, other: number) => soundAlikeScore(audio[i], audio[other])!;
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
      const similarity = score(members[x], members[y]);
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
  // Each bucket is in index order; compare only with a fixed window around this track, so identical
  // fingerprints filling one bucket cannot make the search quadratic.
  const WINDOW = 16;
  members.forEach((i, m) => {
    const seen = new Set<number>();
    for (const code of codes[m]) {
      const list = buckets.get(code)!;
      let lo = 0, hi = list.length;
      while (lo < hi) { const mid = (lo + hi) >>> 1; if (list[mid] < i) lo = mid + 1; else hi = mid; }
      for (let k = Math.max(0, lo - WINDOW); k < Math.min(list.length, lo + WINDOW + 1); k++) {
        const other = list[k];
        if (other >= i || seen.has(other)) continue; // each pair is scored from its higher index
        seen.add(other);
        const similarity = score(i, other);
        offer(i, other, similarity); offer(other, i, similarity);
      }
    }
  });
  return result;
}
/** Version links (same recording, or another version of the same song) plus the musical links below.
 * Two copies of one recording get only their version link: their matching tempo, key and sound say nothing new,
 * and would use up neighbor slots that other tracks need. */
export function buildMusicEdges(nodes: DocNode[], policy: SoundLinkPolicy = SOUND_LINK_POLICY): Edge[] {
  const versions = buildVersionEdges(nodes);
  const copies = new Set(versions.filter(e => versionRelation(e) === 'duplicate').map(e => `${e.source}|${e.target}`));
  return [...versions, ...buildRelationEdges(nodes, policy, copies)];
}
/** Bounded candidate search, then strongest-first selection with hard bounds at
 * BOTH endpoints. Large identical packs use deterministic local neighborhoods,
 * not exhaustive all-pairs ranking; work/memory scale with the candidate budget. */
function buildRelationEdges(nodes: DocNode[], policy: SoundLinkPolicy, skip: Set<string>): Edge[] {
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
      if (!pairs.has(key)) pairs.set(key, skip.has([f.node.id, audio[other].node.id].sort().join('|')) ? [] : pairEdges(f, audio[other], policy.floor));
    }
  });
  const byId = new Map(audio.map(f => [f.node.id, new Set(tokens(f).filter(t => t.startsWith('i:') || t.startsWith('s:')))]));
  const score = (edges: Edge[]) => {
    const sharedTokens = [...byId.get(edges[0].source)!].filter(t => byId.get(edges[0].target)!.has(t));
    // Specificity affects selection only; edge strength still describes provenance.
    const specificity = sharedTokens.length ? Math.max(...sharedTokens.map(t => 1 - ((buckets.get(t)?.length ?? 2) - 2) / Math.max(1, audio.length - 2))) : 1;
    return Math.max(...edges.map(e => e.weight)) * (.75 + .25 * specificity)
      + .05 * Math.max(0, edges.filter(e => e.kind !== 'key').length - 1) + .025 * Math.min(3, Math.max(0, sharedTokens.length - 1));
  };
  const ranked = [...pairs.values()]
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

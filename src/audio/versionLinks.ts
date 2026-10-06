import type { DocNode, Edge } from '../model/types';
import { compareVersionPrints, decodeVersionPrint, type DecodedVersionPrint, type VersionComparison } from './versionPrint';

/** Words that mark a different version of the same song, not a different song. */
const MARKERS = new Set(['remix', 'rmx', 'mix', 'edit', 'reedit', 'rework', 'bootleg', 'vip', 'extended', 'radio', 'original', 'club', 'dub',
  'instrumental', 'acapella', 'acappella', 'cappella', 'version', 'remaster', 'remastered', 'flip', 'refix', 'cover', 'live', 'demo', 'mashup',
  'reprise', 'clean', 'explicit', 'chorus', 'vocals', 'vocal', 'vox']);
/** A whole title made only of these says nothing about which song it is. */
const GENERIC = new Set(['audio', 'track', 'song', 'untitled', 'loop', 'sample', 'intro', 'outro', 'new', 'final', 'copy', 'master', 'test', 'recording']);
const KEY = /^(?:[a-g](?:#|b|sharp|flat)?(?:maj|min|major|minor|m)?)$/;

export interface VersionTitle { names: string[]; marked: boolean; artist?: string }
/** Candidate song titles from a file name: "Artist - Title (Someone Remix) 128bpm Am.mp3" gives "title".
 * With an "artist - title" separator every part after the first counts, so "Remixer - Title - Artist" still matches. */
export function versionTitle(node: Pick<DocNode, 'path' | 'title'>): VersionTitle {
  const file = ((node.path || node.title).replaceAll('\\', '/').split('/').pop() ?? '').replace(/\.[a-z0-9]{1,8}$/i, '');
  let marked = false;
  let text = file.normalize('NFKC').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().replace(/_/g, ' ').replace(/[♯]/g, '#').replace(/[♭]/g, 'b');
  // Bracketed version notes go; other bracketed words stay part of the title.
  text = text.replace(/[([{]([^)\]}]*)[)\]}]/g, (_, inner: string) => {
    const words = inner.split(/[^a-z0-9#]+/).filter(Boolean);
    if (words.some(w => MARKERS.has(w))) { marked = true; return ' - '; }
    return /^\s*\d{1,2}\s*$/.test(inner) ? ' ' : ` ${inner} `;
  });
  const parts = text.split(/\s+[-–—]\s+|\s*\|\s*/).map(part => {
    let words = part.replace(/['’]/g, '').split(/[^a-z0-9#]+/).filter(Boolean);
    // Featured artists are not part of the song name.
    const feat = words.findIndex((w, i) => i > 0 && (w === 'feat' || w === 'ft' || w === 'featuring'));
    if (feat > 0) words = words.slice(0, feat);
    // A version note ends the name ("Dirtbag 2021 Remix"); a marker word followed by other words is part of it ("Dub Skank").
    const cut = words.findIndex((w, i) => i > 0 && MARKERS.has(w) && words.slice(i + 1).every(x => MARKERS.has(x) || /^\d+$/.test(x)));
    if (cut > 0) { marked = true; words = words.slice(0, cut); }
    if (words.length && MARKERS.has(words[0])) { marked = true; words = words.slice(1); }
    const tagged = words.some(w => KEY.test(w) && w.length <= 5 && /[a-g]m|maj|min|#|b$/.test(w)) || words.some(w => /bpm$/.test(w)) || words.includes('loop');
    words = words.filter(w => !/^\d+bpm$|^bpm$/.test(w) && !/^(?:19|20)\d\d$/.test(w) && !(tagged && (KEY.test(w) && w.length <= 5 && w !== 'b' || /^\d{2,3}$/.test(w) && +w >= 60 && +w <= 200)));
    while (words.length > 1 && /^\d{1,2}$/.test(words[words.length - 1])) words.pop();
    while (words.length > 1 && /^\d{1,3}$/.test(words[0])) words.shift();
    return words.join(' ');
  }).filter(Boolean);
  const names = (parts.length > 1 ? parts.slice(1) : parts).filter(name => name.replace(/\s/g, '').length >= 3 && !name.split(' ').every(w => GENERIC.has(w)));
  return { names: [...new Set(names)], marked, ...(parts.length > 1 ? { artist: parts[0] } : {}) };
}
/** 'same' when a candidate title is identical; 'contained' when one sits word-for-word inside the other.
 * Shared words while both names also carry different ones ("X - Brad Sucks - Borderline" and "Y - Bad Attraction -
 * Brad Sucks") are a shared artist, not a shared song. */
export function titleRelation(a: VersionTitle, b: VersionTitle): 'same' | 'contained' | undefined {
  const shared = a.names.filter(n => b.names.includes(n));
  if (shared.length) return a.names.length > shared.length && b.names.length > shared.length ? undefined : 'same';
  const inside = (x: string, y: string) => x.length >= 5 && ` ${y} `.includes(` ${x} `);
  return a.names.some(x => b.names.some(y => inside(x, y) || inside(y, x))) ? 'contained' : undefined;
}

export type VersionRelation = 'duplicate' | 'remix';
export interface VersionEvidence {
  relation: VersionRelation;
  /** Selection only; not a probability. */
  strength: number;
  text: string;
}
/** Chosen on half of the versions test set (scripts/versions/README.md) and checked on the other half. */
export const VERSION_RULES = {
  /** Same recording: the shorter file lines up along one speed and pitch over most of its length, and the mix
   * (band balance) matches. A pitch or tempo shift, trim or edit still qualifies. */
  duplicate: { window: .85, coverage: .6, timbre: .7 },
  /** Another version needs the same song title. When neither file is marked as a version (remix, edit, ...)
   * and the artists differ, it also needs some shared material or sound, so two songs that merely share a
   * name stay apart. Audio alone was not enough: remixes of one song lined up no better than different songs. */
  remixSupport: { window: .55, cosine: .6 },
};

interface Side { node: DocNode; print?: DecodedVersionPrint; harmony?: ReturnType<typeof harmony>; vector?: number[]; title: VersionTitle }
const pct = (x: number) => `${Math.round(x * 100)}%`;
function changes(c: VersionComparison, a: DocNode, b: DocNode): string[] {
  const out: string[] = [];
  if (c.semitones) out.push(`pitched ${c.semitones > 0 ? 'up' : 'down'} about ${Math.abs(c.semitones)} semitone${Math.abs(c.semitones) === 1 ? '' : 's'}`);
  if (Math.abs(c.tempoRatio - 1) >= .015) out.push(`${c.tempoRatio > 1 ? 'sped up' : 'slowed down'} about ${Math.round(Math.abs(c.tempoRatio - 1) * 100)}%`);
  const da = a.audio!.durationSeconds, db = b.audio!.durationSeconds;
  if (Math.abs(da / c.tempoRatio - db) > 3 || Math.abs(c.offsetSeconds) > 2) out.push('trimmed or edited');
  return out;
}

export function versionEvidence(a: Side, b: Side): VersionEvidence | undefined {
  const title = titleRelation(a.title, b.title);
  const comparison = a.print && b.print ? compareVersionPrints(a.print, b.print) : undefined;
  const d = VERSION_RULES.duplicate;
  if (comparison && comparison.window >= d.window && comparison.coverage >= d.coverage && comparison.timbre >= d.timbre) {
    const what = changes(comparison, a.node, b.node);
    return { relation: 'duplicate', strength: Math.min(1, comparison.window),
      text: `Same recording${what.length ? `, ${what.join(', ')}` : ' (a copy or re-encode)'}: ${pct(comparison.coverage)} of the shorter file lines up with the other, and the mix matches.` };
  }
  if (!title) return undefined;
  const named = a.title.marked || b.title.marked || (!!a.title.artist && a.title.artist === b.title.artist);
  const cosine = a.vector && b.vector ? a.vector.reduce((s, v, i) => s + v * b.vector![i], 0) : undefined;
  const r = VERSION_RULES.remixSupport;
  const lines = !!comparison && comparison.window >= r.window, sounds = cosine !== undefined && cosine >= r.cosine;
  // A title inside a longer one ("Dirtbag" in "Dirtbag (I am gone)") counts only with a version mark or the same artist.
  if (title === 'contained' ? !named : !(named || lines || sounds)) return undefined;
  const why = [title === 'same' ? 'the titles match' : 'one title contains the other',
    named ? (a.title.marked || b.title.marked ? 'the name marks a remix or edit' : 'same artist') : '',
    lines ? 'some of the same melody or harmony lines up' : sounds ? `they sound ${pct(cosine!)} alike` : ''].filter(Boolean);
  return { relation: 'remix', strength: .6 + (named ? .1 : 0) + (lines || sounds ? .1 : 0), text: `Another version of the same song: ${why.join(', ')}.` };
}

const unit = (v: number[] | undefined) => { if (!v || v.length !== 512) return; const n = Math.hypot(...v); return n > 1e-8 && Number.isFinite(n) ? v.map(x => x / n) : undefined; };
/** Graph updates replace node objects for unrelated reasons (layout, degree), so caches key on the inputs themselves. */
const sides = new Map<string, { print?: string; embedding?: number[]; name: string; side: Side }>();
function side(node: DocNode): Side {
  const print = node.audio?.versionPrint, embedding = node.audio?.embedding, name = node.path || node.title;
  const cached = sides.get(node.id);
  if (cached && cached.print === print && cached.embedding === embedding && cached.name === name) { cached.side.node = node; return cached.side; }
  const decoded = print ? decodeVersionPrint(print) : undefined;
  const fresh: Side = { node, print: decoded, harmony: decoded && harmony(decoded), vector: unit(embedding), title: versionTitle(node) };
  sides.set(node.id, { print, embedding, name, side: fresh });
  return fresh;
}
const pairCache = new Map<string, { a: Side; b: Side; evidence: VersionEvidence | undefined }>();
/** Drops cached tracks (and their pairs) that are no longer in the graph, e.g. after a removal or corpus switch. */
function forgetOthers(ids: Set<string>) {
  if ([...sides.keys()].every(id => ids.has(id))) return;
  for (const id of [...sides.keys()]) if (!ids.has(id)) sides.delete(id);
  for (const [key, hit] of pairCache) if (!ids.has(hit.a.node.id) || !ids.has(hit.b.node.id)) pairCache.delete(key);
}
/** The cached result for this pair of inputs, or null when it has not been aligned yet. */
function cached(a: Side, b: Side): VersionEvidence | undefined | null {
  const hit = pairCache.get(`${a.node.id}|${b.node.id}`);
  return hit && hit.a === a && hit.b === b ? hit.evidence : null;
}
function cachedEvidence(a: Side, b: Side): VersionEvidence | undefined {
  if (pairCache.size > 100_000) pairCache.clear();
  const evidence = versionEvidence(a, b);
  pairCache.set(`${a.node.id}|${b.node.id}`, { a, b, evidence });
  return evidence;
}

/** Candidate pairs: each track's closest harmonic fingerprints (which pitch classes sound together, at any
 * transposition, ignoring time) and every title match. Only candidates get the frame-by-frame alignment. */
export const VERSION_CANDIDATES = { byHarmony: 8, shortlist: 24, byTitle: 12 };
export const VERSION_LINKS_PER_TRACK = 12;
/** Work per graph rebuild (shortlisting new tracks, then aligning pairs). What is left over is done by the next
 * rebuild (results are cached); versionWorkPending() tells the caller to schedule one. */
export const VERSION_BUDGET_MS = 150;
let pending = false;
export const versionWorkPending = () => pending;

/** Each track's closest harmonic fingerprints. Tracks are shortlisted against the library once, in arrival order,
 * so a rebuild only scans tracks added since the last one. */
interface Shortlist { scanned: number; top: { side: Side; invariant: number; exact?: number }[] }
let arrivals: Side[] = [];
let shortlists = new WeakMap<Side, Shortlist>();
function harmonyNeighbors(prints: Side[], started: number, budgetMs: number): Map<Side, Side[]> {
  // Removed or reanalysed tracks stay in the arrival list (and can fill shortlist places) until more than a
  // tenth of it is stale; then everything is rescanned.
  const current = new Set(prints), out = new Map<Side, Side[]>();
  const stale = arrivals.reduce((n, x) => n + +!current.has(x), 0);
  if (stale > Math.max(16, prints.length / 10)) { arrivals = []; shortlists = new WeakMap(); }
  const known = new Set(arrivals);
  for (const x of prints) if (!known.has(x)) arrivals.push(x);
  for (const x of prints) {
    let list = shortlists.get(x);
    if (!list) shortlists.set(x, list = { scanned: 0, top: [] });
    for (; list.scanned < arrivals.length; list.scanned++) {
      if ((list.scanned & 63) === 0 && performance.now() - started > budgetMs) { pending = true; break; }
      const other = arrivals[list.scanned];
      if (other === x) continue;
      const invariant = dot(x.harmony!.invariant, other.harmony!.invariant), top = list.top;
      if (top.length >= VERSION_CANDIDATES.shortlist && invariant <= top[top.length - 1].invariant) continue;
      top.push({ side: other, invariant });
      top.sort((p, q) => q.invariant - p.invariant);
      top.length = Math.min(top.length, VERSION_CANDIDATES.shortlist);
    }
    const live = list.top.filter(t => current.has(t.side));
    for (const t of live) t.exact ??= harmonySimilarity(x.harmony!.matrix, t.side.harmony!.matrix);
    out.set(x, live.sort((p, q) => q.exact! - p.exact!).slice(0, VERSION_CANDIDATES.byHarmony).map(t => t.side));
  }
  return out;
}

/** 'version' edges between tracks that are the same recording or another version of the same song. */
export function buildVersionEdges(nodes: DocNode[], budgetMs = VERSION_BUDGET_MS): Edge[] {
  const audio = nodes.filter(n => n.fileType === 'audio' && n.audio).sort((a, b) => a.id.localeCompare(b.id));
  const all = audio.map(side), index = new Map(all.map((x, i) => [x, i]));
  forgetOthers(new Set(audio.map(n => n.id)));
  const started = performance.now();
  pending = false;
  const priority = new Map<string, number>();
  const add = (i: number, j: number, score: number) => {
    if (i === j) return;
    const key = i < j ? `${i}:${j}` : `${j}:${i}`;
    priority.set(key, Math.max(priority.get(key) ?? -Infinity, score));
  };
  for (const [x, near] of harmonyNeighbors(all.filter(x => x.harmony), started, budgetMs))
    near.forEach((y, rank) => add(index.get(x)!, index.get(y)!, 1 - rank / 100));
  // Title matches: the same song name, or one name inside another ("Dirtbag" in "Dirtbag I am gone").
  const byTitle = new Map<string, number[]>(), byPart = new Map<string, number[]>();
  const put = (map: Map<string, number[]>, key: string, i: number) => { const list = map.get(key) ?? []; if (list[list.length - 1] !== i) list.push(i); map.set(key, list); };
  all.forEach((x, i) => x.title.names.forEach(name => {
    put(byTitle, name, i);
    const words = name.split(' ').slice(0, 12);
    for (let from = 0; from < words.length; from++) for (let to = from + 1; to <= words.length; to++) {
      const part = words.slice(from, to).join(' ');
      if (part !== name && part.length >= 5) put(byPart, part, i);
    }
  }));
  const cap = VERSION_CANDIDATES.byTitle;
  // Title pairs go first: they are the only route to other versions, and cheap when no alignment is needed.
  for (const [name, members] of byTitle) {
    members.slice(0, cap).forEach((i, k, list) => list.slice(k + 1).forEach(j => add(i, j, 2)));
    for (const i of members.slice(0, cap)) for (const j of (byPart.get(name) ?? []).slice(0, cap)) add(i, j, 2);
  }
  const ordered = [...priority].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]));
  const found: { a: DocNode; b: DocNode; evidence: VersionEvidence }[] = [];
  for (const [key] of ordered) {
    const [i, j] = key.split(':').map(Number);
    const known = cached(all[i], all[j]);
    if (known === null) { if (performance.now() - started > budgetMs) { pending = true; continue; } }
    const evidence = known === null ? cachedEvidence(all[i], all[j]) : known;
    if (evidence) found.push({ a: audio[i], b: audio[j], evidence });
  }
  found.sort((x, y) => (x.evidence.relation === y.evidence.relation ? 0 : x.evidence.relation === 'duplicate' ? -1 : 1) || y.evidence.strength - x.evidence.strength || x.a.id.localeCompare(y.a.id) || x.b.id.localeCompare(y.b.id));
  const counts = new Map<string, number>();
  const edges: Edge[] = [];
  for (const { a, b, evidence } of found) {
    if ((counts.get(a.id) ?? 0) >= VERSION_LINKS_PER_TRACK || (counts.get(b.id) ?? 0) >= VERSION_LINKS_PER_TRACK) continue;
    counts.set(a.id, (counts.get(a.id) ?? 0) + 1); counts.set(b.id, (counts.get(b.id) ?? 0) + 1);
    const [source, target] = [a.id, b.id].sort();
    edges.push({ id: `${source}->${target}:version`, source, target, kind: 'version', weight: evidence.strength,
      evidence: [evidence.text, evidence.relation === 'duplicate' ? 'Compared frame by frame: what plays when, not file names or tags.' : 'Not the same recording. File names can be wrong; listen to confirm.'] });
  }
  return edges;
}

/** The relation a version edge describes, read back from its evidence. */
export const versionRelation = (edge: Edge): VersionRelation | undefined => edge.kind !== 'version' ? undefined
  : (edge.evidence[0] ?? '').startsWith('Same recording') ? 'duplicate' : 'remix';

const dot = (a: ArrayLike<number>, b: ArrayLike<number>) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
/** Pitch-class co-occurrence over the whole print, plus a transposition-invariant summary for the first cut. */
function harmony(p: DecodedVersionPrint): { matrix: Float64Array; invariant: Float64Array } | undefined {
  const matrix = new Float64Array(144);
  for (let f = 0; f < p.frames; f++) if (p.active[f]) for (let x = 0; x < 12; x++) for (let y = 0; y < 12; y++) matrix[x * 12 + y] += p.chroma[f * 12 + x] * p.chroma[f * 12 + y];
  const norm = Math.hypot(...matrix);
  if (!(norm > 1e-8)) return;
  for (let k = 0; k < 144; k++) matrix[k] /= norm;
  // Transposing rotates each diagonal of the matrix; the magnitudes of their Fourier coefficients do not change.
  const invariant = new Float64Array(49);
  for (let d = 0; d <= 6; d++) for (let k = 0; k <= 6; k++) {
    let re = 0, im = 0;
    for (let x = 0; x < 12; x++) { const v = matrix[x * 12 + (x + d) % 12]; re += v * Math.cos(Math.PI * k * x / 6); im -= v * Math.sin(Math.PI * k * x / 6); }
    invariant[d * 7 + k] = Math.hypot(re, im);
  }
  const n = Math.hypot(...invariant);
  return { matrix, invariant: invariant.map(v => v / n) };
}
function harmonySimilarity(a: Float64Array, b: Float64Array): number {
  let best = -Infinity;
  for (let r = 0; r < 12; r++) {
    let s = 0;
    for (let x = 0; x < 12; x++) for (let y = 0; y < 12; y++) s += a[x * 12 + y] * b[((x + r) % 12) * 12 + (y + r) % 12];
    if (s > best) best = s;
  }
  return best;
}

/* Per-tag "which model to trust" what-if on saved eval-tag.ts caches (CLAP fingerprints per window + tagger scores per
 * window), so it needs no audio and no models. For every tagger-decided tag it re-runs the app's display chain under each
 * trust mode (default, 'sole', 'either', 'both'; see TaggerTag.trust in src/audio/tagger.ts) and reports tp/fp/fn on the two
 * halves of the uploader-group split eval-tag.ts uses (fnv hash of the group: even = pick, odd = check).
 * Pick a mode on the pick half only; the check half is the one honest grade.
 * Usage: npx vite-node scripts/tagger-trust-whatif.ts --cache <dir>/<prefix> --out modes.json */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { DjTagEvidence, selectDjTags } from '../src/audio/djTags';
import { mergeDjTags } from '../src/audio/djClassification';
import { combineSoundModels } from '../src/audio/ensemble';
import { confidentSoundSummary } from '../src/audio/confidentSoundSummary';
import { DescriptionAccumulator, descriptionScores, type DescriptionPrompt } from '../src/audio/profileDescriptions';
import { learnedDjScores, oneShotClipScores, sanitizeLearnedDjModel } from '../src/audio/learnedDjModel';
import { sanitizeShortClipModel, shortClipScores, SHORT_CLIP_MAX_SECONDS } from '../src/audio/shortClipModel';
import { TAGGER_POLICY, TaggerEvidence, type TaggerTrust } from '../src/audio/tagger';
import type { MusicAnalysis } from '../src/audio/musicTypes';
import { soundReviewKey } from '../src/audio/soundReviewIdentity';

const argv = process.argv.slice(2);
const opt = (n: string) => { const i = argv.indexOf(`--${n}`); return i < 0 ? undefined : argv[i + 1]; };
const prefix = opt('cache');
if (!prefix) { console.error('Pass --cache <dir>/<eval-tag cache prefix>'); process.exit(2); }
const learned = sanitizeLearnedDjModel(JSON.parse(readFileSync('public/sound-model/learned.json', 'utf8')))!;
const shortClip = sanitizeShortClipModel(JSON.parse(readFileSync('public/sound-model/short-clip.json', 'utf8')))!;
const prompts = JSON.parse(readFileSync('public/sound-model/prompts.json', 'utf8')) as DescriptionPrompt[];
const classes = (JSON.parse(readFileSync('public/tagger-model/model.json', 'utf8')) as { classes: string[] }).classes;
const fnv = (s: string) => { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; } return h; };
const half = (g: string) => fnv(g) % 2 === 0 ? 'pick' : 'check';
interface Rec { id: string; group: string; duration: number; labels: Record<string, 0 | 1>; clap: { start: number; end: number; embedding: number[] | null }[]; tagger: { start: number; end: number; scores: number[] }[]; taggerEnd?: { start: number; end: number; scores: number[] } }

/** Everything before the display (the part no trust mode changes), built once per clip. */
function analysis(rec: Rec): MusicAnalysis {
  const descriptions = new DescriptionAccumulator(), dj = new DjTagEvidence();
  for (const w of rec.clap) {
    if (!w.embedding) { descriptions.add([], w); continue; }
    let heads = learnedDjScores(w.embedding, learned, { shortRecording: rec.duration < 10 - 1e-3 });
    const short = w.start === 0 && w.end >= rec.duration - 1e-6 && rec.duration <= SHORT_CLIP_MAX_SECONDS && w.end - w.start <= shortClip.maxSeconds;
    if (short) heads = oneShotClipScores(heads, learned);
    const scores = [...descriptionScores(w.embedding, prompts), ...heads, ...(short ? shortClipScores(shortClip, { clapRepeat: w.embedding }).scores : [])];
    descriptions.add(scores, w); dj.add(selectDjTags(scores), w.start, w.end);
  }
  const ev = new TaggerEvidence();
  for (const w of rec.tagger) ev.add(Object.fromEntries(classes.map((k, i) => [k, w.scores[i]])), { start: w.start, end: w.end });
  // The tail window (taggerTailStart), when the cache carries it.
  const te = rec.taggerEnd; if (te) ev.addTail(Object.fromEntries(classes.map((k, i) => [k, te.scores[i]])), { start: te.start, end: te.end });
  const average = descriptions.average();
  const profile = combineSoundModels([], {}, average, { ast: false, jamendo: false, clap: true });
  mergeDjTags(profile, dj.results(), average);
  return { version: 2, durationSeconds: rec.duration, analyzedSeconds: rec.duration, instruments: [], notes: [], soundProfile: profile, tagger: ev.results(),
    instrumentScan: { mode: 'full', complete: true, analyzedSeconds: rec.duration, windows: rec.clap.length } };
}
const shown = (a: MusicAnalysis) => {
  const out = new Set<string>();
  for (const s of confidentSoundSummary(a)) { out.add(`${s.dimension}:${s.label}`); out.add(`=${soundReviewKey(s.dimension as 'source', s.label)}`); }
  return out;
};
const has = (s: Set<string>, key: string) => { const [d, ...l] = key.split(':'); return s.has(key) || s.has(`=${soundReviewKey(d as 'source', l.join(':'))}`); };

const MODES: (TaggerTrust | 'default')[] = ['default', 'sole', 'either', 'both'];
const original = new Map(TAGGER_POLICY.tags.map(t => [t, t.trust]));
const setAll = (m: TaggerTrust | 'default') => { for (const t of TAGGER_POLICY.tags) { if (m === 'default') { if (original.get(t)) t.trust = original.get(t); else delete t.trust; } else t.trust = m; } };
type Cell = { tp: number; fp: number; fn: number };
const table: Record<string, Record<string, Record<string, Cell>>> = {}; // mode -> half -> key
const dir = dirname(prefix), base = basename(prefix);
let n = 0;
for (const f of readdirSync(dir).filter(f => f.startsWith(base) && f.endsWith('.jsonl')).sort()) for (const line of readFileSync(join(dir, f), 'utf8').split('\n')) {
  if (!line) continue;
  const rec = JSON.parse(line) as Rec, a = analysis(rec), h = half(rec.group); n++;
  for (const m of MODES) {
    setAll(m);
    const s = shown(a);
    for (const [key, truth] of Object.entries(rec.labels)) {
      const c = ((table[m] ??= {})[h] ??= {})[key] ??= { tp: 0, fp: 0, fn: 0 };
      const yes = has(s, key);
      if (truth === 1) { if (yes) c.tp++; else c.fn++; } else if (yes) c.fp++;
    }
  }
  if (n % 1000 === 0) console.log(`  ${n} clips`);
}
setAll('default');
writeFileSync(opt('out') ?? 'tagger-trust-modes.json', JSON.stringify({ clips: n, table }, null, 1));
console.log(`${n} clips`);

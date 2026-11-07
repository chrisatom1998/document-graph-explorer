/* What-if on cached per-clip model outputs (eval-tag.ts --cache files): re-run the app's display chain without any audio.
 * Usage: npx vite-node scripts/app-path-whatif.ts --cache 'dir/prefix' [--learned file] --out result.json
 * Writes tp/fp/fn per labelled tag on the pick and check halves (uploader groups hashed, as eval-tag.ts does), on all
 * clips, and on short (<= 2.25 s) and longer clips. A cache line may carry `taggerEnd` ({start, end, scores}), the tagger
 * on the tail window (taggerTailStart), which eval-tag.ts caches do not have yet; without it the tail tags read as before.
 * The cache holds judge-set model outputs: keep the files and this script's outputs in the private project folder. */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { DjTagEvidence, selectDjTags } from '../src/audio/djTags';
import { mergeDjTags } from '../src/audio/djClassification';
import { combineSoundModels } from '../src/audio/ensemble';
import { confidentSoundSummary } from '../src/audio/confidentSoundSummary';
import { DescriptionAccumulator, descriptionScores, type DescriptionPrompt } from '../src/audio/profileDescriptions';
import { learnedDjScores, oneShotClipScores, sanitizeLearnedDjModel } from '../src/audio/learnedDjModel';
import { sanitizeShortClipModel, shortClipScores, SHORT_CLIP_MAX_SECONDS } from '../src/audio/shortClipModel';
import { TaggerEvidence } from '../src/audio/tagger';
import type { MusicAnalysis } from '../src/audio/musicTypes';
import { soundReviewKey } from '../src/audio/soundReviewIdentity';

const argv = process.argv.slice(2);
const opt = (n: string) => { const i = argv.indexOf(`--${n}`); return i < 0 ? undefined : argv[i + 1]; };
const prefix = opt('cache')!;
const learned = sanitizeLearnedDjModel(JSON.parse(readFileSync(opt('learned') ?? 'public/sound-model/learned.json', 'utf8')))!;
const shortClip = sanitizeShortClipModel(JSON.parse(readFileSync('public/sound-model/short-clip.json', 'utf8')))!;
const prompts = JSON.parse(readFileSync('public/sound-model/prompts.json', 'utf8')) as DescriptionPrompt[];
const classes = (JSON.parse(readFileSync('public/tagger-model/model.json', 'utf8')) as { classes: string[] }).classes;
const fnv = (s: string) => { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; } return h; };
const half = (g: string) => fnv(g) % 2 === 0 ? 'pick' : 'check';
interface Rec { id: string; group: string; duration: number; labels: Record<string, 0 | 1>; clap: { start: number; end: number; embedding: number[] | null }[]; tagger: { start: number; end: number; scores: number[] }[]; taggerEnd?: { start: number; end: number; scores: number[] } }

function decide(rec: Rec): Set<string> {
  const descriptions = new DescriptionAccumulator(), dj = new DjTagEvidence();
  for (const w of rec.clap) {
    if (!w.embedding) { descriptions.add([], w); continue; }
    let ls = learnedDjScores(w.embedding, learned, { shortRecording: rec.duration < 10 - 1e-3 });
    const short = w.start === 0 && w.end >= rec.duration - 1e-6 && rec.duration <= SHORT_CLIP_MAX_SECONDS && w.end - w.start <= shortClip.maxSeconds;
    const one = short ? shortClipScores(shortClip, { clapRepeat: w.embedding }).scores : [];
    if (short) ls = oneShotClipScores(ls, learned);
    const scores = [...descriptionScores(w.embedding, prompts), ...ls, ...one];
    descriptions.add(scores, w); dj.add(selectDjTags(scores), w.start, w.end);
  }
  const ev = new TaggerEvidence();
  for (const w of rec.tagger) ev.add(Object.fromEntries(classes.map((k, i) => [k, w.scores[i]])), { start: w.start, end: w.end });
  const te = rec.taggerEnd; if (te) ev.addTail(Object.fromEntries(classes.map((k, i) => [k, te.scores[i]])), { start: te.start, end: te.end });
  const average = descriptions.average();
  const profile = combineSoundModels([], {}, average, { ast: false, jamendo: false, clap: true });
  mergeDjTags(profile, dj.results(), average);
  const a: MusicAnalysis = { version: 2, durationSeconds: rec.duration, analyzedSeconds: rec.duration, instruments: [], notes: [], soundProfile: profile, tagger: ev.results(), instrumentScan: { mode: 'full', complete: true, analyzedSeconds: rec.duration, windows: rec.clap.length } };
  const shown = new Set<string>();
  for (const s of confidentSoundSummary(a)) { shown.add(`${s.dimension}:${s.label}`); shown.add(`=${soundReviewKey(s.dimension as 'source', s.label)}`); }
  return shown;
}

const dir = dirname(prefix), base = basename(prefix);
const table: Record<string, Record<string, { tp: number; fp: number; fn: number; pos: number; neg: number }>> = {};
const perClip: Record<string, string[]> = {};
let n = 0;
for (const f of readdirSync(dir).filter(f => f.startsWith(base) && f.endsWith('.jsonl')).sort()) {
  for (const line of readFileSync(join(dir, f), 'utf8').split('\n')) {
    if (!line) continue;
    const rec = JSON.parse(line) as Rec; const shown = decide(rec); n++;
    perClip[rec.id] = [...shown].filter(k => !k.startsWith('='));
    const parts = [half(rec.group), 'all', rec.duration <= SHORT_CLIP_MAX_SECONDS ? 'short' : 'longer'];
    for (const [key, truth] of Object.entries(rec.labels)) {
      const [d, ...l] = key.split(':'); const s = shown.has(key) || shown.has(`=${soundReviewKey(d as 'source', l.join(':'))}`);
      for (const p of parts) { const c = ((table[key] ??= {})[p] ??= { tp: 0, fp: 0, fn: 0, pos: 0, neg: 0 }); if (truth) { c.pos++; if (s) c.tp++; else c.fn++; } else { c.neg++; if (s) c.fp++; } }
    }
  }
}
writeFileSync(opt('out')!, JSON.stringify({ clips: n, table, perClip }));
console.log(`${n} clips`);

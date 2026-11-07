/* Whole-path routing check for every sound tag: if a tag's own detectors fire, does the app actually show the tag?
 *
 * Tags have been lost in the code around the models, not in the models: short gunshots never reached the gunshot head
 * (one-shot routing, #316), and merges and tagger hand-offs decide which detector speaks for a tag. Here every tag's own
 * detectors (trained heads, one-shot heads, neighbour heads, the tagger outputs that decide it) fire just above their
 * cutoffs, on clips of several lengths, with the sound everywhere or only at the start or end of a long recording, in the
 * full and the fast scan. The same chain as scripts/eval-tag.ts decides what shows (selectDjTags, mergeDjTags,
 * confidentSoundSummary). Every other tagger output says "no", as it would on a clean example of the sound.
 *
 * The result is pinned in tagRouting.expected.json. A change that makes any tag unreachable at some length (or reachable
 * where it was not) fails here with the cells that moved. If the change is intended, regenerate the file with
 *   UPDATE_TAG_ROUTING=1 npx vitest run src/audio/tagRouting.test.ts
 * and say in the PR why each moved cell is right. No audio and no model weights: it runs in a second in CI. */
import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { DJ_HIDDEN_LABELS, DJ_PICKER_LABELS, DjTagEvidence, mergedDjLabel, selectDjTags, type DjGroup } from './djTags';
import { mergeDjTags } from './djClassification';
import { combineSoundModels } from './ensemble';
import { confidentSoundSummary } from './confidentSoundSummary';
import { DescriptionAccumulator, type DescriptionScore } from './profileDescriptions';
import { oneShotClipScores, sanitizeLearnedDjModel } from './learnedDjModel';
import { sanitizeShortClipModel, SHORT_CLIP_MAX_SECONDS } from './shortClipModel';
import { instrumentWindowStarts } from './instrumentEvidence';
import { descriptionStarts } from './analysisPlan';
import { TAGGER_POLICY, TaggerEvidence, taggerWindowStarts } from './tagger';
import { isRuleDescribedLabel } from './timbreDescriptions';
import type { MusicAnalysis } from './musicTypes';

const learned = sanitizeLearnedDjModel(JSON.parse(readFileSync('public/sound-model/learned.json', 'utf8')))!;
const shortClip = sanitizeShortClipModel(JSON.parse(readFileSync('public/sound-model/short-clip.json', 'utf8')))!;
const EXPECTED_PATH = 'src/audio/tagRouting.expected.json';

type Dim = 'source' | 'effect' | 'character';
const DIM: Record<DjGroup, Dim> = { source: 'source', production: 'effect', character: 'character' };
const GROUP: Record<Dim, DjGroup> = { source: 'source', effect: 'production', character: 'character' };
const shownAs = (group: DjGroup, label: string) => { const m = mergedDjLabel(group, label); return `${DIM[m.group]}:${m.label}`; };

/** One row of the matrix: scan mode, clip length (s), and where in the clip the sound is. */
interface Case { name: string; mode: 'full' | 'fast'; seconds: number; at: 'all' | 'start' | 'end' }
const CASES: Case[] = [
  ...[0.5, 1.5, 2.25, 2.5, 5, 9.5, 10, 20, 30, 60, 300].map(seconds => ({ name: `${seconds}s`, mode: 'full' as const, seconds, at: 'all' as const })),
  // The tagger hears whole 10 s windows only: the tail of a 15 s or 25 s clip is left to the other detectors.
  ...[15, 25, 60, 300].flatMap(seconds => (['start', 'end'] as const).map(at => ({ name: `${seconds}s-${at}`, mode: 'full' as const, seconds, at }))),
  ...[20, 60, 300].map(seconds => ({ name: `fast-${seconds}s`, mode: 'fast' as const, seconds, at: 'all' as const })),
  ...(['start', 'end'] as const).map(at => ({ name: `fast-300s-${at}`, mode: 'fast' as const, seconds: 300, at })),
];
/** The sound lasts this long when it sits at the start or end of a recording. */
const EVENT_SECONDS = 4;

interface Detectors { heads: { group: DjGroup; label: string; threshold: number; maybe?: boolean }[]; short: { group: DjGroup; label: string; threshold: number; maybe?: boolean }[]; tagger: string[] }
function detectorsFor(key: string): Detectors {
  const heads = [...(learned.heads ?? []).map(h => ({ group: h.group, label: h.label, threshold: h.threshold, maybe: h.maybe })),
    ...(learned.neighbours?.heads ?? []).map(h => ({ group: h.group, label: h.label, threshold: .5 }))].filter(h => shownAs(h.group, h.label) === key);
  const short = shortClip.heads.filter(h => shownAs(h.group, h.label) === key).map(h => ({ group: h.group, label: h.label, threshold: h.threshold, maybe: h.maybe }));
  const tagger = TAGGER_POLICY.tags.filter(t => [...t.decides.map(label => ({ dimension: t.dimension, label })), ...(t.alsoDecides ?? [])]
    .some(n => shownAs(GROUP[n.dimension as Dim], n.label) === key)).map(t => t.output);
  return { heads, short, tagger };
}

const fired = (h: Detectors['heads'][number]): DescriptionScore =>
  ({ group: 'dj-learned', label: h.label, score: Math.min(1, h.threshold + .01), learnedGroup: h.group, decision: 'include', basis: 'head', ...(h.maybe ? { maybe: true } : {}) });

/** What the Sounds row lists when only this tag's detectors fire, in the windows that hear the sound. */
function shown(d: Detectors, c: Case): Map<string, boolean> {
  const event = c.at === 'all' ? { start: 0, end: c.seconds } : c.at === 'start' ? { start: 0, end: EVENT_SECONDS } : { start: c.seconds - EVENT_SECONDS, end: c.seconds };
  const hears = (start: number, end: number) => start < event.end && end > event.start;
  const descriptions = new DescriptionAccumulator(), dj = new DjTagEvidence();
  // analyzeDecodedMusic: the full scan scores every instrument window; the fast scan one representative 10 s section.
  const starts = c.mode === 'full' ? instrumentWindowStarts(c.seconds) : descriptionStarts(c.seconds, 'fast');
  for (const start of starts) {
    const end = Math.min(c.seconds, start + 10);
    let scores = hears(start, end) ? d.heads.map(fired) : [];
    const short = start === 0 && end >= c.seconds - 1e-6 && c.seconds <= SHORT_CLIP_MAX_SECONDS && end - start <= shortClip.maxSeconds;
    if (short) scores = [...oneShotClipScores(scores, learned), ...(hears(start, end) ? d.short.map(fired) : [])];
    descriptions.add(scores, { start, end });
    dj.add(selectDjTags(scores), start, end);
  }
  const tagger = new TaggerEvidence();
  for (const start of taggerWindowStarts(c.seconds)) {
    const end = Math.min(c.seconds, start + 10), on = hears(start, end);
    tagger.add(Object.fromEntries(TAGGER_POLICY.tags.map(t => [t.output, on && d.tagger.includes(t.output) ? .999 : 0])), { start, end });
  }
  const average = descriptions.average();
  const profile = combineSoundModels([], {}, average, { ast: false, jamendo: false, clap: true });
  mergeDjTags(profile, dj.results(), average);
  const analysis: MusicAnalysis = { version: 2, durationSeconds: c.seconds, analyzedSeconds: c.seconds, instruments: [], notes: [], soundProfile: profile,
    tagger: tagger.results(), instrumentScan: { mode: c.mode, complete: true, analyzedSeconds: c.seconds, windows: starts.length } };
  return new Map(confidentSoundSummary(analysis, c.mode).map(s => [`${s.dimension}:${s.label}`, !!s.maybe]));
}

/** Every tag a user can pick, under the name it shows as; DSP-rule words (warm, airy, ...) are not model decisions. */
const TAGS = [...new Set((Object.entries(DJ_PICKER_LABELS) as [DjGroup, readonly string[]][])
  .flatMap(([group, labels]) => labels.filter(l => !DJ_HIDDEN_LABELS.has(l) && !(group === 'character' && isRuleDescribedLabel(l))).map(l => shownAs(group, l))))].sort();

/** Y = shows, m = shows as a faded maybe, . = does not show. */
function matrix(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of TAGS) {
    const d = detectorsFor(key);
    if (!d.heads.length && !d.short.length && !d.tagger.length) { out[key] = 'no tested detector (raw CLAP prompt, file name or DSP rule only)'; continue; }
    out[key] = CASES.map(c => { const s = shown(d, c); return `${c.name} ${s.has(key) ? s.get(key) ? 'm' : 'Y' : '.'}`; }).join(' · ');
  }
  return out;
}
const serialize = (m: Record<string, string>) => `{\n${Object.entries(m).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n')}\n}\n`;

describe('every tag reaches the display when its own detectors fire', () => {
  const actual = matrix();
  it('matches the pinned routing matrix (tagRouting.expected.json)', () => {
    if (process.env.UPDATE_TAG_ROUTING) writeFileSync(EXPECTED_PATH, serialize(actual));
    const expected = JSON.parse(readFileSync(EXPECTED_PATH, 'utf8')) as Record<string, string>;
    const moved = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort().flatMap(key => {
      if (expected[key] === actual[key]) return [];
      if (!(key in expected)) return [`${key}: new tag, not in the matrix yet`];
      if (!(key in actual)) return [`${key}: no longer a pickable tag`];
      const was = new Map(expected[key].split(' · ').map(cell => cell.split(' ') as [string, string]));
      const cells = actual[key].split(' · ').map(cell => cell.split(' ') as [string, string]).filter(([name, v]) => was.get(name) !== v).map(([name, v]) => `${name} ${was.get(name) ?? '?'}->${v}`);
      return [`${key}: ${cells.join(', ') || actual[key]}`];
    });
    // Each line names the tag and the clip lengths whose outcome changed. Regenerate the file only for intended changes.
    expect(moved).toEqual([]);
  });

  it('every trained head can reach its own cutoff', () => {
    // The highest score a logistic head can give a unit-length fingerprint is sigmoid(bias + |weights|).
    const unreachable = (learned.heads ?? []).filter(h => 1 / (1 + Math.exp(-(h.bias + Math.hypot(...h.weights)))) < h.threshold).map(h => `${h.group}:${h.label}`);
    expect(unreachable).toEqual([]);
  });

  it('a tag the gunshot fix (#316) rescued still shows on a short one-shot', () => {
    for (const key of ['effect:gunshot', 'effect:footsteps']) expect(actual[key]).toMatch(/(^|· )0\.5s Y/);
  });
});

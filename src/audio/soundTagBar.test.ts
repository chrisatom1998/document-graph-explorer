import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { confidentSoundSummary, SOUND_TAG_BAR } from './confidentSoundSummary';
import { sanitizeLearnedDjModel } from './learnedDjModel';
import type { MusicAnalysis } from './musicTypes';
import { TAGGER_POLICY, TAGGER_REVISION } from './tagger';

/** Chris's 2026-10-10 bar: a tag ships as a normal (not "maybe") tag at held-out precision AND recall >= 0.50 on clips and
 * samples. Each head below was a "maybe" head that already cleared it on its own recorded held-out clips (matched by label
 * and threshold, scripts/head-scorecard.py) and was promoted by scripts/promote-heads.py, not retrained. */
const PROMOTED: [label: string, threshold: number, precision: number, recall: number, report: string][] = [
  ['beatbox', .843, 1, .96, 'dj-labels-2026-10-04/added-maybe-heads.json'],
  ['electric guitar', .933, .98, .81, 'dj-labels-2026-10-04/added-maybe-heads.json'],
  ['piano', .85, .99, .82, 'dj-labels-2026-10-04/added-maybe-heads.json'],
  ['organ', .92, .99, .90, 'dj-labels-2026-10-04/added-maybe-heads.json'],
  ['strings', .924, .99, .78, 'dj-labels-2026-10-04/added-maybe-heads.json'],
  ['mallet instrument', .936, .99, .80, 'dj-labels-2026-10-04/added-maybe-heads.json'],
  ['cowbell', .964, 1, .87, 'dj-labels-2026-10-04/added-maybe-heads.json'],
  ['accordion', .959, 1, .79, 'dj-labels-2026-10-04/added-maybe-heads.json'],
  ['gong', .923, .95, .81, 'dj-labels-2026-10-04/added-maybe-heads.json'],
  ['vocal gasp', .979, .85, .82, 'dj-labels-2026-10-04/added-maybe-heads.json'],
  ['rain ambience', .926, .90, .75, 'dj-labels-2026-10-04/added-heads-round21.json'],
  ['synthesizer', .66, .59, .67, 'dj-labels-2026-10-04/added-heads-round14-bar45.json'],
  ['drum fill', .909, .56, .64, 'dj-labels-2026-10-04/added-heads-round14-bar45.json'],
  ['choir', .967, .75, .51, 'dj-labels-2026-10-04/added-heads-round14-bar45.json'],
  ['clap', .943, .79, .51, 'dj-labels-2026-10-04/added-heads-round14-bar45.json'],
  ['chiptune synth', .959, .86, .52, 'dj-labels-2026-10-04/added-heads-round19.json'],
  ['voice', .5, .66, .59, 'dj-labels-2026-10-04/shipped-heads.json'],
  ['reverse cymbal', .7627, .69, .85, 'dj-effects-2026-10-06/shipped.json'],
  ['reverse effect', .786, .60, .56, 'dj-effects-2026-10-09/shipped.json'],
  ['air horn', .857, .92, .65, 'dj-effects-2026-10-09/shipped.json'],
  ['impact', .8206, .63, .72, 'dj-effects-2026-10-09/shipped.json'],
  ['riser', .8384, .68, .69, 'dj-effects-2026-10-09/shipped.json'],
  ['laser', .7867, .51, .53, 'dj-effects-2026-10-09/shipped.json'],
  // 2026-10-31: the shipped heads, unchanged, scored on held-out library brands (78 and 104 positives).
  ['vocal chops', .904, .628, .910, 'promote-vocal-chops-breakbeat-2026-10-31/heads.json'],
  ['breakbeat', .911, .716, .558, 'promote-vocal-chops-breakbeat-2026-10-31/heads.json'],
];
/** tag-heads-2026-10-09 heads are not cleared for one-shots, so ship.py tiers them on the held-out clips longer than
 * 2.25 s where the browser actually runs them (heldOutLongClip), not on the aggregate that included short clips. */
/** Clean cloud retrain (2026-10-11): Mac heads that had FSD50K eval in their training, refit from training clips only
 * (filtered against the fresh exclude list) and swapped in only when they pass the 60/30 ship line on every fresh test set
 * with 5+ positives, with the cutoff chosen on one half of the clips and judged on the other, both ways. Some of these
 * sounds have no free-tag-set positives, so FSD50K eval is their only scored set. Scores, set counts and a weight
 * checksum are in docs/evaluations/clean-retrain-2026-10-11/report.json. */
// Crash cymbal, vocal laugh, whisper and whoosh were swapped too, then reverted: they failed on the app's own (q8) fingerprints.
const CLEAN_RETRAINED = ['crowd ambience', 'finger snap', 'harmonica', 'harp', 'snare', 'tabla', 'trumpet', 'vinyl scratch'];
/** Trumpet was in that retrain, then replaced by the RWC refit. The report still lists it; the shipped weights no longer match it. */
const CLEAN_STILL_SHIPPED = CLEAN_RETRAINED.filter(label => label !== 'trumpet');
type CleanSet = { p: number; r: number; positives: number; negatives: number; fp: number };
type CleanHead = { label: string; threshold: number; coefficientDigest: string; fairPass60_30: boolean; countedSets: string[]; sets: Record<string, CleanSet> };
const cleanReport = () => JSON.parse(readFileSync('docs/evaluations/clean-retrain-2026-10-11/report.json', 'utf8')) as {
  heads: CleanHead[]; revertedHeads: { label: string; restoredFrom: string; threshold: number; coefficientDigest: string }[];
};
const cleanHeads = (): CleanHead[] => cleanReport().heads;
const REVERTED = ['crash cymbal', 'vocal laugh', 'whisper', 'whoosh'];
/** SHA-256 of the big-endian float64 bias followed by the weights. */
const coefficientDigest = (h: { bias: number; weights: number[] }) => {
  const coefficients = new DataView(new ArrayBuffer(8 * (h.weights.length + 1)));
  [h.bias, ...h.weights].forEach((v, i) => coefficients.setFloat64(8 * i, v));
  return createHash('sha256').update(new Uint8Array(coefficients.buffer)).digest('hex');
};
const RUNTIME_ELIGIBLE: [label: string, threshold: number, precision: number, recall: number][] = [
  ['kalimba', .8026, .74, .86], ['falling', .777, .61, .65], ['djembe', .9096, .62, .70], ['whistle', .8491, .62, .62],
  ['bongo', .9228, .54, .625],
];
/** Also run on clips of 2.25 s or less (2026-10-29): with the app-path scorer that follows the summary's display rules,
 * each passes 60/30 on the fresh test sets only when its head runs on short clips too (the one-shot model has no head for
 * them). Spoken phrase and vocal laugh pass on both group halves; clave, drum fill and tom have short-clip positives in one
 * half only. docs/evaluations/oneshot-heads-2026-10-29. */
const ONE_SHOT_2026_10_29: [label: string, threshold: number][] = [
  ['clave', .5], ['drum fill', .909], ['spoken phrase', .947], ['tom', .8114], ['vocal laugh', .965],
];
/** Below 50/50 on those clips: viola and marimba stay maybe; conga, gliding and tambourine (precision < 0.45) do not ship. */
const RUNTIME_MAYBE = ['viola', 'marimba'];
/** coefficientDigest of the shipped rimshot head (2026-10-31). */
const RIMSHOT_DIGEST = 'd5d324125fabc9c5f5b4bdc875bfe55294ba45959173b3e6e015edc7e17a2e34';
/** coefficientDigest of the shipped supersaw head (2026-10-31). */
const SUPERSAW_DIGEST = 'c897085d054edfc627c9de0eaeaf139752db689a896091782161251c22eed3cc';
const RUNTIME_DROPPED = ['conga', 'gliding', 'tambourine'];
/** Held back: their 50/50 was measured only on NSynth (incl. code-made effect renders), with no real held-out clips that
 * confirm the shipped head; glassy is a timbre rule word. They keep their current tier. */
const STILL_MAYBE = ['bright', 'dark', 'glassy', 'percussive', 'pulsing', 'swelling', 'wobbling', 'noise sweep', 'filter sweep'];

interface Head { label: string; threshold: number; weights: number[]; bias: number; maybe?: boolean; oneShot?: boolean }
const learned = (JSON.parse(readFileSync('public/sound-model/learned.json', 'utf8')) as { heads: Head[] }).heads;
const head = (label: string) => learned.find(h => h.label === label)!;
type Row = { label?: string; name?: string; threshold?: number | null; precision?: number | null; recall?: number | null };
const rows = (report: string): Row[] => {
  const d = JSON.parse(readFileSync(`docs/evaluations/${report}`, 'utf8')) as Record<string, unknown>;
  return ['heads', 'updates', 'results'].flatMap(k => Array.isArray(d[k]) ? d[k] as Row[] : []);
};

describe('the 50/50 shipping bar', () => {
  it('is 0.50 precision and recall', () => { expect(SOUND_TAG_BAR).toBe(.5); });

  it.each(PROMOTED)('ships %s as a normal head, backed by its recorded held-out score', (label, threshold, precision, recall, report) => {
    const h = head(label);
    expect(h.maybe).toBeUndefined();
    expect(h.threshold).toBeCloseTo(threshold, 4);
    expect(Math.min(precision, recall)).toBeGreaterThanOrEqual(SOUND_TAG_BAR);
    const row = rows(report).find(r => (r.label ?? r.name) === label && r.threshold != null && Math.abs(r.threshold - threshold) < 6e-4);
    expect(row, `${label} @ ${threshold} in ${report}`).toBeDefined();
    expect(row!.precision!).toBeCloseTo(precision, 2);
    expect(row!.recall!).toBeCloseTo(recall, 2);
  });

  it('lists exactly the clean-retrained heads the report swaps in', () => {
    expect(cleanHeads().map(c => c.label).sort()).toEqual([...CLEAN_RETRAINED].sort());
  });

  it('lists exactly the heads reverted to their pre-#232 weights', () => {
    expect(cleanReport().revertedHeads.map(r => r.label).sort()).toEqual([...REVERTED].sort());
  });

  it.each(REVERTED)('ships %s with its pre-#232 weights and cutoff', label => {
    const h = head(label);
    const r = cleanReport().revertedHeads.find(x => x.label === label)!;
    expect(r.restoredFrom).toBe('59efdbd');
    expect(h.threshold).toBeCloseTo(r.threshold, 6);
    expect(coefficientDigest(h)).toBe(r.coefficientDigest);
  });

  it('ships the RWC trumpet refit in place of the clean-retrain head', () => {
    const h = head('trumpet');
    const previous = cleanHeads().find(r => r.label === 'trumpet')!;
    expect(h.maybe).toBeUndefined();
    expect(h.threshold).toBeCloseTo(0.863, 6);
    expect(h.bias).toBeCloseTo(-4.108752, 6);
    expect(h.weights).toHaveLength(512);
    expect(h.weights[0]).toBeCloseTo(0.926403, 6);
    expect(h.weights.at(-1)).toBeCloseTo(0.144107, 6);
    expect(coefficientDigest(h)).not.toBe(previous.coefficientDigest);
    const loaded = sanitizeLearnedDjModel(JSON.parse(readFileSync('public/sound-model/learned.json', 'utf8')));
    expect(loaded?.heads?.find(x => x.label === 'trumpet')).toMatchObject({ threshold: 0.863, bias: -4.108752 });
  });

  it.each(CLEAN_STILL_SHIPPED)('ships %s as a clean-retrained head that passes 60/30 on every fresh test set', label => {
    const h = head(label);
    const c = cleanHeads().find(r => r.label === label)!;
    expect(h.maybe).toBeUndefined();
    expect(h.threshold).toBeCloseTo(c.threshold, 4);
    expect(coefficientDigest(h)).toBe(c.coefficientDigest);
    expect(c.fairPass60_30).toBe(true);
    expect(c.countedSets.length).toBeGreaterThan(0);
    for (const set of c.countedSets) {
      expect(c.sets[set].p).toBeGreaterThanOrEqual(.6);
      expect(c.sets[set].r).toBeGreaterThanOrEqual(.3);
    }
    for (const v of Object.values(c.sets)) if (v.positives < 5 && v.negatives >= 50) expect(v.fp).toBeLessThanOrEqual(.01 * v.negatives);
  });

  it.each(RUNTIME_ELIGIBLE)('ships %s as a normal head from its runtime-eligible held-out score', (label, threshold, precision, recall) => {
    const h = head(label);
    expect(h.maybe).toBeUndefined();
    expect(h.oneShot).toBeUndefined();
    expect(h.threshold).toBeCloseTo(threshold, 4);
    expect(Math.min(precision, recall)).toBeGreaterThanOrEqual(SOUND_TAG_BAR);
    const row = rows('tag-heads-2026-10-09/shipped.json').find(r => r.label === label) as Row & { shipped?: boolean; tier?: string; evaluationSubset?: string };
    expect(row).toMatchObject({ shipped: true, tier: 'full', evaluationSubset: 'held-out clips > 2.25 s' });
    expect(row.precision!).toBeCloseTo(precision, 2);
    expect(row.recall!).toBeCloseTo(recall, 2);
  });

  it.each(RUNTIME_MAYBE)('keeps %s as a maybe head below 50/50 on runtime-eligible clips', label => {
    expect(head(label).maybe).toBe(true);
    const row = rows('tag-heads-2026-10-09/shipped.json').find(r => r.label === label)!;
    expect(Math.min(row.precision!, row.recall!)).toBeLessThan(SOUND_TAG_BAR);
  });

  it.each(RUNTIME_DROPPED)('does not ship %s, which fails on the clips where it would run', label => {
    expect(learned.some(h => h.label === label)).toBe(false);
  });

  it.each(ONE_SHOT_2026_10_29)('runs %s on short clips at its unchanged cutoff', (label, threshold) => {
    expect(head(label).oneShot).toBe(true);
    expect(head(label).threshold).toBeCloseTo(threshold, 4);
  });

  // Trained from training-only mirror clips (filtered against the private exclude list) and judged once on the fresh test
  // sets with the app-path scorer. docs/evaluations/rimshot-supersaw-heads-2026-10-31.
  // Trained on FSD50K dev train clips, cutoffs set on FSD50K dev val, judged once on FSD50K eval (no shared uploaders).
  // reports/dj-tags-plan-2026-11-01 (female P 0.794 / R 0.771, male P 0.620 / R 0.629, no NSynth false alarms).
  it.each([['female vocal', .76], ['male vocal', .79]] as const)('ships the %s head as a normal tag at its dev-val cutoff', (label, threshold) => {
    expect(head(label)).toMatchObject({ group: 'production' });
    expect(head(label).maybe).toBeUndefined();
    expect(head(label).threshold).toBeCloseTo(threshold, 4);
  });
  // Trained on FSD50K dev train + AudioSet + Freesound training clips, cutoff set on FSD50K dev val, judged once on FSD50K
  // eval: P 0.641 / R 0.843, no NSynth false alarms. reports/bass-acapella-rap-2026-11-02.
  it('ships the acapella head as a normal tag at its dev-val cutoff', () => {
    expect(head('acapella')).toMatchObject({ group: 'production' });
    expect(head('acapella').maybe).toBeUndefined();
    expect(head('acapella').threshold).toBeCloseTo(.92, 4);
  });
  // Trained on FSD50K dev train clips, cutoffs set on FSD50K dev val, judged once on FSD50K eval: gunshot P 0.684 / R 0.903,
  // footsteps P 0.757 / R 0.522, at most 2 NSynth false alarms in 4,096. They also run on clips of 2.25 s or less (oneShot):
  // on dev val that lifts gunshot recall 0.42 -> 0.90 at P 0.65. docs/evaluations/sfx-tags-2026-11-06.
  it.each([
    ['gunshot', .78, 'd247254af8d214c6bfab6d36009ee143be02277dd7796175228d9e897b0c958b'],
    ['footsteps', .88, 'd7dfdf5e12bf1e8f2cd35cb3cbbf9da6b23ee875fdc56fb4bc031a34adf6814f'],
    // Second batch (same recipe): clock P 0.654 / R 0.918, chimes P 0.912 / R 0.608, no NSynth false alarms.
    ['clock', .71, '76934099decd926c9ac3f1583efb59e70b9b6e738a5904461dc6f94dcd6fa313'],
    ['chimes', .98, '76bcd1bd14c0ff0cc92a1fc640920a3112809a0575be0f5078b6c196efb46446'],
    // Third batch: cat meow P 0.645 / R 1.000, applause P 0.659 / R 0.940, knock P 0.724 / R 0.816,
    // typing P 0.778 / R 0.842, train P 0.620 / R 0.838; no NSynth false alarms.
    // cat meow and applause were cut at 0.29 on dev val; the loader rejects cutoffs under 0.5, so their bias carries
    // logit(0.29) and they cut at 0.5 with the same decisions.
    ['cat meow', .5, '96ffcf969d4dacbe3bcc9d10dfebee16d60b40d0193db64de9eb76610a643e3d'],
    ['applause', .5, 'f4c4a475aa922a88459e13fc15635b109ce0d4e9c99f69510af27fe369c4d2b7'],
    ['knock', .86, '027736acb00a3ca1e59cecadf5ccbc70acab897d3ccb0478597780db2baa4203'],
    ['typing', .73, '84c4d07944b40d543752cc009cdbe59c24fe9ffeaf3c869c9a7b5ce205f0ea60'],
    ['train', .93, 'f72237eeefaf79674c2a1787420f3b2ebc39393482fc486758d7f4128e579c33'],
    // Fresh-set retry (heads and cutoffs frozen on dev val, judged once on the fresh BBC + ESC-50 set): thunder P 0.630 /
    // R 0.750, phone ring P 0.966 / R 0.757, explosion P 0.797 / R 0.596; NSynth-valid false alarms 0 / 7 / 15 of 4,096.
    ['phone ring', .99, 'b06a9b6919db74db6c91c49a22b2ded21683820fe3ed8ff46b41e55e29d90c25'],
  ] as const)('ships the %s head as a normal tag on clips of any length at its dev-val cutoff', (label, threshold, digest) => {
    expect(head(label)).toMatchObject({ group: 'production', oneShot: true });
    expect(head(label).maybe).toBeUndefined();
    expect(head(label).threshold).toBeCloseTo(threshold, 4);
    expect(coefficientDigest(head(label))).toBe(digest);
  });
  // Thunder and explosion passed the fresh set but missed FSD50K eval earlier (P 0.557 / 0.571), so they ship as maybes
  // until a second held-out set confirms them (Chris, 2026-11-06). thunder was cut at 0.32 on dev val, so its bias
  // carries logit(0.32) and it cuts at 0.5 with the same decisions.
  it.each([
    ['thunder', .5, '92d88fd5efbdcf0f8c287d7b02997d596255010ea5f4ea05b25364ce0376a4e3'],
    ['explosion', .72, '0686b128dcfd4b6bd4bb2cd8d2b50d02b976963a123ae9e5a1d6e6b07721a0e1'],
  ] as const)('ships the borderline %s head as a maybe on clips of any length at its dev-val cutoff', (label, threshold, digest) => {
    expect(head(label)).toMatchObject({ group: 'production', oneShot: true, maybe: true });
    expect(head(label).threshold).toBeCloseTo(threshold, 4);
    expect(coefficientDigest(head(label))).toBe(digest);
  });
  it('ships the rimshot head on short clips at its out-of-fold cutoff', () => {
    expect(head('rimshot')).toMatchObject({ group: 'production', oneShot: true });
    expect(head('rimshot').maybe).toBeUndefined();
    expect(head('rimshot').threshold).toBeCloseTo(.8187, 4);
    expect(coefficientDigest(head('rimshot'))).toBe(RIMSHOT_DIGEST);
  });

  it('ships the supersaw head on longer clips only at its out-of-fold cutoff', () => {
    expect(head('supersaw')).toMatchObject({ group: 'production' });
    expect(head('supersaw').maybe).toBeUndefined();
    expect(head('supersaw').oneShot).toBeUndefined();
    expect(head('supersaw').threshold).toBeCloseTo(.8981, 4);
    expect(coefficientDigest(head('supersaw'))).toBe(SUPERSAW_DIGEST);
  });

  it('keeps the one-shot safeguard on promoted one-shot heads', () => {
    expect([head('impact').oneShot, head('laser').oneShot, head('vinyl scratch').oneShot]).toEqual([true, true, true]);
  });

  it.each(STILL_MAYBE)('leaves %s as a maybe head', label => { expect(head(label).maybe).toBe(true); });

  it('marks the tagger outputs measured at 50/50 on real held-out audio as tested', () => {
    const tested = (output: string) => TAGGER_POLICY.tags.find(t => t.output === output)!.tested;
    // trumpet: DJ clips rounds 1 and 2 (0.79/0.88, 0.68/0.83); rain ambience: FSD50K eval (0.87/0.70, run 7).
    expect([tested('trumpet'), tested('cat:rain ambience')]).toEqual([true, true]);
    // Runs 5, 7 and 8 (tagger-run7/run8-results-2026-10-10): weakest real held-out set at 50/50 or better.
    expect(['synthesizer', 'cat:animal sound', 'cat:percussion', 'cat:tambourine', 'cat:vocal scream', 'cat:glockenspiel', 'cat:whistle'].map(tested))
      .toEqual([true, true, true, true, true, true, true]);
    // Runs 3/5 outputs at 50/50 on FSD50K eval (tagger-promotions-2026-10-10).
    expect(['cat:environmental sound', 'cat:foley', 'cat:turntable', 'cat:finger snap', 'cat:water ambience'].map(tested))
      .toEqual([true, true, true, true, true]);
    // Run 9 (tagger-run9): bell (0.72/0.62 on FSD50K eval; the old detector was 0.78/0.58, so a precision/recall trade), water ambience
    // and fm synth clear their bars on held-out audio.
    expect(['cat:bell', 'cat:fm synth'].map(tested)).toEqual([true, true]);
    // Measured only on NSynth and its effect renders: unchanged.
    expect(['cat:bright', 'cat:dark', 'cat:distorted', 'cat:falling'].map(tested)).toEqual([false, false, false, false]);
    expect(['cat:percussive', 'cat:pulsing', 'cat:swelling', 'cat:wobbling', 'cat:reverse effect'].map(tested)).toEqual([true, true, true, true, true]);
  });

  const withTag = (label: string, group: 'source' | 'production' | 'character', model: 'Trained head' | 'Trained head (maybe)', durationSeconds = 8): MusicAnalysis =>
    ({ version: 2, durationSeconds, analyzedSeconds: durationSeconds, instruments: [], notes: [],
      soundProfile: { version: 1, character: [], roles: [], models: [], disagreement: false, djTags: [{ group, label, score: .9, model }] } });
  it('shows a promoted head as a normal likely tag, not a faded maybe', () => {
    for (const [label, group] of [['beatbox', 'production'], ['organ', 'source'], ['riser', 'production']] as const)
      expect(confidentSoundSummary(withTag(label, group, 'Trained head'))[0]).toMatchObject({ label, origin: 'model estimate', tier: 'likely', scores: [{ model: 'Trained head score', score: .9 }] });
    expect(confidentSoundSummary(withTag('beatbox', 'production', 'Trained head'))[0].maybe).toBeUndefined();
    expect(confidentSoundSummary(withTag('gliding', 'character', 'Trained head (maybe)'))[0]).toMatchObject({ label: 'gliding', maybe: true });
  });

  it('shows a tagger trumpet on a full recording as a normal tag', () => {
    const a: MusicAnalysis = { version: 2, durationSeconds: 10, analyzedSeconds: 10, instruments: [], notes: [], tagger: { revision: TAGGER_REVISION, windows: 1, scores: { trumpet: .98 } } };
    const trumpet = confidentSoundSummary(a).find(s => s.label === 'trumpet');
    expect(trumpet).toMatchObject({ origin: 'model estimate', tier: 'likely', scores: [{ model: 'Trained tagger score' }] });
    expect(trumpet?.maybe).toBeUndefined();
  });

  it('hides a trumpet score just under the 0.9486 cutoff on a full recording', () => {
    const a: MusicAnalysis = { version: 2, durationSeconds: 10, analyzedSeconds: 10, instruments: [], notes: [], tagger: { revision: TAGGER_REVISION, windows: 1, scores: { trumpet: .9 } } };
    expect(confidentSoundSummary(a).find(s => s.label === 'trumpet')).toBeUndefined();
  });

  it('hides a tagger downlifter (falling) score under the 0.8101 cutoff and keeps one above it', () => {
    const at = (falling: number): MusicAnalysis => ({ version: 2, durationSeconds: 10, analyzedSeconds: 10, instruments: [], notes: [], tagger: { revision: TAGGER_REVISION, windows: 1, scores: { 'cat:falling': falling } } });
    expect(confidentSoundSummary(at(.7)).find(s => s.label === 'falling')).toBeUndefined();
    expect(confidentSoundSummary(at(.9)).find(s => s.label === 'falling')).toBeDefined();
  });
});

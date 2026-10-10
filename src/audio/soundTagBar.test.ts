import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { confidentSoundSummary, SOUND_TAG_BAR } from './confidentSoundSummary';
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
  ['harmonica', .964, 1, .91, 'dj-labels-2026-10-04/added-maybe-heads.json'],
  ['vocal laugh', .965, .95, .91, 'dj-labels-2026-10-04/added-maybe-heads.json'],
  ['strings', .924, .99, .78, 'dj-labels-2026-10-04/added-maybe-heads.json'],
  ['harp', .927, 1, .84, 'dj-labels-2026-10-04/added-maybe-heads.json'],
  ['mallet instrument', .936, .99, .80, 'dj-labels-2026-10-04/added-maybe-heads.json'],
  ['crowd ambience', .969, .92, .89, 'dj-labels-2026-10-04/added-maybe-heads.json'],
  ['cowbell', .964, 1, .87, 'dj-labels-2026-10-04/added-maybe-heads.json'],
  ['accordion', .959, 1, .79, 'dj-labels-2026-10-04/added-maybe-heads.json'],
  ['gong', .923, .95, .81, 'dj-labels-2026-10-04/added-maybe-heads.json'],
  ['trumpet', .88, .94, .83, 'dj-labels-2026-10-04/added-maybe-heads.json'],
  ['vocal gasp', .979, .85, .82, 'dj-labels-2026-10-04/added-maybe-heads.json'],
  ['rain ambience', .926, .90, .75, 'dj-labels-2026-10-04/added-heads-round21.json'],
  ['synthesizer', .66, .59, .67, 'dj-labels-2026-10-04/added-heads-round14-bar45.json'],
  ['drum fill', .909, .56, .64, 'dj-labels-2026-10-04/added-heads-round14-bar45.json'],
  ['choir', .967, .75, .51, 'dj-labels-2026-10-04/added-heads-round14-bar45.json'],
  ['clap', .943, .79, .51, 'dj-labels-2026-10-04/added-heads-round14-bar45.json'],
  ['snare', .895, .71, .53, 'dj-labels-2026-10-04/added-heads-round24.json'],
  ['chiptune synth', .959, .86, .52, 'dj-labels-2026-10-04/added-heads-round19.json'],
  ['voice', .5, .66, .59, 'dj-labels-2026-10-04/shipped-heads.json'],
  ['reverse cymbal', .7627, .69, .85, 'dj-effects-2026-10-06/shipped.json'],
  ['reverse effect', .786, .60, .56, 'dj-effects-2026-10-09/shipped.json'],
  ['air horn', .857, .92, .65, 'dj-effects-2026-10-09/shipped.json'],
  ['impact', .8206, .63, .72, 'dj-effects-2026-10-09/shipped.json'],
  ['riser', .8384, .68, .69, 'dj-effects-2026-10-09/shipped.json'],
  ['laser', .7867, .51, .53, 'dj-effects-2026-10-09/shipped.json'],
  ['falling', .777, .61, .63, 'tag-heads-2026-10-09/shipped.json'],
  ['viola', .8987, .51, .53, 'tag-heads-2026-10-09/shipped.json'],
  ['whistle', .8491, .65, .64, 'tag-heads-2026-10-09/shipped.json'],
  ['conga', .9037, .61, .72, 'tag-heads-2026-10-09/shipped.json'],
  ['bongo', .9228, .61, .60, 'tag-heads-2026-10-09/shipped.json'],
  ['tom', .8114, .60, .73, 'tag-heads-2026-10-09/shipped.json'],
];
/** Held back: their 50/50 was measured only on NSynth (incl. code-made effect renders), with no real held-out clips that
 * confirm the shipped head; glassy is a timbre rule word. They keep their current tier. */
const STILL_MAYBE = ['bright', 'dark', 'glassy', 'percussive', 'pulsing', 'swelling', 'wobbling', 'gliding', 'marimba', 'tambourine', 'noise sweep', 'filter sweep'];

interface Head { label: string; threshold: number; maybe?: boolean; oneShot?: boolean }
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

  it('keeps the one-shot safeguard on promoted one-shot heads', () => {
    expect([head('impact').oneShot, head('laser').oneShot, head('vinyl scratch').oneShot]).toEqual([true, true, true]);
  });

  it.each(STILL_MAYBE)('leaves %s as a maybe head', label => { expect(head(label).maybe).toBe(true); });

  it('marks the tagger outputs measured at 50/50 on real held-out audio as tested', () => {
    const tested = (output: string) => TAGGER_POLICY.tags.find(t => t.output === output)!.tested;
    // trumpet: DJ clips rounds 1 and 2 (0.79/0.88, 0.68/0.83); rain ambience: FSD50K eval (0.86/0.66).
    expect([tested('trumpet'), tested('cat:rain ambience')]).toEqual([true, true]);
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
    const a: MusicAnalysis = { version: 2, durationSeconds: 10, analyzedSeconds: 10, instruments: [], notes: [], tagger: { revision: TAGGER_REVISION, windows: 1, scores: { trumpet: .9 } } };
    const trumpet = confidentSoundSummary(a).find(s => s.label === 'trumpet');
    expect(trumpet).toMatchObject({ origin: 'model estimate', tier: 'likely', scores: [{ model: 'Trained tagger score' }] });
    expect(trumpet?.maybe).toBeUndefined();
  });
});

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { confidentSoundSummary, SOUND_TAG_BAR } from './confidentSoundSummary';
import type { MusicAnalysis } from './musicTypes';

/** RWC woodwind refit (2026-10-30): bassoon refit with RWC bassoon notes, fit on training rows only and judged once on the
 * recipe's real-recordings test and on a held-out half of the RWC players (docs/evaluations/rwc-woodwind-heads-2026-10-30).
 * Flute and oboe were refit the same way, failed the pre-registered rule, and keep their old heads. */
interface Head { group: string; label: string; threshold: number; weights: number[]; bias: number; maybe?: boolean; oneShot?: boolean }
type Score = { precision: number | null; recall: number; positives: number };
interface ReportHead { label: string; threshold: number; passes: boolean; coefficientDigest?: string; existing: { after: Score }; rwcHalf: { after: Score } }
const report = JSON.parse(readFileSync('docs/evaluations/rwc-woodwind-heads-2026-10-30/report.json', 'utf8')) as { heads: ReportHead[] };
const learned = (JSON.parse(readFileSync('public/sound-model/learned.json', 'utf8')) as { heads: Head[] }).heads;
const head = (label: string) => learned.find(h => h.label === label)!;
/** SHA-256 of the big-endian float64 bias followed by the weights (as in soundTagBar.test.ts). */
const coefficientDigest = (h: { bias: number; weights: number[] }) => {
  const coefficients = new DataView(new ArrayBuffer(8 * (h.weights.length + 1)));
  [h.bias, ...h.weights].forEach((v, i) => coefficients.setFloat64(8 * i, v));
  return createHash('sha256').update(new Uint8Array(coefficients.buffer)).digest('hex');
};

describe('RWC woodwind refit', () => {
  it('ships the bassoon head that was scored, as a normal tag', () => {
    const h = head('bassoon'), r = report.heads.find(x => x.label === 'bassoon')!;
    expect(h).toMatchObject({ group: 'source', threshold: r.threshold });
    expect(h.maybe).toBeUndefined();
    expect(h.oneShot).toBeUndefined();
    expect(coefficientDigest(h)).toBe(r.coefficientDigest);
  });

  it('clears 50/50 on both held-out judges', () => {
    const r = report.heads.find(x => x.label === 'bassoon')!;
    expect(r.passes).toBe(true);
    for (const s of [r.existing.after, r.rwcHalf.after]) {
      expect(s.positives).toBeGreaterThanOrEqual(5);
      expect(Math.min(s.precision!, s.recall)).toBeGreaterThanOrEqual(SOUND_TAG_BAR);
    }
  });

  it.each(['flute', 'oboe'])('leaves %s unchanged after it failed the rule', label => {
    expect(report.heads.find(x => x.label === label)!.passes).toBe(false);
    expect(head(label).maybe).toBe(true);
  });

  it('shows a bassoon head score as a normal likely tag', () => {
    const a: MusicAnalysis = { version: 2, durationSeconds: 8, analyzedSeconds: 8, instruments: [], notes: [],
      soundProfile: { version: 1, character: [], roles: [], models: [], disagreement: false, djTags: [{ group: 'source', label: 'bassoon', score: .95, model: 'Trained head' }] } };
    const shown = confidentSoundSummary(a).find(s => s.label === 'bassoon');
    expect(shown).toMatchObject({ origin: 'model estimate', tier: 'likely' });
    expect(shown?.maybe).toBeUndefined();
  });
});

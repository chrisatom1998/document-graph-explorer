import { describe, expect, it } from 'vitest';
import { computeTimbre, sanitizeTimbre, TimbreFeatures, timbreExcerpts, TIMBRE_SAMPLE_RATE, type TimbreSummary } from './timbre';
import { isRuleDescribedLabel, MAX_TIMBRE_WORDS, RULE_DESCRIBED_LABELS, TIMBRE_DEFINITIONS, timbreDescriptions } from './timbreDescriptions';
import { clip, highPass, mix, noise, partials, saw, sine } from './timbreSignals.testutil';
import { sanitizeMusicAnalysis } from './musicTypes';

const measure = (x: Float32Array) => { const f = new TimbreFeatures(); f.add(x); return f.summary()!; };
const words = (x: Float32Array) => timbreDescriptions(measure(x));

/** Steady 150 Hz harmonic tone (3 dB/octave tilt) whose 500 Hz–2 kHz harmonics are cut by 30 dB. */
function scooped() {
  const out = new Float32Array(TIMBRE_SAMPLE_RATE);
  for (let n = 1; n * 150 < 8000; n++) { const f = 150 * n, g = f >= 500 && f <= 2000 ? .03 : 1; sine(f, 1, .1 * g / Math.sqrt(n)).forEach((v, i) => { out[i] += v; }); }
  return out;
}
/** Steady sawtooth at 150 Hz with its 1.25–1.75 kHz harmonics raised 18 dB (a formant). */
function nasalTone() {
  const out = new Float32Array(TIMBRE_SAMPLE_RATE);
  for (let n = 1; n * 150 < 16000; n++) { const f = 150 * n, g = Math.abs(f - 1500) < 250 ? 8 : 1; sine(f, 1, .05 * g / n).forEach((v, i) => { out[i] += v; }); }
  return out;
}

describe('timbre descriptor', () => {
  it('measures band balance, noise, crest and decay on known signals', () => {
    const low = measure(sine(220));
    expect(low.bands[1]).toBeGreaterThan(.99);
    expect(low.flatness).toBeLessThan(.01);
    expect(low.crest).toBeCloseTo(Math.SQRT2, 1);
    expect(low.sustain).toBeGreaterThan(.95);
    const hiss = measure(highPass(noise()));
    expect(hiss.bands[5]).toBeGreaterThan(.9);
    expect(hiss.airFlatness).toBeGreaterThan(.3);
    expect(measure(noise()).flatness).toBeGreaterThan(.45);
    expect(measure(clip(saw(110), 8)).crest).toBeLessThan(1.3);
    expect(measure(partials(300, [1, 3.9, 9.2], 1, 12)).sustain).toBeLessThan(.1);
    expect(measure(saw(110)).inharmonicity).toBeLessThan(.05);
    expect(measure(partials(440, [1, 2.76, 5.4, 8.93], 1, 1.5, [1, .8, .6, .4])).inharmonicity).toBeGreaterThan(.35);
    expect(measure(scooped()).scoopDb).toBeGreaterThan(10);
    expect(measure(nasalTone()).resonanceDb).toBeGreaterThan(8);
  });

  it('ignores silence and returns nothing for an all-silent recording', () => {
    expect(new TimbreFeatures().summary()).toBeUndefined();
    const f = new TimbreFeatures(); f.add(new Float32Array(TIMBRE_SAMPLE_RATE)); expect(f.summary()).toBeUndefined();
  });

  it('reads the whole of a short clip and three 4 s excerpts of a long track', async () => {
    expect(timbreExcerpts(10)).toEqual([{ start: 0, seconds: 10 }]);
    expect(timbreExcerpts(200).map(e => e.seconds)).toEqual([4, 4, 4]);
    expect(timbreExcerpts(0)).toEqual([]);
    const reads: number[] = [];
    const t = await computeTimbre(async (start, seconds) => { reads.push(start); return sine(220, seconds); }, 120);
    expect(reads).toHaveLength(3);
    expect(timbreDescriptions(t)).toEqual(['warm', 'smooth']);
  });

  it('keeps only an in-range summary when sanitizing saved analyses', () => {
    const t = measure(sine(220));
    expect(sanitizeTimbre(JSON.parse(JSON.stringify(t)))).toEqual(t);
    expect(sanitizeTimbre({ ...t, crest: 0 })).toBeUndefined();
    expect(sanitizeTimbre({ ...t, bands: [1, 0] })).toBeUndefined();
    expect(sanitizeTimbre({ ...t, version: 2 })).toBeUndefined();
    expect(sanitizeTimbre({ ...t, scoopDb: 999 })).toBeUndefined();
    const base = { version: 2, durationSeconds: 8, analyzedSeconds: 8, instruments: [], notes: [] };
    expect(sanitizeMusicAnalysis({ ...base, timbre: t })?.timbre).toEqual(t);
    expect(sanitizeMusicAnalysis({ ...base, timbre: { ...t, flatness: 'x' } })?.timbre).toBeUndefined();
    expect(sanitizeMusicAnalysis(base)?.timbre).toBeUndefined();
  });
});

describe('timbre descriptions', () => {
  it('describes synthetic signals with their own words', () => {
    expect(words(sine(220))).toEqual(['warm', 'smooth']);
    expect(words(mix(sine(220), sine(440, 1, .15), sine(660, 1, .05)))).toContain('warm');
    expect(words(sine(1000))).toEqual(['smooth']);
    expect(words(sine(3000))).toContain('glassy');
    expect(words(highPass(noise()))).toEqual(['airy']);
    expect(words(clip(saw(110), 8))).toEqual(['gritty']);
    expect(words(partials(440, [1, 2.76, 5.4, 8.93], 1, 1.5, [1, .8, .6, .4]))).toEqual(['metallic']);
    expect(words(partials(300, [1, 3.9, 9.2], 1, 12))).toEqual(['woody']);
    expect(words(scooped())).toContain('hollow');
    expect(words(nasalTone())).toContain('nasal');
  });

  it('is conservative: a plain sawtooth gets no word, and no sound gets more than three', () => {
    expect(words(saw(110))).toEqual([]);
    expect(words(saw(110)).length + words(noise()).length).toBeLessThanOrEqual(1);
    const everything: TimbreSummary = { version: 1, bands: [0, .45, .05, .4, .05, .05], flatness: 0, airFlatness: 0, crest: 1.4, richness: .1, sustain: 1, scoopDb: 0, resonanceDb: 0, inharmonicity: 0 };
    expect(timbreDescriptions(everything).length).toBeLessThanOrEqual(MAX_TIMBRE_WORDS);
    expect(timbreDescriptions(undefined)).toEqual([]);
  });

  it('defines every rule word in one plain line', () => {
    expect(RULE_DESCRIBED_LABELS).toHaveLength(9);
    for (const word of RULE_DESCRIBED_LABELS) { expect(isRuleDescribedLabel(word)).toBe(true); expect(TIMBRE_DEFINITIONS[word]).toMatch(/^[^\n]{10,120}$/); }
    expect(isRuleDescribedLabel('bright')).toBe(false);
  });
});

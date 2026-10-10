import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { confidentSoundSummary } from './confidentSoundSummary';
import { sanitizeMusicAnalysis, type MusicAnalysis } from './musicTypes';
import { dimensionLabels } from './recognition';
import { canonicalDjLabel } from './djTags';
import { TAGGER_MAYBE_SCORE, TAGGER_POLICY, TAGGER_REVISION, TAGGER_SCORE, TAGGER_UNAVAILABLE, TaggerEvidence, isTaggerScores, sanitizeTaggerAnalysis, taggerDecisions, taggerWindowStarts, type TaggerTag } from './tagger';

const threshold = (output: string) => TAGGER_POLICY.tags.find(t => t.output === output)!.threshold;
const track = (seconds: number, scores: Record<string, number>, djTags: NonNullable<MusicAnalysis['soundProfile']>['djTags'] = []): MusicAnalysis => ({
  version: 2, durationSeconds: seconds, analyzedSeconds: Math.min(seconds, 60), instruments: [], notes: [],
  soundProfile: { version: 1, character: [], roles: [], models: [], disagreement: false, djTags },
  tagger: { revision: TAGGER_REVISION, windows: 1, scores },
});

describe('trained tagger policy', () => {
  it('names outputs of the pinned model and labels the app can show', () => {
    const model = JSON.parse(readFileSync('public/tagger-model/model.json', 'utf8')) as { classes: string[]; sha256: Record<string, string> };
    const manifest = JSON.parse(readFileSync('public/tagger-model/manifest.json', 'utf8')) as { sha256: Record<string, string> };
    expect(model.sha256['model.onnx']).toBe(TAGGER_POLICY.modelSha256);
    expect(manifest.sha256['model.onnx']).toBe(TAGGER_POLICY.modelSha256);
    for (const tag of TAGGER_POLICY.tags) {
      expect(model.classes).toContain(tag.output);
      expect(tag.threshold).toBeGreaterThan(0); expect(tag.threshold).toBeLessThan(1);
      expect(tag.decides[0]).toBe(tag.label);
      const supported = dimensionLabels[tag.dimension].includes(tag.label) || (tag.dimension === 'effect' && !!canonicalDjLabel('production', tag.label));
      expect(supported, tag.label).toBe(true);
    }
  });
  it('keeps the existing detectors for voice, organ and cello', () => {
    const decided = new Set(TAGGER_POLICY.tags.flatMap(t => t.decides));
    for (const label of ['voice', 'organ', 'cello']) expect(decided.has(label)).toBe(false);
    expect(TAGGER_POLICY.tags.filter(t => t.dimension === 'source').map(t => t.output).sort())
      .toEqual(['bass', 'cat:animal sound', 'cat:bell', 'cat:environmental sound', 'cat:foley', 'cat:glockenspiel', 'cat:percussion', 'cat:turntable', 'cat:whistle', 'cymbals',
        'drums', 'guitar', 'piano', 'saxophone', 'synthesizer', 'trumpet', 'violin']);
  });
});

describe('trained tagger windows and storage', () => {
  it('only reuses cached inference with every policy output present and valid', () => {
    const scores = Object.fromEntries(TAGGER_POLICY.tags.map(tag => [tag.output, .5]));
    expect(isTaggerScores(scores)).toBe(true);
    expect(isTaggerScores({ drums: .5 })).toBe(false);
    for (const value of [undefined, NaN, Infinity, -.01, 1.01]) {
      expect(isTaggerScores({ ...scores, drums: value })).toBe(false);
    }
  });
  it.each([[0, []], [3, [0]], [10, [0]], [19.9, [0]], [20, [0, 10]], [35, [0, 10, 20]], [40, [5, 15, 25]], [200, [85, 95, 105]]] as const)(
    'cuts a %s s recording at %j', (seconds, starts) => { expect(taggerWindowStarts(seconds)).toEqual(starts); });
  it('keeps each output\'s best window and only policy outputs', () => {
    const e = new TaggerEvidence();
    expect(e.results()).toBeUndefined();
    e.add({ drums: .2, piano: .9, 'cat:dog': .9 }); e.add({ drums: .7, piano: .1 });
    expect(e.results()).toEqual({ revision: TAGGER_REVISION, windows: 2, scores: { drums: .7, piano: .9 }, windowScores: { drums: [.2, .7], piano: [.9, .1] } });
  });
  it('leaves outputs with missing or invalid windows to the other detectors', () => {
    const e = new TaggerEvidence();
    e.add({ drums: .8, piano: .6, guitar: NaN, trumpet: .7 });
    e.add({ drums: .7, guitar: .9, trumpet: Infinity });
    const result = e.results()!;
    expect(result.scores).toEqual({ drums: .8 });
    expect(result.windowScores).toEqual({ drums: [.8, .7] });
    expect(taggerDecisions(result, 10)!.map(d => d.tag.output)).toEqual(['drums']);
  });
  it('applies thresholds before rounding for display', () => {
    const t = threshold('drums');
    for (const score of [t - .00001, t, t + .00001]) {
      const e = new TaggerEvidence();
      e.add({ drums: score });
      const result = e.results()!;
      expect(result.scores.drums).toBe(score);
      expect(taggerDecisions(result, 10)!.find(d => d.tag.output === 'drums')!.shown).toBe(score >= t);
    }
  });
  it('sanitizes stored results', () => {
    expect(sanitizeTaggerAnalysis({ revision: 'x', windows: 2, scores: { drums: .5, 'cat:dog': .5, piano: 2, guitar: NaN } })).toEqual({ revision: 'x', windows: 2, scores: { drums: .5 } });
    for (const bad of [undefined, null, 'x', { revision: '', windows: 1, scores: {} }, { revision: 'x', windows: 0, scores: {} }, { revision: 'x', windows: 4, scores: {} }, { revision: 'x', windows: 1, scores: [] }])
      expect(sanitizeTaggerAnalysis(bad)).toBeUndefined();
    expect(sanitizeTaggerAnalysis({ revision: 'x', windows: 2, scores: { drums: .5, piano: .4 }, windowScores: { drums: [.5, .1], piano: [.4], guitar: [.1, .1] } }))
      .toEqual({ revision: 'x', windows: 2, scores: { drums: .5, piano: .4 }, windowScores: { drums: [.5, .1] } });
    const saved = sanitizeMusicAnalysis({ ...track(30, { drums: .9 }), tagger: { revision: TAGGER_REVISION, windows: 3, scores: { drums: .9 } } });
    expect(saved?.tagger).toEqual({ revision: TAGGER_REVISION, windows: 3, scores: { drums: .9 } });
  });
  it('maps each threshold to the 0.5 likely cutoff and ignores other revisions', () => {
    const t = threshold('drums');
    const at = taggerDecisions({ revision: TAGGER_REVISION, windows: 1, scores: { drums: t } }, 30)!.find(d => d.tag.output === 'drums')!;
    expect(at).toMatchObject({ shown: true, score: .5 });
    expect(taggerDecisions({ revision: TAGGER_REVISION, windows: 1, scores: { drums: 1 } }, 30)!.find(d => d.tag.output === 'drums')!.score).toBe(1);
    expect(taggerDecisions({ revision: TAGGER_REVISION, windows: 1, scores: { drums: t - 1e-3 } }, 30)!.find(d => d.tag.output === 'drums')!.shown).toBe(false);
    expect(taggerDecisions({ revision: 'older', windows: 1, scores: { drums: 1 } }, 30)).toBeUndefined();
  });
});

describe('trained tagger display', () => {
  const sources = (a: MusicAnalysis) => confidentSoundSummary(a).filter(s => s.dimension === 'source').map(s => s.label).sort();
  it('decides its instruments on recordings of at least 10 s, replacing other models', () => {
    // CLAP-head drums and piano, Jamendo-style guitar: the tagger keeps drums (its own score) and drops piano and guitar.
    const a = track(10, { drums: .99, piano: .01, guitar: .01, bass: threshold('bass') + .01 }, [
      { group: 'source', label: 'drums', score: .9, model: 'Trained head' }, { group: 'source', label: 'piano', score: .9, model: 'Trained head' },
      { group: 'source', label: 'guitar', score: .9, model: 'Trained head' }, { group: 'source', label: 'synthesizer', score: .9, model: 'Trained head' }]);
    const shown = confidentSoundSummary(a);
    expect(sources(a)).toEqual(['bass', 'drums', 'synthesizer']);
    expect(shown.find(s => s.label === 'drums')).toMatchObject({ scores: [{ model: TAGGER_SCORE }], tier: 'likely' });
    expect(shown.find(s => s.label === 'synthesizer')!.scores).toEqual([{ model: 'Trained head score', score: .9 }]);
    // Bass is below 0.70 held out: still shown, marked as a maybe tag with its provenance.
    expect(shown.find(s => s.label === 'bass')).toMatchObject({ maybe: true, scores: [{ model: TAGGER_MAYBE_SCORE }] });
  });
  it('leaves instruments to the other detectors on clips shorter than 10 s', () => {
    expect(sources(track(8, { drums: .01, piano: .99 }, [{ group: 'source', label: 'drums', score: .9, model: 'Trained head' }]))).toEqual(['drums']);
  });
  it('decides its sound-type and effect tags at any length, and leaves other tags alone', () => {
    const a = track(4, { 'cat:percussive': .99, 'cat:dark': .01 }, [
      { group: 'character', label: 'dark', score: .9, model: 'Trained head' }, { group: 'character', label: 'bright', score: .9, model: 'Trained head' },
      { group: 'production', label: 'riser', score: .9, model: 'Trained head' }]);
    expect(confidentSoundSummary(a).map(s => `${s.dimension}:${s.label}`).sort()).toEqual(['character:bright', 'character:percussive', 'effect:riser']);
  });
  it('never overrides what the listener confirmed or rejected', () => {
    const a = track(30, { drums: .01, piano: .99 });
    a.confirmedInstruments = ['drums'];
    expect(sources(a)).toEqual(['drums']);
    const b = track(30, { piano: .99 });
    b.soundReviews = [{ dimension: 'source', labelId: 'piano', decision: 'rejected', scope: 'track', at: 'now', evidenceRunId: 'r' }];
    expect(sources(b)).toEqual([]);
  });
  it('changes nothing for analyses without a current tagger result', () => {
    const a = track(30, {}, [{ group: 'source', label: 'piano', score: .9, model: 'Trained head' }]);
    delete a.tagger;
    expect(sources(a)).toEqual(['piano']);
    a.tagger = { revision: 'older', windows: 1, scores: { piano: 0 } };
    expect(sources(a)).toEqual(['piano']);
  });
  it('does not mistake an absent or invalid output for evidence against a sound', () => {
    for (const score of [undefined, NaN, Infinity, -1, 2]) {
      const a = track(10, { drums: .9, ...(score === undefined ? {} : { piano: score }) }, [
        { group: 'source', label: 'piano', score: .9, model: 'Trained head' },
      ]);
      expect(sources(a)).toEqual(['drums', 'piano']);
    }
  });
});

describe('trained tagger long-recording rules', () => {
  const tagOf = (output: string) => TAGGER_POLICY.tags.find(t => t.output === output)!;
  /** A 30 s recording scored on three windows; per-window scores given, the stored best is their maximum. */
  const long = (perWindow: Record<string, number[]>, djTags: NonNullable<MusicAnalysis['soundProfile']>['djTags'] = []): MusicAnalysis => ({
    ...track(30, Object.fromEntries(Object.entries(perWindow).map(([k, v]) => [k, Math.max(...v)])), djTags),
    tagger: { revision: TAGGER_REVISION, windows: 3, scores: Object.fromEntries(Object.entries(perWindow).map(([k, v]) => [k, Math.max(...v)])), windowScores: perWindow },
  });
  const sources = (a: MusicAnalysis) => confidentSoundSummary(a).filter(s => s.dimension === 'source').map(s => s.label).sort();
  const withRule = <T,>(output: string, rule: TaggerTag['long'], run: () => T): T => {
    const tag = tagOf(output), saved = tag.long;
    tag.long = rule;
    try { return run(); } finally { tag.long = saved; }
  };
  it('installs the rules picked on the full-song tuning set', () => {
    expect(Object.fromEntries(TAGGER_POLICY.tags.filter(t => t.long).map(t => [t.output, t.long]))).toEqual({
      drums: { rule: 'max', threshold: .5757 }, trumpet: { rule: 'max' }, piano: { rule: 'detectors' }, guitar: { rule: 'detectors' },
      cymbals: { rule: 'detectors' }, violin: { rule: 'detectors' }, saxophone: { rule: 'detectors' }, bass: { rule: 'detectors' },
      synthesizer: { rule: 'max' }, 'cat:percussion': { rule: 'detectors' }, 'cat:animal sound': { rule: 'detectors' },
      'cat:glockenspiel': { rule: 'detectors' }, 'cat:whistle': { rule: 'detectors' }, 'cat:tambourine': { rule: 'detectors' },
      'cat:vocal scream': { rule: 'detectors' }, 'cat:environmental sound': { rule: 'detectors', afterSeconds: 30 },
      'cat:foley': { rule: 'detectors', afterSeconds: 30 }, 'cat:turntable': { rule: 'detectors', afterSeconds: 30 },
      'cat:finger snap': { rule: 'detectors', afterSeconds: 30 }, 'cat:water ambience': { rule: 'detectors', afterSeconds: 30 },
      'cat:bell': { rule: 'detectors' }, 'cat:fm synth': { rule: 'detectors' } });
    for (const tag of TAGGER_POLICY.tags.filter(t => t.long?.threshold !== undefined)) expect(tag.long!.threshold).toBeGreaterThan(tag.threshold);
  });
  it('needs the higher full-song drums threshold on long recordings only', () => {
    const between = (threshold('drums') + .5757) / 2;
    expect(sources(long({ drums: [between, .1, .1] }))).toEqual([]);
    expect(sources(long({ drums: [.6, .1, .1] }))).toEqual(['drums']);
    expect(taggerDecisions(long({ drums: [.5757, .1, .1] }).tagger, 30)!.find(d => d.tag.output === 'drums')).toMatchObject({ shown: true, score: .5 });
    // A single 10 s window keeps the clip threshold.
    expect(sources(track(10, { drums: between }))).toEqual(['drums']);
  });
  it('leaves fallback instruments to the existing detectors on long recordings, and keeps the tagger on 10 s clips', () => {
    const others = [{ group: 'source' as const, label: 'piano', score: .9, model: 'Trained head' as const }];
    expect(sources(long({ piano: [.01, .01, .01], guitar: [.99, .99, .99] }, others))).toEqual(['piano']);
    expect(taggerDecisions(long({ piano: [.99, .99, .99] }).tagger, 30)!.map(d => d.tag.output)).not.toContain('piano');
    expect(sources(track(10, { piano: .01, guitar: .99 }, others))).toEqual(['guitar']);
  });
  it.each(['cat:environmental sound', 'cat:foley', 'cat:turntable', 'cat:finger snap', 'cat:water ambience'])(
    'keeps the tagger deciding %s up to 30 s, as the held-out scorer did, and defers on longer recordings', output => {
      const at = (duration: number, windows: number) => taggerDecisions({ revision: TAGGER_REVISION, windows, scores: { [output]: threshold(output) } }, duration)!
        .find(d => d.tag.output === output);
      expect(at(8, 1)).toMatchObject({ shown: true, score: .5 });
      expect(at(25, 2)).toMatchObject({ shown: true, score: .5 });
      expect(at(30, 3)).toMatchObject({ shown: true, score: .5 });
      expect(at(31, 3)).toBeUndefined();
      expect(at(240, 3)).toBeUndefined();
    });
  it('can require several windows, the mean, or agreement with the existing detectors', () => {
    const t = threshold('drums');
    const oneWindow = long({ drums: [.99, t - .01, 0] }), twoWindows = long({ drums: [.99, t + .01, 0] });
    withRule('drums', { rule: 'windows', windows: 2 }, () => {
      expect(sources(oneWindow)).toEqual([]); expect(sources(twoWindows)).toEqual(['drums']);
      // Without per-window scores the existing detectors decide.
      const bare = long({ drums: [.99, .99, .99] }); delete bare.tagger!.windowScores;
      expect(taggerDecisions(bare.tagger, 30)!.map(d => d.tag.output)).not.toContain('drums');
    });
    withRule('drums', { rule: 'mean', threshold: .5 }, () => {
      expect(sources(long({ drums: [.99, .3, .3] }))).toEqual(['drums']);
      expect(sources(long({ drums: [.99, .2, .2] }))).toEqual([]);
    });
    withRule('drums', { rule: 'agree' }, () => {
      expect(sources(long({ drums: [.99, .1, .1] }))).toEqual([]);
      expect(confidentSoundSummary(long({ drums: [.99, .1, .1] }, [{ group: 'source', label: 'drums', score: .9, model: 'Trained head' }]))
        .find(s => s.label === 'drums')).toMatchObject({ scores: [{ model: TAGGER_SCORE }] });
      expect(sources(long({ drums: [.1, .1, .1] }, [{ group: 'source', label: 'drums', score: .9, model: 'Trained head' }]))).toEqual([]);
    });
  });
});

describe('trained tagger pass', () => {
  async function run(duration: number, failTagger = false, tagger = true) {
    const { analyzeDecodedMusic } = await import('./analyzeDecodedMusic');
    const reads: [number, number, number][] = [], taggerInputs: number[] = [];
    const decoder = { durationSeconds: duration, close() {}, read: async (start: number, seconds: number, rate: number) => {
      reads.push([start, seconds, rate]);
      return new Float32Array(Math.round(Math.max(0, Math.min(seconds, duration - start)) * rate)).fill(.1);
    } };
    const request = async <T,>(message: Record<string, unknown>): Promise<T> => {
      if (message.kind === 'tagger') {
        taggerInputs.push((message.samples as Float32Array).length);
        if (failTagger) throw new Error('Model unavailable');
        return { drums: [.3, .4, .5][taggerInputs.length - 1], 'cat:percussive': .1 } as T;
      }
      if (message.kind === 'rhythm' || message.kind === 'tonal') return { version: 2, durationSeconds: duration, analyzedSeconds: Math.min(60, duration), instruments: [], notes: [] } as T;
      if (message.kind === 'instruments') return { scores: { piano: .95 }, musicScore: .9 } as T;
      if (message.kind === 'jamendo') return { synthesizer: .7 } as T;
      return [{ group: 'source', label: 'piano', score: .6 }] as T;
    };
    const result = await analyzeDecodedMusic(decoder, request, { mode: 'full', tagger });
    // The sound description (timbre.ts) also reads 32 kHz audio, last of all; leave its excerpts out.
    const { timbreExcerpts } = await import('./timbre');
    const tagged = reads.filter(r => r[2] === 32000);
    return { result, reads: tagged.slice(0, tagged.length - timbreExcerpts(duration).length), taggerInputs };
  }
  it('scores the middle 30 s of a song as three padded 32 kHz windows and keeps the best', async () => {
    const { result, reads, taggerInputs } = await run(65);
    expect(reads.map(r => r[0])).toEqual([17.5, 27.5, 37.5]);
    expect(taggerInputs).toEqual([320000, 320000, 320000]);
    expect(result.tagger).toEqual({ revision: TAGGER_REVISION, windows: 3, scores: { drums: .5, 'cat:percussive': .1 },
      windowScores: { drums: [.3, .4, .5], 'cat:percussive': [.1, .1, .1] },
      intervals: [{ start: 17.5, end: 27.5 }, { start: 27.5, end: 37.5 }, { start: 37.5, end: 47.5 }] });
  });
  it('pads a short clip to one 10 s window', async () => {
    const { result, reads, taggerInputs } = await run(4);
    expect(reads).toEqual([[0, 4, 32000]]);
    expect(taggerInputs).toEqual([320000]);
    expect(result.tagger?.windows).toBe(1);
    expect(result.tagger).toMatchObject({ intervals: [{ start: 0, end: 4 }] });
  });
  it('leaves every tag to the other detectors when the tagger fails', async () => {
    const { result } = await run(30, true);
    expect(result.tagger).toBeUndefined();
    expect(result.notes).toContain(TAGGER_UNAVAILABLE);
  });
  it('does not run unless asked', async () => {
    const { result, taggerInputs } = await run(30, false, false);
    expect(taggerInputs).toEqual([]);
    expect(result.tagger).toBeUndefined();
  });
});

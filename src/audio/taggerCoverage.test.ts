import { describe, expect, it } from 'vitest';
import { confidentSoundSummary, FULL_MIX_JAMENDO_SCORE } from './confidentSoundSummary';
import { createRecognition, recordEvidence } from './recognition';
import { sanitizeMusicAnalysis, type MusicAnalysis } from './musicTypes';
import { TAGGER_REVISION } from './tagger';
import { DjTagEvidence, selectDjTags } from './djTags';
import { mergeDjTags } from './djClassification';
import { FULL_MIX_REVISION, FullMixEvidence, type FullMixModel } from './fullMixHeads';
import { NATIVE_WINDOW_EVIDENCE_LIMIT, nativeScoreOutside, sanitizeNativeWindowEvidence } from './nativeWindowEvidence';
import { DescriptionAccumulator, type DescriptionScore } from './profileDescriptions';
import { combineSoundModels } from './ensemble';

type Interval = { start: number; end: number };
const middle = [{ start: 75, end: 85 }, { start: 85, end: 95 }, { start: 95, end: 105 }];
function audio(durationSeconds = 180, intervals: Interval[] | undefined = middle, windows = 3): MusicAnalysis {
  return {
    version: 2, durationSeconds, analyzedSeconds: Math.min(durationSeconds, 60), instruments: [], notes: [],
    soundProfile: { version: 1, character: [], roles: [], models: [], disagreement: false, djTags: [] },
    tagger: { revision: TAGGER_REVISION, windows, scores: { 'cat:rain ambience': 0, piano: 0, drums: 0, cymbals: 0 },
      ...(intervals ? { intervals } : {}) },
  };
}
function native(a: MusicAnalysis, label: string, segments?: Interval[], group: 'source' | 'production' = 'production') {
  if(segments?.length){
    const evidence=new DjTagEvidence();
    for(const {start,end} of segments)evidence.add([{group,label,score:.9,model:'Trained head'}],start,end);
    a.soundProfile!.djTags!.push(...evidence.results());
  }else a.soundProfile!.djTags!.push({ group, label, score: .9, model: 'Trained head' });
  return a;
}
const shown = (a: MusicAnalysis) => confidentSoundSummary(a).map(s => `${s.dimension}:${s.label}`);

describe('tagger coverage in the displayed sounds', () => {
  it.each([[0, 10], [170, 180]])('keeps a native effect at %s–%s s outside the tagger excerpt', (start, end) => {
    expect(shown(native(audio(), 'rain ambience', [{ start, end }]))).toEqual(['effect:rain ambience']);
  });
  it.each([[75, 85], [80, 100], [75, 105]])('still suppresses native noise entirely inside %s–%s s of the sampled excerpt', (start, end) => {
    expect(shown(native(audio(), 'rain ambience', [{ start, end }]))).toEqual([]);
  });
  it('keeps a native window that only partly overlaps the sampled excerpt', () => {
    expect(shown(native(audio(), 'rain ambience', [{ start: 70, end: 80 }]))).toEqual(['effect:rain ambience']);
  });
  it('keeps an instrument in the unsampled tail of a 19.9 s clip', () => {
    const a = native(audio(19.9, [{ start: 0, end: 10 }], 1), 'piano', [{ start: 9.9, end: 19.9 }], 'source');
    expect(shown(a)).toEqual(['source:piano']);
  });
  it('uses the score supported outside coverage, without reviving a stronger score from inside it', () => {
    const a = audio(); a.recognition = createRecognition(180, 'full');
    recordEvidence(a.recognition, 'jamendo', { start: 0, end: 10 }, [{ dimension: 'source', labelId: 'drum kit', score: .55 }]);
    recordEvidence(a.recognition, 'jamendo', { start: 75, end: 85 }, [{ dimension: 'source', labelId: 'drum kit', score: .99 }]);
    expect(confidentSoundSummary(a)).toMatchObject([{ label: 'drums', scores: [{ model: FULL_MIX_JAMENDO_SCORE, score: .55 }] }]);
  });
  it('keeps the full-coverage 30 s display policy unchanged', () => {
    const a = native(audio(30, [{ start: 0, end: 10 }, { start: 10, end: 20 }, { start: 20, end: 30 }]), 'rain ambience');
    expect(shown(a)).toEqual([]);
  });
  it('infers the known sampler for legacy current-revision scores', () => {
    const a = native(audio(180, undefined), 'rain ambience', [{ start: 0, end: 10 }]);
    // Omission is intentional: old stored results had no intervals field.
    delete (a.tagger as MusicAnalysis['tagger'] & { intervals?: Interval[] }).intervals;
    expect(shown(a)).toEqual(['effect:rain ambience']);
    a.soundProfile!.djTags = []; native(a, 'rain ambience', [{ start: 80, end: 100 }]);
    expect(shown(a)).toEqual([]);
  });
  it('does not invent legacy coverage when the stored count differs from the known sampler', () => {
    const a = native(audio(180, undefined, 1), 'rain ambience');
    delete (a.tagger as MusicAnalysis['tagger'] & { intervals?: Interval[] }).intervals;
    expect(shown(a)).toEqual(['effect:rain ambience']);
  });
  it('preserves confirmations and rejections on sounds outside the excerpt', () => {
    const a = native(audio(), 'rain ambience', [{ start: 0, end: 10 }]);
    a.soundReviews = [{ dimension: 'effect', labelId: 'rain ambience', decision: 'rejected', scope: 'track', at: 'now', evidenceRunId: 'r' }];
    expect(shown(a)).toEqual([]);
    a.soundReviews.push({ ...a.soundReviews[0], decision: 'confirmed' });
    expect(confidentSoundSummary(a)).toMatchObject([{ label: 'rain ambience', origin: 'confirmed by you' }]);
  });
});

describe('tagger coverage persistence', () => {
  it('preserves actual sampled intervals through graph/cache sanitization', () => {
    const saved = sanitizeMusicAnalysis(audio());
    expect(saved?.tagger).toMatchObject({ intervals: middle });
    expect(shown(native(saved!, 'rain ambience', [{ start: 0, end: 10 }]))).toEqual(['effect:rain ambience']);
  });
  it.each([
    [{ start: 0, end: 10 }],
    [{ start: -1, end: 9 }, { start: 10, end: 20 }, { start: 20, end: 30 }],
    [{ start: 0, end: 10 }, { start: 10, end: 10 }, { start: 20, end: 30 }],
    [{ start: 0, end: 10 }, { start: 10, end: 20 }, { start: 175, end: 185 }],
  ].map(intervals => [intervals]))('discards a tagger result with invalid claimed intervals %j', intervals => {
    expect(sanitizeMusicAnalysis(audio(180, intervals))?.tagger).toBeUndefined();
  });
});

describe('coverage from the real native accumulators', () => {
  function accumulated(hits: [number, number, number][]) {
    const evidence = new DjTagEvidence();
    for (const [start, end, score] of hits) evidence.add([{ group: 'production', label: 'rain ambience', score, model: 'Trained head' }], start, end);
    const a = audio(); a.soundProfile!.djTags = evidence.results();
    return a;
  }
  it('retains the actual .40 outside hit rather than the .99 peak inside the tagger excerpt', () => {
    const a = accumulated([[0, 10, .4], [75, 85, .99]]);
    expect(confidentSoundSummary(a)).toMatchObject([{ label: 'rain ambience', tier: 'possible', scores: [{ model: 'Trained head score', score: .4 }] }]);
  });
  it('keeps a fourth hit outside the first three covered listenable examples', () => {
    const a = accumulated([[75, 85, .6], [85, 95, .7], [95, 105, .8], [170, 180, .9]]);
    expect(confidentSoundSummary(a)).toMatchObject([{ label: 'rain ambience', scores: [{ score: .9 }] }]);
  });
  it('preserves scored-window provenance when saving and loading a real accumulated result', () => {
    const a = sanitizeMusicAnalysis(accumulated([[0, 10, .4], [75, 85, .99]]))!;
    expect(confidentSoundSummary(a).find(s=>s.label==='rain ambience')).toMatchObject({ label: 'rain ambience', tier: 'possible', scores: [{ score: .4 }] });
  });
  it('does not attach a passage score to a stronger unlocalized aggregate while merging tags', () => {
    const passage = accumulated([[0, 10, .4]]).soundProfile!.djTags!;
    const a = native(audio(), 'rain ambience'); a.soundProfile!.djTags![0].score = .99;
    mergeDjTags(a.soundProfile!, passage);
    expect(confidentSoundSummary(a).find(s => s.label === 'rain ambience')).toMatchObject({ tier: 'possible', scores: [{ score: .4 }] });
  });
  it('merges the actual windows of the same detector when the existing peak wins', () => {
    const a = accumulated([[75, 85, .99]]);
    mergeDjTags(a.soundProfile!, accumulated([[0, 10, .4]]).soundProfile!.djTags!);
    const evidence = a.soundProfile!.djTags!.find(t => t.label === 'rain ambience')!.windowEvidence!;
    expect(evidence).toEqual({ windows: [{ start: 75, end: 85, score: .99 }, { start: 0, end: 10, score: .4 }], complete: true });
    expect(confidentSoundSummary(sanitizeMusicAnalysis(a)!).find(s => s.label === 'rain ambience')).toMatchObject({ tier: 'possible', scores: [{ score: .4 }] });
  });
  it('does not borrow an outside window from a different detector that lost the merge', () => {
    const a = accumulated([[75, 85, .9]]), passage = accumulated([[0, 10, .99]]).soundProfile!.djTags!;
    passage[0].model = 'Trained head (maybe)';
    mergeDjTags(a.soundProfile!, passage);
    expect(a.soundProfile!.djTags!.find(t => t.label === 'rain ambience')).toMatchObject({ model: 'Trained head', windowEvidence: { windows: [{ start: 75, end: 85, score: .9 }], complete: true } });
    expect(confidentSoundSummary(a).find(s => s.label === 'rain ambience')).toBeUndefined();
  });
  it('does not treat legacy unscored snippets as a complete list of supporting hits', () => {
    const a = native(audio(), 'rain ambience', middle);
    delete a.soundProfile!.djTags![0].windowEvidence;
    expect(confidentSoundSummary(a)).toEqual([{ dimension: 'effect', label: 'rain ambience', origin: 'model estimate', tier: 'possible', coverageUnknown: true }]);
  });
  it('does not present a legacy aggregate peak as the score of an outside snippet', () => {
    const a = native(audio(), 'rain ambience', [{ start: 0, end: 10 }, { start: 75, end: 85 }]);
    a.soundProfile!.djTags![0].score = .99;
    delete a.soundProfile!.djTags![0].windowEvidence;
    expect(confidentSoundSummary(a)).toEqual([{ dimension: 'effect', label: 'rain ambience', origin: 'model estimate', tier: 'possible', coverageUnknown: true }]);
  });
  it('keeps an unlocalized tested estimate possible when the only known outside score is untested', () => {
    const a = native(audio(), 'rain ambience');
    a.recognition = createRecognition(180, 'full');
    recordEvidence(a.recognition, 'clap', { start: 0, end: 10 }, [{ dimension: 'effect', labelId: 'rain ambience', score: .8 }]);
    expect(confidentSoundSummary(a)).toEqual([{ dimension: 'effect', label: 'rain ambience', origin: 'model estimate', tier: 'possible', coverageUnknown: true }]);
  });
  it('recomputes the existing full-mix aggregation from actual outside probabilities', () => {
    const weights = Array(513).fill(0); weights[512] = 1;
    const model: FullMixModel = { version: 1, revision: FULL_MIX_REVISION!, inputs: { clap: 512, ast: ['drums'], jamendo: [] }, aggregation: { top: 2 },
      heads: [{ label: 'drums', weights, bias: 0, threshold: .5 }] };
    const evidence = new FullMixEvidence(model), clap = [1, ...Array(511).fill(0)];
    evidence.add(0, 10, { ast: { drums: .55 }, jamendo: {}, clap });
    evidence.add(75, 85, { ast: { drums: .99 }, jamendo: {}, clap });
    const a = audio(); a.fullMix = evidence.results(); a.instrumentScan = { complete: true, analyzedSeconds: 180, windows: 35 };
    expect(confidentSoundSummary(a)).toMatchObject([{ label: 'drums', scores: [{ model: 'Full-mix head score', score: .55 }] }]);
    const saved = sanitizeMusicAnalysis(a)!;
    expect(saved.fullMix?.labels[0].windowEvidence).toEqual(a.fullMix!.labels[0].windowEvidence);
    expect(confidentSoundSummary(saved)).toMatchObject([{ label: 'drums', scores: [{ model: 'Full-mix head score', score: .55 }] }]);
  });
  it('bounds accumulated scored windows and marks omitted evidence incomplete', () => {
    const a = accumulated(Array.from({ length: NATIVE_WINDOW_EVIDENCE_LIMIT + 1 }, (_, i) => [i * 5, i * 5 + 10, .9]));
    a.durationSeconds = 900;
    const evidence = a.soundProfile!.djTags![0].windowEvidence!;
    expect(evidence.windows).toHaveLength(NATIVE_WINDOW_EVIDENCE_LIMIT);
    expect(evidence.complete).toBe(false);
    expect(sanitizeMusicAnalysis(a)!.soundProfile!.djTags![0].windowEvidence).toEqual(evidence);
  });
  it('limits imported evidence and strips arbitrary payload without claiming it is complete', () => {
    const evidence = sanitizeNativeWindowEvidence({ complete: true, payload: 'x'.repeat(100000),
      windows: Array.from({ length: NATIVE_WINDOW_EVIDENCE_LIMIT + 1 }, (_, i) => ({ start: i, end: i + 10, score: .9, payload: 'x'.repeat(1000) })) }, 900)!;
    expect(evidence.windows).toHaveLength(NATIVE_WINDOW_EVIDENCE_LIMIT);
    expect(evidence.complete).toBe(false);
    expect(JSON.stringify(evidence).length).toBeLessThan(10000);
  });
  it.each([null, 'mean', [], { top: 0, threshold: .5 }, { top: 2, threshold: 1 }])('rejects malformed stored aggregation metadata without throwing (%j)', aggregation => {
    expect(sanitizeNativeWindowEvidence({ windows: [{ start: 0, end: 10, score: .9 }], complete: true, aggregation }, 180)).toBeUndefined();
  });
  it('does not infer a top-two aggregate from one saved outside window when other windows were omitted', () => {
    expect(nativeScoreOutside({ windows: [{ start: 0, end: 10, score: .9 }], complete: false,
      aggregation: { top: 2, threshold: .5 } }, () => false)).toEqual({ unknown: true });
  });
  it('does not accept an empty complete record as proof that a positive aggregate was fully covered', () => {
    const a = native(audio(), 'rain ambience');
    a.soundProfile!.djTags![0].windowEvidence = { windows: [], complete: true };
    const saved = sanitizeMusicAnalysis(a)!;
    expect(saved.soundProfile!.djTags![0].windowEvidence).toBeUndefined();
    expect(confidentSoundSummary(saved)).toMatchObject([{ label: 'rain ambience', tier: 'possible', coverageUnknown: true }]);
    expect(confidentSoundSummary(a)).toMatchObject([{ label: 'rain ambience', tier: 'possible', coverageUnknown: true }]);
  });
});

describe('fresh profile composition keeps learned-head provenance', () => {
  function composed(hits: [number, number, number][], localized = true) {
    const descriptions = new DescriptionAccumulator(), evidence = new DjTagEvidence();
    for (const [start, end, score] of hits) {
      const rows: DescriptionScore[] = [{ group: 'dj-learned', learnedGroup: 'production', label: 'rain ambience', score, basis: 'head', decision: 'include' }];
      descriptions.add(rows, localized ? { start, end } : undefined);
      evidence.add(selectDjTags(rows), start, end);
    }
    const scores = descriptions.average(), a = audio();
    a.soundProfile = combineSoundModels([], {}, scores, { ast: true, jamendo: true, clap: true });
    mergeDjTags(a.soundProfile, evidence.results(), scores);
    return a;
  }
  it('suppresses a fresh covered-only hit after aggregate profile construction and merging', () => {
    const a = composed([[75, 85, .99]]);
    expect(a.soundProfile!.djTags!.find(t => t.label === 'rain ambience')!.windowEvidence).toEqual({ windows: [{ start: 75, end: 85, score: .99 }], complete: true });
    expect(confidentSoundSummary(a).find(t => t.label === 'rain ambience')).toBeUndefined();
    expect(confidentSoundSummary(sanitizeMusicAnalysis(a)!).find(t => t.label === 'rain ambience')).toBeUndefined();
  });
  it('uses the actual weaker outside hit through the same composition', () => {
    const a = composed([[0, 10, .4], [75, 85, .99]]);
    expect(confidentSoundSummary(a).find(t => t.label === 'rain ambience')).toMatchObject({ tier: 'possible', scores: [{ score: .4 }] });
  });
  it('remains conservative if the aggregate producer never received its intervals', () => {
    const a = composed([[75, 85, .99]], false);
    expect(confidentSoundSummary(a).find(t => t.label === 'rain ambience')).toMatchObject({ tier: 'possible', coverageUnknown: true });
  });
});

describe('cymbal aliases across source and effect dimensions', () => {
  const cymbal = () => native(audio(10, [{ start: 0, end: 10 }], 1), 'cymbal', [{ start: 0, end: 10 }]);
  it('suppresses the native effect alias when the tagger rejects cymbals', () => {
    expect(shown(cymbal())).toEqual([]);
  });
  it('shows one canonical label when both the native and tagger detectors report cymbals', () => {
    const a = cymbal(); a.tagger!.scores.cymbals = 1;
    expect(confidentSoundSummary(a)).toMatchObject([{ dimension: 'source', label: 'cymbals', scores: [{ model: 'Trained tagger score', score: 1 }] }]);
    expect(shown(a)).toEqual(['source:cymbals']);
  });
  it.each(['rejected', 'uncertain'] as const)('respects a listener %s decision on the effect alias', decision => {
    const a = cymbal(); a.tagger!.scores.cymbals = 1;
    a.soundReviews = [{ dimension: 'effect', labelId: 'cymbal', decision, scope: 'track', at: 'now', evidenceRunId: 'r' }];
    expect(shown(a)).toEqual([]);
  });
  it('keeps a confirmed effect alias without adding a duplicate source estimate', () => {
    const a = cymbal(); a.tagger!.scores.cymbals = 1;
    a.soundReviews = [{ dimension: 'effect', labelId: 'cymbal', decision: 'confirmed', scope: 'track', at: 'now', evidenceRunId: 'r' }];
    expect(confidentSoundSummary(a)).toEqual([{ dimension: 'effect', label: 'cymbal', origin: 'confirmed by you' }]);
  });
  it.each([true, false])('keeps source-alias rejection authoritative on a long recording (tagger present: %s)', hasTagger => {
    const a = native(audio(), 'cymbal', [{ start: 0, end: 10 }]);
    if (!hasTagger) delete a.tagger;
    a.soundReviews = [{ dimension: 'source', labelId: 'cymbals', decision: 'rejected', scope: 'track', at: 'now', evidenceRunId: 'r' }];
    expect(shown(a)).toEqual([]);
  });
});

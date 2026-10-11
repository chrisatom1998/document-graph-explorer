import { afterEach, describe, expect, it } from 'vitest';
import { confidentSoundSummary } from './confidentSoundSummary';
import {
  DASHENG_MAYBE_SCORE, DASHENG_MIN_SAMPLES, DASHENG_POLICY, DASHENG_REVISION, dashengBlockedReason, dashengDecisions,
  dashengModelUrl, dashengWindow, setDashengDisplayEnabled,
} from './dashengAddon';
import { dashengPass } from './dashengPass';
import { sanitizeMusicAnalysis, type MusicAnalysis } from './musicTypes';
import { TAGGER_REVISION, type TaggerAnalysis } from './tagger';
import catalog from './djCatalog.json';

const DESKTOP = { deviceMemory: 8, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' };
const intervals = [{ start: 0, end: 10 }];
const tagger = (): TaggerAnalysis => ({ revision: TAGGER_REVISION, windows: 1, scores: { drums: 0 }, intervals });
const dasheng = (tom: number): TaggerAnalysis => ({ revision: DASHENG_REVISION, windows: 1,
  scores: Object.fromEntries(DASHENG_POLICY.tags.map(t => [t.output, t.output === 'tom' ? tom : 0])), intervals });
function audio(tom: number): MusicAnalysis {
  return {
    version: 2, durationSeconds: 10, analyzedSeconds: 10, instruments: [], notes: [],
    soundProfile: { version: 1, character: [], roles: [], models: [], disagreement: false,
      djTags: [{ group: 'production', label: 'conga', score: .9, model: 'Trained head' }] },
    tagger: tagger(), dasheng: dasheng(tom),
  };
}
const shown = (a: MusicAnalysis) => confidentSoundSummary(a).map(s => `${s.dimension}:${s.label}`).sort();
afterEach(() => setDashengDisplayEnabled(false));

describe('desktop Dasheng add-on policy', () => {
  it('names tags the catalog knows, with probability thresholds, pinned to one model file', () => {
    const labels = new Set(catalog.categories.map(c => c.label));
    expect(DASHENG_POLICY.tags.length).toBeGreaterThan(0);
    for (const tag of DASHENG_POLICY.tags) {
      expect(labels.has(tag.label)).toBe(true);
      expect(tag.threshold).toBeGreaterThan(0);
      expect(tag.threshold).toBeLessThan(1);
    }
    expect(DASHENG_POLICY.modelSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(dashengModelUrl('model.onnx')).toMatch(/^https:\/\/huggingface\.co\/cmjatom\/[^/]+\/resolve\/[^/]+\/model\.onnx$/);
  });
  it('is for desktops only', () => {
    expect(dashengBlockedReason(DESKTOP)).toBeNull();
    expect(dashengBlockedReason({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile' })).toMatch(/Desktop only/);
    expect(dashengBlockedReason({ ...DESKTOP, touchTablet: true })).toMatch(/Desktop only/);
    expect(dashengBlockedReason({ ...DESKTOP, deviceMemory: 4 })).toMatch(/8 GB/);
    expect(dashengBlockedReason({ ...DESKTOP, connection: { saveData: true } })).toMatch(/Data saver/);
  });
  it('scores each window unpadded, only filling a clip up to the 0.25 s minimum', () => {
    expect(dashengWindow(new Float32Array(48000)).length).toBe(48000);
    expect(dashengWindow(new Float32Array(10)).length).toBe(DASHENG_MIN_SAMPLES);
    expect(dashengWindow(new Float32Array(200000)).length).toBe(160000);
  });
});

describe('desktop Dasheng add-on in the displayed sounds', () => {
  it('changes nothing while it is turned off', () => {
    expect(dashengDecisions(dasheng(.9), tagger(), 10)).toBeUndefined();
    expect(shown(audio(.9))).toEqual(['effect:conga']);
  });
  it('decides its tags inside the tagger windows once turned on', () => {
    setDashengDisplayEnabled(true);
    // Its conga score is 0, so the native conga inside the window goes; its tom passes and shows as a maybe tag.
    const sounds = confidentSoundSummary(audio(.9));
    expect(sounds.map(s => `${s.dimension}:${s.label}`)).toEqual(['effect:tom']);
    expect(sounds[0]).toMatchObject({ maybe: true, scores: [{ model: DASHENG_MAYBE_SCORE }] });
  });
  it('needs the same windows as the tagger', () => {
    setDashengDisplayEnabled(true);
    const a = audio(.9); a.dasheng!.windows = 2;
    expect(dashengDecisions(a.dasheng, a.tagger, 10)).toBeUndefined();
  });
  it('survives saving and loading, and drops scores from another policy', () => {
    expect(sanitizeMusicAnalysis(audio(.9))?.dasheng).toMatchObject({ revision: DASHENG_REVISION, windows: 1 });
    const foreign = audio(.9); foreign.dasheng!.scores = { piano: .5 };
    expect(sanitizeMusicAnalysis(foreign)?.dasheng?.scores).toEqual({});
  });
});

describe('desktop Dasheng add-on pass', () => {
  it('reads the tagger windows at 16 kHz and keeps every policy score', async () => {
    const reads: [number, number, number][] = [];
    const result = await dashengPass(25, async (start, seconds, rate) => { reads.push([start, seconds, rate]); return new Float32Array(Math.round(seconds * rate)); },
      async () => Object.fromEntries(DASHENG_POLICY.tags.map(t => [t.output, .2])));
    expect(reads).toEqual([[0, 10, 16000], [10, 10, 16000]]);
    expect(result).toMatchObject({ revision: DASHENG_REVISION, windows: 2, intervals: [{ start: 0, end: 10 }, { start: 10, end: 20 }] });
  });
  it('fails as a whole when a window cannot be decoded', async () => {
    await expect(dashengPass(10, async () => new Float32Array(10), async () => ({}))).rejects.toThrow(/fully decoded/);
  });
});

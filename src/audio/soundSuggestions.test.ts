import { describe, expect, it } from 'vitest';
import { primaryInstrument, soundSuggestions } from './soundSuggestions';
import { sanitizeMusicAnalysis } from './musicTypes';
const prompt = (label: string | null, cosine: number) => ({ label, vector: [cosine, Math.sqrt(1 - cosine ** 2)] });
describe('audio-description instrument fallback', () => {
  it('automatically names the closest class and preserves its uncertainty separately', () => {
    const predictions = soundSuggestions([1, 0], [prompt('synthesizer', 0.391), prompt('trumpet', 0.376)]);
    const result = primaryInstrument([predictions]);
    expect(result).toMatchObject({ label: 'synthesizer', score: expect.closeTo(0.391), margin: expect.closeTo(0.015) });
    expect(sanitizeMusicAnalysis({ version: 2, instruments: [], durationSeconds: 7, analyzedSeconds: 7, instrumentPrediction: result })?.instrumentPrediction).toEqual(result);
  });
  it('requires a strict majority of passages, including passages with no valid prediction', () => {
    const synth = soundSuggestions([1, 0], [prompt('synthesizer', 0.4)]);
    const piano = soundSuggestions([1, 0], [prompt('piano', 0.4)]);
    expect(primaryInstrument([synth, piano])).toBeUndefined();
    expect(primaryInstrument([synth, [], []])).toBeUndefined();
    expect(primaryInstrument([synth, synth, piano])?.label).toBe('synthesizer');
    expect(primaryInstrument([])).toBeUndefined();
  });
  it('retains an ambiguous synth candidate alongside an acoustic sound, without duplicate synth labels', () => {
    expect(soundSuggestions([1, 0], [prompt('trumpet', 0.445), prompt('synthesizer', 0.341), prompt('synthesizer', 0.32)]).map(x => x.label)).toEqual(['trumpet', 'synthesizer']);
  });
  it('does not force silence, noise, weak matches, or unrelated instruments into a synth prediction', () => {
    expect(soundSuggestions([1, 0], [prompt(null, 0.6), prompt('synthesizer', 0.5)])).toEqual([]);
    expect(soundSuggestions([1, 0], [prompt('synthesizer', 0.29)])).toEqual([]);
    expect(soundSuggestions([1, 0], [prompt('trumpet', 0.65), prompt('synthesizer', 0.34)]).map(x => x.label)).toEqual(['trumpet']);
    expect(soundSuggestions([0, 0], [prompt('synthesizer', 0.5)])).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { musicNameHints } from './nameHints';
const hints = (path: string) => musicNameHints({ path, title: 'Display title' });
describe('musical name tags', () => {
  it('uses bare sample-pack notes and tempo without inventing a major/minor key', () => {
    const result=hints('SHADOW_UK1_Vocal_AY_D_140.wav');
    expect(result.pitch).toMatchObject({value:2,source:'file name'});
    expect(result.tempo?.value).toBe(140);
    expect(result.key).toBeUndefined();
    expect(hints('Vocal_Ab_120.wav').pitch?.value).toBe(8);
    expect(hints('Plan B.wav').pitch).toBeUndefined();
    expect(hints('Vocal_C_D_140.wav').pitch).toBeUndefined();
  });
  it.each([
    ['Bleacher_D#m_130.wav', 'D♯ minor', 3],
    ['Closer_D♯m_130.wav', 'D♯ minor', 3],
    ['clip_Eb_minor.wav', 'E♭ minor', 3],
    ['clip_EB_MINOR.wav', 'E♭ minor', 3],
    ['clip_Em_130.wav', 'E minor', 4],
    ['D#minor/clip.wav', 'D♯ minor', 3],
  ])('preserves key spelling from %s while retaining pitch identity', (path, displayName, tonic) => {
    expect(hints(path).key).toMatchObject({ displayName, value: { tonic, mode: 'minor' } });
  });
  it.each([
    ['Action_Dm_140.wav', 2, 'minor', 140],
    ['Bleacher_D#m_130.wav', 3, 'minor', 130],
    ['Fight_Gm_140.wav', 7, 'minor', 140],
    ['clip_Eb_MINOR_130bpm.wav', 3, 'minor', 130],
    ['clip_C#_major_BPM_120.wav', 1, 'major', 120],
  ])('reads explicit tags in %s', (path, tonic, mode, bpm) => {
    expect(hints(path).key?.value).toEqual({ tonic, mode });
    expect(hints(path).pitch?.value).toBe(tonic);
    expect(hints(path).tempo?.value).toBe(bpm);
  });
  it('prefers per-file tags, then nearest folders independently for each feature', () => {
    const result = hints('Samples/90bpm/Synths/D minor/130bpm/clip_Gm_140.wav');
    expect(result.tempo).toMatchObject({ value: 140, source: 'file name' });
    expect(result.key?.value.tonic).toBe(7);
    expect(result.instruments).toMatchObject({ value: ['synthesizer'], source: 'folder name', name: 'Synths' });
    expect(hints('Samples/90bpm/130bpm/clip.wav').tempo?.value).toBe(130);
  });
  it('recognizes pitched one shots without inventing a key', () => {
    expect(hints('Synth/C#3.wav')).toMatchObject({ pitch: { value: 1 }, instruments: { value: ['synthesizer'] } });
    expect(hints('Synth/C#3.wav').key).toBeUndefined();
  });
  it('does not turn genre, role, arbitrary numbers or ambiguous tags into confident features', () => {
    expect(hints('Shadow UK Bass Vol 1 Samples/Melodic/clip_140.wav')).toEqual({});
    expect(hints('clip_2026.wav')).toEqual({});
    expect(hints('clip_Dm_Em_120bpm_140bpm.wav').key).toBeUndefined();
    expect(hints('clip_Dm_Em_120bpm_140bpm.wav').tempo).toBeUndefined();
  });
  it('supports Windows paths and specific instrument names', () => {
    expect(hints('Library\\Electric piano\\D♭minor\\clip.wav')).toMatchObject({ key: { value: { tonic: 1, mode: 'minor' } }, instruments: { value: ['electric piano'] } });
    expect(hints('synthesizer_trumpet.wav').instruments?.value).toEqual(expect.arrayContaining(['synthesizer', 'trumpet']));
  });
});

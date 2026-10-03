import { describe, expect, it } from 'vitest';
import fixtures from './temporalFeatures.fixtures.json';
import { extractTemporalFeatures, TEMPORAL_FEATURE_NAMES } from './temporalFeatures';
describe('frozen browser temporal features', () => {
  it('preserves exact feature order and Python parity for short, quiet, mixed and transient PCM', () => {
    expect(TEMPORAL_FEATURE_NAMES).toEqual(fixtures.featureNames);
    for (const item of fixtures.cases) {
      const bytes = Buffer.from(item.pcmBase64, 'base64');
      const samples = new Float32Array(item.samples);
      for (let i = 0; i < samples.length; i++) samples[i] = bytes.readFloatLE(i * 4);
      const actual = extractTemporalFeatures(samples);
      const error = Math.max(...actual.map((v, i) => Math.abs(v - item.expected[i])));
      expect(error, item.name).toBeLessThan(1e-7);
    }
  });
  it('rejects missing, nonfinite, oversized or wrong-rate PCM', () => {
    for (const samples of [new Float32Array(), Float32Array.of(NaN), new Float32Array(160001)]) expect(() => extractTemporalFeatures(samples)).toThrow();
    expect(() => extractTemporalFeatures(Float32Array.of(0), 48000)).toThrow();
  });
});

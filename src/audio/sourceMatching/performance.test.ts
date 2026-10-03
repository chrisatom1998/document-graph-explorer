import { expect, it } from 'vitest';
import { fingerprint } from './fingerprint';
import { matchSource, type Candidate } from './matching';

it('handles the maximum 20-second query with bounded coarse/refined alignment (synthetic only)', () => {
  const signal = Float32Array.from({ length: 8192 * 20 }, (_, i) => 0.2 * Math.sin(2 * Math.PI * (256 + 64 * Math.floor(i / 8192) % 192) * i / 8192));
  const f = fingerprint({ sampleRate: 8192, channels: [signal] });
  // Candidate provenance is synthetic and cannot produce brand/preset truth.
  const candidate: Candidate = { fingerprint: f, reference: { trust: 'synthetic', record: {
    id: 'max-length-control', familyId: 'max-length-control', kind: 'synthetic-control',
    asset: { uri: 'test-fixture://generated', sha256: 'a'.repeat(64) }, rights: { basis: 'test generated control', localAnalysisAllowed: true }, identity: null,
    render: { midiNote: 60, velocity: 85, heldSeconds: 20, releaseSeconds: 0, sampleRate: 8192, channels: 1, synthSettings: 'test oscillator', effects: { mode: 'bypassed', settings: 'none' } },
    provenance: { method: 'synthetic-generator', evidenceUri: 'test-fixture://generated', artifactSha256: 'a'.repeat(64), reviewer: 'test', reviewedAt: '2026-10-03T00:00:00Z' },
  } } };
  const result = matchSource(f, [candidate]);
  expect(result.ranked[0].score).toBeCloseTo(1);
  expect(result.ranked[0].alignment.queryCoverage).toBe(1);
  expect(result.decision).toBe('resemblance');
});

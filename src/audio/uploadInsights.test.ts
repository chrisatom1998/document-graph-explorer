import { expect, it } from 'vitest';
import type { DocNode } from '../model/types';
import { uploadInsight } from './uploadInsights';
const node: DocNode = { id: 'one', title: 'Loop 140BPM Dmin', kind: 'document', fileType: 'audio', topics: [], entities: [], keywords: [], wordCount: 0, cluster: 0, degree: 0, status: 'ok', audio: { version: 2, durationSeconds: 4, analyzedSeconds: 4, instruments: [], notes: [], confirmedInstruments: ['piano'], tempo: { bpm: 70, confidence: .9 } } };
it('separates confirmed labels from filename discrepancies', () => {
  const result = uploadInsight(node);
  expect(result.summary).toContain('Confirmed: piano');
  expect(result.summary).toContain('70.0 BPM');
  expect(result.reasons).toContain('Filename tempo and measured tempo differ by half/double time.');
  expect(result.summary).toContain('key unconfirmed');
});
it('does not present a preview tempo as a finished measurement or group', () => {
  const result = uploadInsight({ ...node, audio: { ...node.audio!, stage: 'preview' } });
  expect(result.summary).toContain('tempo unconfirmed');
  expect(result.groups.some(g => g.includes('BPM'))).toBe(false);
});

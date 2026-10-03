import { expect, it } from 'vitest';
import { FUSION_LABELS, type FusionAnalysis } from './fusion';
import { fusionPresentation } from './fusionPresentation';
import { FUSION_INPUT_TIER } from './fusionRelease';
import { sanitizeMusicAnalysis } from './musicTypes';
import { sanitizeSoundReviews } from './recognition';
const release = { modelSha256: 'a'.repeat(64), policySha256: 'b'.repeat(64), scorerSha256: 'c'.repeat(64), modelFileSha256: 'd'.repeat(64), receiptSha256: 'e'.repeat(64), runtimeSha256: 'f'.repeat(64), inputTier: FUSION_INPUT_TIER };
const fixture = (): FusionAnalysis => ({ version: 1, scope: 'window', validation: 'policy-qualified', release, identity: release, planned: 1, counts: { complete: 1, failed: 0, unsupported: 0, empty: 0 }, omittedWindows: 0, windows: [{ start: 0, end: 10, status: 'complete', decisions: FUSION_LABELS.map((label, i) => ({ label, state: i === 0 ? 'positive' : 'uncertain', source: 'learned-head', headProbability: .5, decisionProbability: .5, eligible: true, positiveGroups: 3, negativeGroups: 4 })) }] });
it('shows exactly policy positives only in a complete qualified tier', () => {
 expect(fusionPresentation(fixture(), 10, 'full', release)?.positive).toEqual(['accordion']);
 expect(fusionPresentation(fixture(), 10, 'fast', release)?.qualified).toBe(false);
 expect(fusionPresentation(fixture(), 11, 'full', release)?.qualified).toBe(false);
});
it.each(['modelSha256','policySha256','scorerSha256'] as const)('rejects raw %s drift even with copied public release metadata', key => {
 const f = fixture(); f.identity = { ...f.identity, [key]: '0'.repeat(64) };
 expect(fusionPresentation(f, 10, 'full', release)?.qualified).toBe(false);
});
it('keeps imported predictions unqualified even if release metadata matches', () => {
 const f = { ...fixture(), imported: true as const };
 expect(fusionPresentation(f, 10, 'full', release)?.qualified).toBe(false);
 const audio = sanitizeMusicAnalysis({version:2,durationSeconds:10,analyzedSeconds:10,instruments:[],notes:[],fusion:fixture(),classifierConfiguration:'copied'});
 expect(audio?.fusion?.validation).toBe('unvalidated'); expect(audio?.fusion?.imported).toBe(true); expect(audio?.classifierConfiguration).toBeUndefined();
});
it('accepts human review for all twenty exact taxonomy labels', () => {
 const reviews = FUSION_LABELS.map(labelId => ({ labelId,dimension:'source',decision:'confirmed',scope:'track',at:'2026-10-03T00:00:00Z',evidenceRunId:'test' }));
 expect(sanitizeSoundReviews(reviews).map(r=>r.labelId)).toEqual([...FUSION_LABELS]);
});

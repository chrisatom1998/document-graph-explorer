import { expect, it } from 'vitest';
import { FUSION_LABELS, unavailableFusionDecisions, type FusionAnalysis, type FusionDecision, type FusionStatus } from './fusion';
import { fusionPresentation } from './fusionPresentation';
import { FUSION_INPUT_TIER } from './fusionRelease';
import { sanitizeMusicAnalysis } from './musicTypes';
import { sanitizeSoundReviews } from './recognition';
const release = { modelSha256: 'a'.repeat(64), policySha256: 'b'.repeat(64), scorerSha256: 'c'.repeat(64), modelFileSha256: 'd'.repeat(64), receiptSha256: 'e'.repeat(64), runtimeSha256: 'f'.repeat(64), inputTier: FUSION_INPUT_TIER };
/** Decisions for one complete window: every label in `positive` accepted, the rest uncertain. */
const decisions = (positive: string[]): FusionDecision[] => FUSION_LABELS.map(label => ({
  label, state: positive.includes(label) ? 'positive' : 'uncertain', source: 'learned-head',
  headProbability: .5, decisionProbability: .5, eligible: true, positiveGroups: 3, negativeGroups: 4 }));
const window = (start: number, end: number, status: FusionStatus, positive: string[] = []) =>
  ({ start, end, status, decisions: status === 'complete' ? decisions(positive) : unavailableFusionDecisions() });
const analysis = (windows: ReturnType<typeof window>[], omitted = 0): FusionAnalysis => {
  const counts = { complete: 0, failed: 0, unsupported: 0, empty: 0 };
  for (const w of windows) counts[w.status]++;
  counts.complete += omitted;   // an omitted window was still processed
  return { version: 1, scope: 'window', validation: 'policy-qualified', release, identity: release,
    planned: windows.length + omitted, counts, omittedWindows: omitted, windows };
};
const fixture = (): FusionAnalysis => analysis([window(0, 10, 'complete', ['accordion'])]);

it('shows exactly the policy positives of a single qualified window', () => {
  expect(fusionPresentation(fixture(), 10, 'full', release)?.positive).toEqual(['accordion']);
  expect(fusionPresentation(fixture(), 10, 'full', release)?.qualified).toBe(true);
});
it('stays unqualified outside full analysis or below the policy minimum duration', () => {
  expect(fusionPresentation(fixture(), 10, 'fast', release)?.qualified).toBe(false);
  // 2.048s is policy.inputSupport.minimumSeconds; shorter input is not scored at all.
  expect(fusionPresentation(analysis([window(0, 2, 'complete')]), 2, 'full', release)?.qualified).toBe(false);
});
it('scores a recording longer than one window and keeps every window it heard', () => {
  // The old rule required exactly one 0-10s window, so no real song ever qualified.
  const long = analysis([window(0, 10, 'complete', ['drums']), window(10, 20, 'complete', ['guitar']), window(20, 28, 'complete', ['drums', 'voice'])]);
  const view = fusionPresentation(long, 28, 'full', release);
  expect(view?.qualified).toBe(true);
  expect([...(view?.positive ?? [])].sort()).toEqual(['drums', 'guitar', 'voice']);
});
it('keeps an instrument that plays in only one window of many', () => {
  const intermittent = analysis([window(0, 10, 'complete', []), window(10, 20, 'complete', ['saxophone']), window(20, 30, 'complete', [])]);
  expect(fusionPresentation(intermittent, 30, 'full', release)?.positive).toEqual(['saxophone']);
});
it('ignores a silent window but refuses a recording that was not fully scored', () => {
  const silentTail = analysis([window(0, 10, 'complete', ['piano']), window(10, 14, 'empty')]);
  expect(fusionPresentation(silentTail, 14, 'full', release)?.qualified).toBe(true);
  expect(fusionPresentation(silentTail, 14, 'full', release)?.positive).toEqual(['piano']);
  for (const bad of ['failed', 'unsupported'] as const) {
    const partial = analysis([window(0, 10, 'complete', ['piano']), window(10, 20, bad)]);
    expect(fusionPresentation(partial, 20, 'full', release)?.qualified).toBe(false);
    expect(fusionPresentation(partial, 20, 'full', release)?.positive).toEqual([]);
  }
  // A window dropped by the retention cap means the evidence is incomplete.
  expect(fusionPresentation(analysis([window(0, 10, 'complete', ['piano'])], 1), 20, 'full', release)?.qualified).toBe(false);
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

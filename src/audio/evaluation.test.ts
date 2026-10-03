import { describe, expect, it } from 'vitest';
import { evaluateLabels, validateEvaluationManifest, type EvaluationItem, type EvaluationPrediction } from './evaluation';

const item = (id: string, overrides: Partial<EvaluationItem> = {}): EvaluationItem => ({
  id, split: 'test', tier: 'loop', source: `local:${id}`, rights: { evaluationAllowed: true, basis: 'Synthetic test fixture' },
  groups: { original: id, artist: id, pack: id, sampleFamily: id }, transformations: [],
  start: 0, end: 10, reviews: [{ reviewer: 'fixture-reviewer', at: '2026-10-02T00:00:00Z',
    dimension: 'source', label: 'piano', state: 'present' }], ...overrides,
});
const manifest = (items: EvaluationItem[]) => ({ version: 1, frozenAt: '2026-10-02T00:00:00Z', items });

describe('evaluation manifest integrity', () => {
  it('accepts separately grouped reviewed rights-cleared examples', () => {
    expect(validateEvaluationManifest(manifest([item('a'), item('b', { split: 'calibration' })]))).toEqual([]);
  });
  it.each(['original', 'artist', 'pack', 'sampleFamily'] as const)('rejects %s leakage across splits including transformed excerpts', group => {
    const a = item('a'); const b = item('b', { split: 'calibration', transformations: ['pitch +2'] });
    b.groups[group] = a.groups[group];
    expect(validateEvaluationManifest(manifest([a, b])).join(' ')).toMatch(/split leakage/);
  });
  it('rejects missing rights, duplicate IDs, invalid intervals and unfrozen input', () => {
    const invalid = item('a', { rights: { evaluationAllowed: false, basis: '' }, end: 0 });
    const errors = validateEvaluationManifest({ version: 1, items: [invalid, item('a')] }).join(' ');
    expect(errors).toMatch(/rights/); expect(errors).toMatch(/duplicate/);
    expect(errors).toMatch(/interval/); expect(errors).toMatch(/frozenAt/);
  });
  it('reports malformed imported data without throwing', () => {
    for (const input of [null, {}, { version: 1, items: [null, 1, {}] }]) {
      expect(validateEvaluationManifest(input).length).toBeGreaterThan(0);
    }
  });
  it('rejects array-valued enums instead of coercing and silently excluding rows', () => {
    for (const field of ['split', 'tier'] as const) {
      const a = item('a');
      expect(validateEvaluationManifest(manifest([{ ...a, [field]: [a[field]] } as unknown as EvaluationItem])).length).toBeGreaterThan(0);
    }
    const a = item('a');
    const badReview = { ...a.reviews[0], state: ['present'] };
    expect(validateEvaluationManifest({ ...manifest([a]), items: [{ ...a, reviews: [badReview] }] }).length).toBeGreaterThan(0);
    expect(validateEvaluationManifest({ ...manifest([a]), items: [{ ...a, adjudications: [{ ...badReview, reason: 'resolved' }] }] }).length).toBeGreaterThan(0);
  });
});

describe('reviewed-label evaluation', () => {
  it('reports F1 and support without hiding a wholly missed class or treating unknown labels as negatives', () => {
    const a = item('a');
    a.reviews.push({ ...a.reviews[0], label: 'harp', state: 'present' });
    a.reviews.push({ ...a.reviews[0], label: 'voice', state: 'absent' });
    a.reviews.push({ ...a.reviews[0], label: 'guitar', state: 'unreviewed' });
    const result = evaluateLabels(manifest([a]), [
      { itemId: 'a', dimension: 'source', label: 'piano', decision: 'accepted' },
      { itemId: 'a', dimension: 'source', label: 'voice', decision: 'accepted' },
      { itemId: 'a', dimension: 'source', label: 'harp', decision: 'possible' },
    ], 'test');
    expect(result.total).toMatchObject({ f1: .5, positiveSupport: 2, negativeSupport: 1 });
    expect(result.byClass.find(c => c.label === 'harp')).toMatchObject({ f1: 0, positiveSupport: 1, negativeSupport: 0 });
    expect(result.byClass.find(c => c.label === 'guitar')).toBeUndefined();
    expect(result.macroF1).toBeCloseTo(1 / 3);
  });
  it('does not claim perfect F1 when a class has only absent or unknown annotations', () => {
    const a = item('a'); a.reviews[0].state = 'absent';
    const result = evaluateLabels(manifest([a]), [], 'test');
    expect(result.total).toMatchObject({ f1: null, positiveSupport: 0, negativeSupport: 1 });
    expect(result.macroF1).toBeNull();
  });
  it('counts only explicit annotations; reports accepted coverage and unknown predictions separately', () => {
    const a = item('a');
    a.reviews.push({ ...a.reviews[0], label: 'drums', state: 'absent' });
    const b = item('b');
    const predictions: EvaluationPrediction[] = [
      { itemId: 'a', dimension: 'source', label: 'piano', decision: 'accepted' },
      { itemId: 'a', dimension: 'source', label: 'drums', decision: 'accepted' },
      { itemId: 'a', dimension: 'source', label: 'voice', decision: 'accepted' },
      { itemId: 'b', dimension: 'source', label: 'piano', decision: 'possible' },
    ];
    const result = evaluateLabels(manifest([a, b]), predictions, 'test');
    expect(result.total).toMatchObject({ tp: 1, fp: 1, fn: 1, precision: .5, recall: .5,
      acceptedCoverage: 2 / 3, abstentionRate: 1 / 3, opportunities: 3 });
    expect(result.unreviewedAccepted).toBe(1);
    expect(result.reviewedFalseExtrasPerReviewedItem).toBe(.5);
    expect(result.uniqueOriginals).toBe(2);
    expect(result.byClass.find(c => c.label === 'piano')).toMatchObject({ tp: 1, fn: 1, precision: 1, recall: .5 });
  });
  it('does not score conflicting or uncertain reviews as positive or negative', () => {
    const a = item('a');
    a.reviews.push({ ...a.reviews[0], reviewer: 'second-reviewer', state: 'absent' });
    const result = evaluateLabels(manifest([a]), [{ itemId: 'a', dimension: 'source', label: 'piano', decision: 'accepted' }], 'test');
    expect(result.total.opportunities).toBe(0);
    expect(result.total.precision).toBeNull();
    expect(result.unreviewedAccepted).toBe(1);
  });
  it('deduplicates predictions and does not let calibration items enter test metrics', () => {
    const predictions: EvaluationPrediction[] = [
      { itemId: 'a', dimension: 'source', label: 'piano', decision: 'accepted' },
      { itemId: 'a', dimension: 'source', label: 'piano', decision: 'accepted' },
      { itemId: 'b', dimension: 'source', label: 'piano', decision: 'accepted' },
    ];
    const result = evaluateLabels(manifest([item('a'), item('b', { split: 'calibration' })]), predictions, 'test');
    expect(result.total.tp).toBe(1); expect(result.items).toBe(1);
  });
  it('fails closed on invalid manifests or predictions referring to nonexistent items', () => {
    expect(() => evaluateLabels(manifest([item('a'), item('a')]), [], 'test')).toThrow(/duplicate/);
    expect(() => evaluateLabels(manifest([item('a')]), [
      { itemId: 'missing', dimension: 'source', label: 'piano', decision: 'accepted' },
    ], 'test')).toThrow(/unknown item/);
  });
  it('does not dilute reviewed false extras with completely unreviewed items', () => {
    const a = item('a'); a.reviews[0].state = 'absent';
    const result = evaluateLabels(manifest([a, item('b', { reviews: [] })]), [
      { itemId: 'a', dimension: 'source', label: 'piano', decision: 'accepted' },
    ], 'test');
    expect(result.reviewedFalseExtrasPerReviewedItem).toBe(1);
    expect(result.reviewedItems).toBe(1);
    expect(result.itemAnnotationCoverage).toBe(.5);
  });
  it('uses explicit adjudication without discarding conflicting review history', () => {
    const a = item('a');
    a.reviews.push({ ...a.reviews[0], reviewer: 'second', state: 'absent' });
    a.adjudications = [{ ...a.reviews[0], state: 'present', reason: 'Reviewed disagreement together' }];
    const before = structuredClone(a);
    const result = evaluateLabels(manifest([a]), [
      { itemId: 'a', dimension: 'source', label: 'piano', decision: 'accepted' },
    ], 'test');
    expect(result.total.tp).toBe(1);
    expect(a).toEqual(before);
  });
  it('reports tier and dimension coverage, macro metrics, and connected provenance group counts', () => {
    const a=item('a'); const b=item('b',{tier:'one-shot'}); b.groups.pack=a.groups.pack;
    const result=evaluateLabels(manifest([a,b]),[{itemId:'a',dimension:'source',label:'piano',decision:'accepted'}],'test');
    expect(result.provenanceGroups).toBe(1);
    expect(result.byTier.find(s=>s.name==='loop')?.acceptedCoverage).toBe(1);
    expect(result.byTier.find(s=>s.name==='one-shot')?.acceptedCoverage).toBe(0);
    expect(result.byDimension.find(s=>s.name==='source')?.recall).toBe(.5);
    expect(result.macroRecall).toBe(.5);
    expect(result.precisionInterval95).toBeNull();
  });
});

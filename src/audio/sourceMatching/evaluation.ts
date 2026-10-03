import type { RejectionPolicy } from './matching';
export type Split = 'train' | 'calibration' | 'test';
export interface SourceEvaluationItem {
  id: string; split: Split; familyId: string; originalId: string; audioSha256: string;
  targetFamilyId: string | null; domain: 'synthetic' | 'real'; transformations: string[];
}
export interface SourceEvaluationManifest {
  version: 1; frozenAt: string;
  gallery: { referenceId: string; familyId: string }[];
  items: SourceEvaluationItem[];
}
export interface SourcePrediction { itemId: string; rankedReferenceIds: string[]; acceptedReferenceId: string | null }
const isText = (v: unknown): v is string => typeof v === 'string' && !!v.trim();
const hash = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);

/** Gallery may contain held-out families; their query variations cannot cross splits. */
export function validateSourceEvaluation(manifest: SourceEvaluationManifest): void {
  if (!manifest || manifest.version !== 1 || !Number.isFinite(Date.parse(manifest.frozenAt)) || !Array.isArray(manifest.gallery) || !Array.isArray(manifest.items)) throw new Error('invalid evaluation manifest');
  const refs = new Set<string>(); const galleryFamilies = new Set<string>();
  for (const r of manifest.gallery) {
    if (!isText(r.referenceId) || !isText(r.familyId) || refs.has(r.referenceId)) throw new Error('invalid or duplicate gallery reference');
    refs.add(r.referenceId); galleryFamilies.add(r.familyId);
  }
  const ids = new Set<string>(); const groups = new Map<string, Split>();
  for (const item of manifest.items) {
    if (!isText(item.id) || ids.has(item.id) || !['train', 'calibration', 'test'].includes(item.split) || !isText(item.familyId) || !isText(item.originalId) || !hash(item.audioSha256) || !['synthetic', 'real'].includes(item.domain) || !Array.isArray(item.transformations) || !item.transformations.every(isText)) throw new Error('invalid or duplicate evaluation item');
    ids.add(item.id);
    if (item.targetFamilyId !== null && (item.targetFamilyId !== item.familyId || !galleryFamilies.has(item.targetFamilyId)) || item.targetFamilyId === null && galleryFamilies.has(item.familyId)) throw new Error('target/open-set family inconsistent with gallery');
    for (const [kind, value] of [['family', item.familyId], ['original', item.originalId], ['audio', item.audioSha256]]) {
      const key = JSON.stringify([kind, value]);
      if (groups.has(key) && groups.get(key) !== item.split) throw new Error(`${kind} split leakage: ${value}`);
      groups.set(key, item.split);
    }
  }
}
const ratio = (a: number, b: number) => b ? a / b : null;

/** Missing, duplicate, out-of-split, or unrecognized predictions are errors, not extra successes. */
export function evaluateSourceRetrieval(manifest: SourceEvaluationManifest, predictions: SourcePrediction[], split: Split, domain: 'synthetic' | 'real') {
  validateSourceEvaluation(manifest);
  if (!['train', 'calibration', 'test'].includes(split) || !['synthetic', 'real'].includes(domain)) throw new Error('invalid evaluation selection');
  const items = manifest.items.filter(i => i.split === split && i.domain === domain);
  const selected = new Map(items.map(i => [i.id, i]));
  const gallery = new Map(manifest.gallery.map(r => [r.referenceId, r.familyId]));
  const seen = new Set<string>();
  let known = 0; let unknown = 0; let top1 = 0; let top5 = 0; let falseId = 0; let accepted = 0; let correctAccepted = 0;
  const familyHits = new Map<string, { count: number; top1: number; top5: number }>();
  for (const prediction of predictions) {
    const item = selected.get(prediction.itemId);
    if (!item || seen.has(item.id) || !Array.isArray(prediction.rankedReferenceIds) || new Set(prediction.rankedReferenceIds).size !== prediction.rankedReferenceIds.length || prediction.rankedReferenceIds.some(id => !gallery.has(id)) || prediction.acceptedReferenceId !== null && (!gallery.has(prediction.acceptedReferenceId) || prediction.acceptedReferenceId !== prediction.rankedReferenceIds[0])) throw new Error('invalid/duplicate/out-of-selection prediction');
    seen.add(item.id);
    const rankedFamilies = [...new Set(prediction.rankedReferenceIds.map(id => gallery.get(id)!))];
    const acceptedFamily = prediction.acceptedReferenceId === null ? null : gallery.get(prediction.acceptedReferenceId)!;
    if (acceptedFamily !== null) accepted++;
    if (item.targetFamilyId === null) { unknown++; if (acceptedFamily !== null) falseId++; }
    else {
      known++;
      const one = Number(rankedFamilies[0] === item.targetFamilyId); const five = Number(rankedFamilies.slice(0, 5).includes(item.targetFamilyId));
      top1 += one; top5 += five;
      if (acceptedFamily === item.targetFamilyId) correctAccepted++;
      const f = familyHits.get(item.familyId) ?? { count: 0, top1: 0, top5: 0 };
      f.count++; f.top1 += one; f.top5 += five; familyHits.set(item.familyId, f);
    }
  }
  if (seen.size !== items.length) throw new Error('one prediction per selected item required');
  const families = [...familyHits.values()];
  return { split, domain, items: items.length, known, unknown, top1: ratio(top1, known), top5: ratio(top5, known),
    macroFamilyTop1: ratio(families.reduce((n, f) => n + f.top1 / f.count, 0), families.length),
    macroFamilyTop5: ratio(families.reduce((n, f) => n + f.top5 / f.count, 0), families.length),
    openSetFalseId: ratio(falseId, unknown), openSetFalseIdCount: falseId,
    acceptedCoverage: ratio(accepted, items.length), acceptedAccuracy: ratio(correctAccepted, accepted),
    note: domain === 'synthetic' ? 'Synthetic controls only; not preset identification accuracy.' : 'Held-out retrieval metrics; similarity does not prove physical origin.' };
}

export interface CalibrationObservation { itemId: string; score: number; familyMargin: number; coverage: number; frames: number; topFamilyId: string | null }
/** Fits only the calibration split. Caller must retain this manifest/policy before test scoring. */
export function calibrateRejection(manifest: SourceEvaluationManifest, observations: CalibrationObservation[], domain: 'synthetic' | 'real', calibrationId: string, maxFalseIdRate = 0): RejectionPolicy {
  validateSourceEvaluation(manifest);
  if (!isText(calibrationId) || !['synthetic', 'real'].includes(domain) || !Number.isFinite(maxFalseIdRate) || maxFalseIdRate < 0 || maxFalseIdRate > 1) throw new Error('invalid calibration configuration');
  const items = manifest.items.filter(i => i.split === 'calibration' && i.domain === domain);
  if (!items.some(i => i.targetFamilyId === null) || !items.some(i => i.targetFamilyId !== null)) throw new Error('known and unfamiliar calibration families required');
  const byId = new Map(observations.map(o => [o.itemId, o]));
  const families = new Set(manifest.gallery.map(g => g.familyId));
  if (byId.size !== observations.length || observations.length !== items.length || observations.some(o => !items.some(i => i.id === o.itemId) || !Number.isFinite(o.score) || o.score < 0 || o.score > 1 || !Number.isFinite(o.familyMargin) || o.familyMargin < 0 || o.familyMargin > 1 || !Number.isFinite(o.coverage) || o.coverage < 0 || o.coverage > 1 || !Number.isInteger(o.frames) || o.frames < 0 || o.topFamilyId !== null && !families.has(o.topFamilyId))) throw new Error('invalid calibration observations');
  let best: RejectionPolicy | null = null; let bestCorrect = -1;
  const scores = [...new Set([1, ...observations.map(o => o.score), ...observations.map(o => Math.min(1, o.score + 1e-6))])].sort((a, b) => b - a);
  const margins = [...new Set([1, ...observations.map(o => o.familyMargin), ...observations.map(o => Math.min(1, o.familyMargin + 1e-6))])].sort((a, b) => b - a);
  for (const minScore of scores) for (const minFamilyMargin of margins) {
    let falseIds = 0; let correct = 0;
    for (const item of items) {
      const o = byId.get(item.id)!;
      const accept = o.topFamilyId !== null && o.score >= minScore && o.familyMargin >= minFamilyMargin && o.coverage >= 0.9 && o.frames >= 8;
      if (accept && item.targetFamilyId === null) falseIds++;
      if (accept && o.topFamilyId === item.targetFamilyId) correct++;
    }
    if (falseIds / items.filter(i => i.targetFamilyId === null).length <= maxFalseIdRate && correct > bestCorrect) {
      bestCorrect = correct; best = { calibrationId, minScore, minFamilyMargin, minCoverage: 0.9, minFrames: 8 };
    }
  }
  if (!best) throw new Error('no policy satisfies empirical false-ID bound; collect more calibration data');
  return best;
}

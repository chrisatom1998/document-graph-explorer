export type EvaluationSplit = 'train' | 'calibration' | 'test';
export interface EvaluationItem {
  id: string;
  split: EvaluationSplit;
  tier: 'one-shot' | 'loop' | 'song' | 'stem';
  source: string;
  rights: { evaluationAllowed: boolean; basis: string };
  groups: { original: string; artist: string; pack: string; sampleFamily: string };
  transformations: string[];
  start: number;
  end: number;
  reviews: { reviewer: string; at: string; dimension: string; label: string; state: 'present' | 'absent' | 'uncertain' | 'unreviewed' }[];
  adjudications?: { reviewer: string; at: string; dimension: string; label: string; state: 'present' | 'absent'; reason: string }[];
}
export interface EvaluationPrediction { itemId: string; dimension: string; label: string; decision: 'accepted' | 'possible' | 'unknown' }
interface EvaluationManifest { version: 1; frozenAt: string; items: EvaluationItem[] }
const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const date = (v: unknown) => text(v) && Number.isFinite(Date.parse(v));
const splits = ['train', 'calibration', 'test'];
const groupNames = ['original', 'artist', 'pack', 'sampleFamily'] as const;
const key = (...parts: string[]) => JSON.stringify(parts);

/** Fail closed before scoring. This validates declarations, not the underlying legal rights. */
export function validateEvaluationManifest(raw: unknown): string[] {
  if (!object(raw)) return ['manifest must be an object'];
  const errors: string[] = [];
  if (raw.version !== 1) errors.push('unsupported manifest version');
  if (!date(raw.frozenAt)) errors.push('frozenAt must be a valid timestamp');
  if (!Array.isArray(raw.items) || !raw.items.length) return [...errors, 'items must be a nonempty array'];
  const ids = new Set<string>(); const groups = new Map<string, unknown>();
  for (const [index, entry] of raw.items.entries()) {
    const prefix = `item ${index}`;
    if (!object(entry)) { errors.push(`${prefix}: invalid object`); continue; }
    if (!text(entry.id)) errors.push(`${prefix}: id required`);
    else if (ids.has(entry.id)) errors.push(`${prefix}: duplicate id ${entry.id}`);
    else ids.add(entry.id);
    if (typeof entry.split !== 'string' || !splits.includes(entry.split)) errors.push(`${prefix}: invalid split`);
    if (typeof entry.tier !== 'string' || !['one-shot', 'loop', 'song', 'stem'].includes(entry.tier)) errors.push(`${prefix}: invalid tier`);
    if (!text(entry.source)) errors.push(`${prefix}: source required`);
    if (!object(entry.rights) || entry.rights.evaluationAllowed !== true || !text(entry.rights.basis)) errors.push(`${prefix}: explicit evaluation rights required`);
    if (typeof entry.start !== 'number' || typeof entry.end !== 'number' || !Number.isFinite(entry.start) || !Number.isFinite(entry.end) || entry.start < 0 || entry.end <= entry.start) errors.push(`${prefix}: invalid interval`);
    if (!Array.isArray(entry.transformations) || !entry.transformations.every(text)) errors.push(`${prefix}: transformations must be a string array`);
    if (!object(entry.groups)) errors.push(`${prefix}: provenance groups required`);
    else for (const name of groupNames) {
      const value = entry.groups[name];
      if (!text(value)) { errors.push(`${prefix}: group ${name} required`); continue; }
      const id = key(name, value);
      if (groups.has(id) && groups.get(id) !== entry.split) errors.push(`${prefix}: split leakage in ${name} ${value}`);
      groups.set(id, entry.split);
    }
    if (!Array.isArray(entry.reviews)) errors.push(`${prefix}: reviews required`);
    else for (const review of entry.reviews) {
      if (!object(review) || !text(review.reviewer) || !date(review.at) || !text(review.dimension) || !text(review.label) || typeof review.state !== 'string' || !['present', 'absent', 'uncertain', 'unreviewed'].includes(review.state)) errors.push(`${prefix}: invalid review`);
    }
    if (entry.adjudications !== undefined) {
      if (!Array.isArray(entry.adjudications)) errors.push(`${prefix}: invalid adjudications`);
      else {
        const seen = new Set<string>();
        for (const decision of entry.adjudications) {
          if (!object(decision) || !text(decision.reviewer) || !date(decision.at) || !text(decision.dimension) || !text(decision.label) || !text(decision.reason) || typeof decision.state !== 'string' || !['present', 'absent'].includes(decision.state)) {
            errors.push(`${prefix}: invalid adjudication`); continue;
          }
          const id = key(decision.dimension, decision.label);
          if (seen.has(id)) errors.push(`${prefix}: duplicate adjudication`);
          seen.add(id);
        }
      }
    }
  }
  return errors;
}

interface Counts { tp: number; fp: number; fn: number; opportunities: number }
const counts = (): Counts => ({ tp: 0, fp: 0, fn: 0, opportunities: 0 });
const ratio = (n: number, d: number) => d ? n / d : null;
function metrics(c: Counts) {
  return { ...c, precision: ratio(c.tp, c.tp + c.fp), recall: ratio(c.tp, c.tp + c.fn),
    f1: ratio(2 * c.tp, 2 * c.tp + c.fp + c.fn),
    positiveSupport: c.tp + c.fn, negativeSupport: c.opportunities - c.tp - c.fn,
    acceptedCoverage: ratio(c.tp + c.fp, c.opportunities), abstentionRate: ratio(c.opportunities - c.tp - c.fp, c.opportunities) };
}

/** Explicit reviewed item/label opportunities only; duplicate windows cannot inflate counts. */
export function evaluateLabels(raw: unknown, predictions: EvaluationPrediction[], split: EvaluationSplit) {
  const errors = validateEvaluationManifest(raw);
  if (errors.length) throw new Error(errors.join('; '));
  if (!splits.includes(split)) throw new Error('invalid evaluation split');
  const manifest = raw as EvaluationManifest;
  const ids = new Set(manifest.items.map(i => i.id));
  const accepted = new Set<string>();
  for (const prediction of predictions) {
    if (!ids.has(prediction.itemId)) throw new Error(`unknown item ${prediction.itemId}`);
    if (!text(prediction.dimension) || !text(prediction.label) || !['accepted', 'possible', 'unknown'].includes(prediction.decision)) throw new Error('invalid prediction');
    if (prediction.decision === 'accepted') accepted.add(key(prediction.itemId, prediction.dimension, prediction.label));
  }
  const items = manifest.items.filter(i => i.split === split);
  const selected = new Set(items.map(i => i.id));
  const total = counts();
  const byTier = new Map<string, Counts>();
  const byDimension = new Map<string, Counts>();
  const byItem = new Map<string, Counts>();
  const classes = new Map<string, Counts & { dimension: string; label: string }>();
  const reviewedAccepted = new Set<string>();
  let reviewedItems = 0;
  for (const item of items) {
    const annotations = new Map<string, { dimension: string; label: string; states: Set<string> }>();
    for (const review of item.reviews) {
      const id = key(review.dimension, review.label);
      const annotation = annotations.get(id) ?? { dimension: review.dimension, label: review.label, states: new Set<string>() };
      annotation.states.add(review.state); annotations.set(id, annotation);
    }
    for (const decision of item.adjudications ?? []) {
      annotations.set(key(decision.dimension, decision.label), { dimension: decision.dimension, label: decision.label, states: new Set([decision.state]) });
    }
    let reviewed = false;
    for (const [id, annotation] of annotations) {
      if (annotation.states.size !== 1 || (!annotation.states.has('present') && !annotation.states.has('absent'))) continue;
      const c = classes.get(id) ?? { ...counts(), dimension: annotation.dimension, label: annotation.label };
      const predictionId = key(item.id, annotation.dimension, annotation.label);
      const positive = accepted.has(predictionId);
      const tier=byTier.get(item.tier)??counts();byTier.set(item.tier,tier);
      const dimension=byDimension.get(annotation.dimension)??counts();byDimension.set(annotation.dimension,dimension);
      const itemCounts=byItem.get(item.id)??counts();byItem.set(item.id,itemCounts);
      const targets=[c,total,tier,dimension,itemCounts];
      targets.forEach(target=>target.opportunities++);
      reviewed = true;
      if (positive) {
        reviewedAccepted.add(predictionId);
        if (annotation.states.has('present')) targets.forEach(target=>target.tp++);
        else targets.forEach(target=>target.fp++);
      } else if (annotation.states.has('present')) targets.forEach(target=>target.fn++);
      classes.set(id, c);
    }
    if (reviewed) reviewedItems++;
  }
  const unreviewedAccepted = [...accepted].filter(id => selected.has((JSON.parse(id) as string[])[0]) && !reviewedAccepted.has(id)).length;
  // Connected provenance components prevent chains of shared artists/packs from
  // being mistaken for independent windows in a cluster bootstrap.
  const parents=items.map((_,i)=>i);
  const root=(i:number):number=>{while(parents[i]!==i){parents[i]=parents[parents[i]];i=parents[i];}return i;};
  const owners=new Map<string,number>();
  items.forEach((item,i)=>groupNames.forEach(name=>{
    const id=key(name,item.groups[name]);const owner=owners.get(id);
    if(owner!==undefined)parents[root(i)]=root(owner);else owners.set(id,i);
  }));
  const groupCounts=new Map<number,Counts>();
  items.forEach((item,i)=>{
    const id=root(i);const c=groupCounts.get(id)??counts();const value=byItem.get(item.id)??counts();
    for(const field of ['tp','fp','fn','opportunities'] as const)c[field]+=value[field];
    groupCounts.set(id,c);
  });
  const classMetrics=[...classes.values()].map(c=>({dimension:c.dimension,label:c.label,...metrics(c)}));
  const mean=(values:(number|null)[])=>{const known=values.filter((v):v is number=>v!==null);return known.length?known.reduce((a,b)=>a+b,0)/known.length:null;};
  const precisionInterval95=clusterPrecisionInterval([...groupCounts.values()]);
  return { split, items: items.length, uniqueOriginals: new Set(items.map(i => i.groups.original)).size,
    provenanceGroups:groupCounts.size, precisionInterval95, intervalMethod:'Deterministic 2000-replicate percentile bootstrap of connected provenance groups; exploratory, unreliable for small or biased corpora.',
    total: metrics(total), byClass: classMetrics,
    macroPrecision:mean(classMetrics.map(c=>c.precision)),macroRecall:mean(classMetrics.map(c=>c.recall)),macroF1:mean(classMetrics.map(c=>c.f1)),
    byTier:[...byTier].map(([name,c])=>({name,...metrics(c)})),byDimension:[...byDimension].map(([name,c])=>({name,...metrics(c)})),
    unreviewedAccepted, reviewedItems, itemAnnotationCoverage: ratio(reviewedItems, items.length),
    reviewedFalseExtrasPerReviewedItem: ratio(total.fp, reviewedItems),
    limitation: 'Descriptive counts only. Related excerpts are not independent trials; no calibrated confidence or release certification is implied.' };
}

function clusterPrecisionInterval(groups: Counts[]): [number,number] | null {
  const reviewed=groups.filter(g=>g.opportunities>0);
  if(reviewed.length<2)return null;
  let seed=0x12345678;
  const random=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return (seed>>>0)/4294967296;};
  const values:number[]=[];
  for(let sample=0;sample<2000;sample++) {
    let tp=0,fp=0;
    for(let i=0;i<reviewed.length;i++){const c=reviewed[Math.floor(random()*reviewed.length)];tp+=c.tp;fp+=c.fp;}
    if(tp+fp)values.push(tp/(tp+fp));
  }
  if(values.length<1900)return null; // Too many zero-denominator resamples for a useful interval.
  values.sort((a,b)=>a-b);
  if(values[0]===values.at(-1))return null; // A degenerate bootstrap cannot establish error-free accuracy.
  return [values[Math.floor(values.length*.025)],values[Math.min(values.length-1,Math.floor(values.length*.975))]];
}

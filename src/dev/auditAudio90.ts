import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { sourceLabels, dimensionLabels } from '../audio/recognition';
import { DJ_CATALOG } from '../audio/djTags';
import { sanitizeLearnedDjModel } from '../audio/learnedDjModel';
import { strictReviewedModel } from './strictReviewedEvaluation';

const evidencePath = process.argv[2];
if (!evidencePath) throw new Error('Pass preserved consumed per-category report path');
const output = resolve('artifacts/astra90'); mkdirSync(output, { recursive: true });
const bytes = readFileSync(evidencePath); const consumed = JSON.parse(bytes.toString());
const learnedBytes = readFileSync('public/sound-model/learned.json');
const learned = JSON.parse(learnedBytes.toString());
const fusionPolicyBytes = readFileSync('public/fusion-model/policy.json');
const fusionPolicy = JSON.parse(fusionPolicyBytes.toString());
const fusionModel = JSON.parse(readFileSync('public/fusion-model/model.json', 'utf8'));
const rules = ['src/audio/djTags.ts', 'src/audio/djClassification.ts', 'src/audio/ensemble.ts', 'src/audio/fusionPresentation.ts', 'src/audio/learnedDjModel.ts', 'src/audio/analyzeDecodedMusic.ts', 'src/audio/instrumentEvidence.ts'];
const sha = (x: Buffer) => createHash('sha256').update(x).digest('hex');
let strictRejection = '';
try { strictReviewedModel(learned.examples, []); } catch (e) { strictRejection = String(e); }
const categories = new Map<string, { dimension: string; label: string; routes: string[] }>();
const add = (dimension: string, label: string, route: string) => {
  const key = dimension + ':' + label;
  const row = categories.get(key) ?? { dimension, label, routes: [] };
  if (!row.routes.includes(route)) row.routes.push(route);
  categories.set(key, row);
};
sourceLabels.forEach(label => add('source', label, 'native/fusion source taxonomy'));
Object.entries(dimensionLabels).forEach(([dimension, labels]) => labels.forEach(label => add(dimension, label, 'recognition timeline')));
DJ_CATALOG.forEach(c => add(c.group, c.label, 'DJ catalog: ' + c.axis));
const rows = [...categories.values()].map(c => {
  const prior = c.dimension === 'source' ? consumed.candidate[c.label] : undefined;
  const baseline = c.dimension === 'source' ? consumed.baseline[c.label] : undefined;
  return { ...c, status: 'provisional', validated90: false,
    blocker: prior ? 'Consumed sparse instrument diagnostic, not a fresh complete displayed-pipeline test; insufficient per-category proof.' : 'No verified representative independent category test with complete displayed-pipeline predictions.',
    nextExperiment: c.dimension === 'character' || c.dimension === 'production' || c.dimension === 'effect'
      ? 'Acquire human-confirmed category-specific positives/confusers and documented dry/processed pairs across instruments/settings; split recording/pack families before calibration and blind testing.'
      : 'Acquire diverse confirmed positives and hard negatives; partition recording/artist/pack families, fit on train and calibrate exact deployed pipeline before a fresh blind test.',
    deploymentRules: { reviewedHead: learned.heads.filter((h: {group: string; label: string}) => h.group === c.dimension && h.label === c.label).map((h: {threshold: number}) => ({ modelThreshold: h.threshold, finalInclusionMinimum: .88, active: false })), fusion: prior ? { variant: fusionPolicy.variant, threshold: fusionPolicy.threshold, margin: fusionPolicy.margin, eligibility: fusionModel.eligibility[c.label] } : null },
    historicalDiagnostic: prior ? { candidate: prior, baseline,
      precisionInterval95: consumed.bootstrap.intervals['perClass.' + c.label + '.precision'],
      recallInterval95: consumed.bootstrap.intervals['perClass.' + c.label + '.recall'] } : null };
});
const report = { schemaVersion: 1, generatedAt: new Date().toISOString(),
  scope: 'Inventory and preserved historical diagnostics. No new accuracy test or training claim.',
  evidence: { path: evidencePath, sha256: sha(bytes), status: 'consumed-development-diagnostic' },
  reviewedModel: { sha256: sha(learnedBytes), examples: learned.examples.length, heads: learned.heads.length,
    humanProvenanceExamples: learned.examples.filter((e: {provenance?: string}) => e.provenance === 'explicit human confirmation').length,
    runtimeAccepted: !!sanitizeLearnedDjModel(learned), strictRejection,
    thresholds: [...new Set(learned.heads.map((h: {threshold: number}) => h.threshold))],
    displayInclusionThreshold: .88, displayExclusionThreshold: .94,
    trainingGate: 'Legacy trainReviewedClassifier evaluates at .70 and activates at precision .80 / recall .50; not 90/90 qualification. Legacy held-out reviews also remain in nearest matching.',
    separation: 'This reviewed CLAP model is separate from the preserved twenty-class fusion release.' },
  fusionPolicy: { sha256: sha(fusionPolicyBytes), policy: fusionPolicy },
  exactDeploymentSourceHashes: Object.fromEntries(rules.map(path => [path, sha(readFileSync(path))])),
  categoryCount: rows.length, validatedCategoryCount: 0, categories: rows };
writeFileSync(resolve(output, 'category-audit.json'), JSON.stringify(report, null, 2) + '\n');
const pct = (n: number | null | undefined) => n == null ? 'unknown' : (100 * n).toFixed(2) + '%';
const lines = ['# Strict audio accuracy audit', '',
  'No category is certified at 90% precision and 90% recall with lower 95% bounds at 90%.', '',
  'The MIME routing bug is repaired. Original bytes and human corrections are preserved. The historical 256-file results are consumed sparse diagnostics, not measurements of the final displayed GUI pipeline.', '',
  `The reviewed-model file has ${learned.examples.length} examples and ${learned.heads.length} heads; zero examples carry the explicit human-confirmation provenance required by the current runtime. The runtime rejects this artifact. Do not convert missing provenance into human confirmation.`, '',
  'The legacy training cutoff is 0.70, while displayed reviewed inclusions require 0.88. Its legacy 0.80 precision / 0.50 recall activation and retained held-out nearest neighbors cannot establish the new specification. New evaluation snapshots exclude all calibration and test examples from matching and reject cross-split provenance.', '',
  'Sound source, production technique, sound character, and processing effect remain distinct. Reverberant or distorted character labels are not evidence of a documented reverb or distortion process.', '',
  '| Category | Historical baseline P/R | Historical candidate P/R | Candidate TP/FP/FN | Status |', '|---|---:|---:|---:|---|',
  ...rows.map(c => { const h = c.historicalDiagnostic; return `| ${c.dimension}: ${c.label} | ${h ? pct(h.baseline?.precision) + ' / ' + pct(h.baseline?.recall) : 'unmeasured'} | ${h ? pct(h.candidate.precision) + ' / ' + pct(h.candidate.recall) : 'unmeasured'} | ${h ? [h.candidate.tp, h.candidate.fp, h.candidate.fn].join('/') : 'unmeasured'} | provisional |`; }), '',
  'Every category has its exact blocker and next experiment in category-audit.json. Confidence intervals, uncertainty, and counts are preserved there without alteration. No models or thresholds were retuned using the consumed test.', ''];
writeFileSync(resolve(output, 'REPORT.md'), lines.join('\n'));
console.log(JSON.stringify({ fusionPolicy: { sha256: sha(fusionPolicyBytes), policy: fusionPolicy },
  exactDeploymentSourceHashes: Object.fromEntries(rules.map(path => [path, sha(readFileSync(path))])),
  categoryCount: rows.length, runtimeReviewedModelAccepted: report.reviewedModel.runtimeAccepted, output }));

// Existing licensed features only. No inference, downloads, training, or writes to source data.
// Usage: vite-node scripts/evaluate-music-links.mjs <features-with-annotations.json> <output-directory> [baseline-musicLinks.ts]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { buildMusicEdges, musicPairEdges } from '../src/audio/musicLinks';
import { shortClipScores, sanitizeShortClipModel } from '../src/audio/shortClipModel';
import { selectDjTags } from '../src/audio/djTags';
import { soundMatchLabels } from '../src/audio/soundMatchLabels';

const [input, out, baselinePath] = process.argv.slice(2);
if (!input || !out) throw Error('Provide cached features with license/annotation records and an output directory.');
const rows = JSON.parse(readFileSync(input, 'utf8')).filter(r => r.annotation?.rights?.evaluationAllowed && r.clapRepeat?.length === 512)
  .sort((a, b) => a.id.localeCompare(b.id));
const model = sanitizeShortClipModel(JSON.parse(readFileSync('public/sound-model/short-clip.json', 'utf8')));
if (!model) throw Error('The current shipped short-clip heads are invalid.');
const nodes = rows.map(r => ({ id: r.id, title: r.id, path: `${r.id}.wav`, kind: 'document', fileType: 'audio',
  topics: [], entities: [], keywords: [], wordCount: 0, degree: 0, cluster: 0, status: 'ok',
  audio: { version: 2, durationSeconds: r.seconds, analyzedSeconds: r.seconds, instruments: [], notes: [], embedding: r.clapRepeat,
    // The analysis worker applies the short-clip heads only within their validated duration; mirror that gate
    // so longer rows do not pick up out-of-domain tags that would skew the edge metrics and the browser fixture.
    soundProfile: { version: 1, character: [], roles: [], models: [], disagreement: false,
      djTags: r.seconds <= model.maxSeconds ? selectDjTags(shortClipScores(model, r).scores) : [] } } }));
const byId = new Map(nodes.map(n => [n.id, n]));
const truth = new Map(rows.map(r => [r.id, r.annotation]));
const baseline = baselinePath ? await import(resolve(baselinePath)) : undefined;
const measure = build => {
  const start = performance.now(), edges = build(nodes), ms = performance.now() - start;
  const neighbors = new Map(), kinds = {}, pairs = new Set();
  for (const e of edges) {
    kinds[e.kind] = (kinds[e.kind] ?? 0) + 1; pairs.add(`${e.source}:${e.target}`);
    for (const [a, b] of [[e.source, e.target], [e.target, e.source]]) {
      const set = neighbors.get(a) ?? new Set(); set.add(b); neighbors.set(a, set);
    }
  }
  return { edges, metrics: { nodes: nodes.length, typedEdges: edges.length, pairs: pairs.size,
    density: 2 * pairs.size / Math.max(1, nodes.length * (nodes.length - 1)), ms: Math.round(ms), kinds,
    connectedNodes: neighbors.size, maxNeighbors: Math.max(0, ...[...neighbors.values()].map(s => s.size)), precision: null, recall: null } };
};
const before = baseline && measure(baseline.buildMusicEdges), after = measure(buildMusicEdges);
const positives = id => truth.get(id).reviews.filter(r => r.state === 'present').map(r => `${r.dimension}:${r.label}`);
const cos = (a, b) => {
  const x = a.audio.embedding, y = b.audio.embedding;
  return x.reduce((sum, v, i) => sum + v * y[i], 0) / (Math.hypot(...x) * Math.hypot(...y));
};
const examples = [];
// Similarity is NOT implied by a shared category. These examples expose actual
// same-role/source candidates and confusing cross-category candidates for review.
for (const [aCategory, bCategory] of [['role:bass hit', 'role:bass hit'], ['source:guitar', 'source:guitar'],
  ['role:clap', 'role:snare'], ['source:guitar', 'source:brass'], ['role:impact', 'role:whoosh']]) {
  let best;
  const aNodes = nodes.filter(n => positives(n.id).includes(aCategory)), bNodes = nodes.filter(n => positives(n.id).includes(bCategory));
  for (const a of aNodes) for (const b of bNodes) {
    if (a.id === b.id || truth.get(a.id).groups.original === truth.get(b.id).groups.original) continue;
    const similarity = cos(a, b);
    if (!best || similarity > best.similarity) best = { a: a.id, b: b.id, similarity };
  }
  if (!best) continue;
  const pair = e => (e.source === best.a && e.target === best.b) || (e.source === best.b && e.target === best.a);
  examples.push({ ...best, categoryA: aCategory, categoryB: bCategory,
    annotations: [best.a, best.b].map(id => ({ id, positiveLabels: positives(id), source: truth.get(id).source, rights: truth.get(id).rights,
      groups: truth.get(id).groups, split: truth.get(id).split, displayedClues: soundMatchLabels(byId.get(id)) })),
    before: before?.edges.filter(pair), after: after.edges.filter(pair), pairReasons: musicPairEdges(byId.get(best.a), byId.get(best.b)) });
}
mkdirSync(out, { recursive: true });
const report = { at: new Date().toISOString(), inputSha256: createHash('sha256').update(readFileSync(input)).digest('hex'),
  shortClipModelRevision: model.revision, baselineSourceSha256: baselinePath && createHash('sha256').update(readFileSync(baselinePath)).digest('hex'),
  limitations: ['Cached features from unchanged licensed audio, using current shipped detector heads. No new model inference or training.',
    'These available cached examples are development/calibration data, not an independent held-out listening evaluation.',
    'Human source/role annotations do not provide pair-similarity ground truth. Unknown labels are not negatives. Precision/recall cannot be estimated.',
    'The relative fingerprint margin is a selection heuristic. High cosine and same role are not proof that recordings sound alike or are duplicates.'],
  splits: Object.fromEntries([...new Set(rows.map(r => r.annotation.split))].map(s => [s, rows.filter(r => r.annotation.split === s).length])),
  before: before?.metrics, after: after.metrics, examples };
writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
writeFileSync(join(out, 'edges.json'), JSON.stringify(after.edges, null, 2));
const selectedIds = new Set(examples.flatMap(e => [e.a, e.b]));
const selectedNodes = nodes.filter(n => selectedIds.has(n.id));
writeFileSync(join(out, 'browser-fixture.json'), JSON.stringify({ version: 1, generator: 'knowledge-nebula', createdAt: report.at,
  includeEmbeddings: false, nodes: selectedNodes, edges: buildMusicEdges(selectedNodes) }));
console.log(JSON.stringify({ splits: report.splits, before: report.before, after: report.after,
  examples: examples.map(e => ({ a: e.a, b: e.b, labels: [e.categoryA, e.categoryB], cosine: +e.similarity.toFixed(3), before: e.before?.map(x => x.kind), after: e.after.map(x => x.kind) })) }, null, 2));

/**
 * Graph accuracy eval over the 64 generated demo records.
 *
 * Each generated record has known ground truth: the theme it was written
 * about (3–4 records per theme) and the sibling records it cites by filename
 * (previous/next in its theme, plus one cross-theme partner). This test runs
 * the same lexical → embedding → semantic → Louvain passes the ingest
 * coordinator runs, with the thresholds in src/config.ts, and scores:
 *
 * - edge precision / recall per edge kind and for the whole graph, where a
 *   pair is "related" when both records share a theme or one cites the other;
 * - reference-edge precision / recall against the explicit citations alone;
 * - cluster purity, inverse purity and NMI against the theme labels.
 *
 * Embeddings use the bundled bge-small-en-v1.5 (q8, the browser's WASM
 * dtype) through onnxruntime-node. Text comes straight from the generator, so
 * the PDF round trip is out of scope here (the Playwright smoke suite covers
 * it). The floors below sit just under today's scores: a drop means a change
 * made the graph less accurate; a rise means the floor can be raised.
 *
 * The generated records are what the link thresholds were tuned on, so a
 * second test guards against overfitting them: it builds the full 100-doc
 * demo graph from the real PDFs, as the app does, and checks the 36
 * hand-written PDFs against topic groups labelled by hand (HELD_OUT_GROUPS)
 * that played no part in the tuning.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  CHUNK_TOKENS,
  DUP_SIM_THRESHOLD,
  EMBED_DIMS,
  EMBED_MODEL_ID,
  ENTITY_EDGE_MIN_SHARED,
  ENTITY_EDGES_PER_DOC,
  KEYWORD_EDGE_MIN_SHARED,
  KEYWORD_EDGES_PER_DOC,
  MAX_EMBED_TEXT_BYTES,
  MIN_MENTION_TITLE_LEN,
  SIM_RELATIVE_MARGIN,
  SIM_THRESHOLD,
  SIM_TOP_K,
  TFIDF_TOP_N,
} from '../config';
import {
  createGeneratedDemoDocuments,
  GENERATED_DEMO_DOCUMENT_COUNT,
  generatedDemoCrossReferences,
  generatedDemoFilename,
  generatedDemoText,
  generatedDemoThemeSlug,
} from '../demo/generatedDocuments';
import { buildTitleEdges } from '../graph/titleLinks';
import type { DocNode, Edge, LexicalDocInput } from '../model/types';
import { stripBoilerplate } from '../pipeline/boilerplate';
import { chunkText } from '../pipeline/chunker';
import { extractEntities } from '../pipeline/entities';
import { parsePdfEngine } from '../pipeline/parsers/pdfEngine';
import { extractPhraseTf } from '../pipeline/phrases';
import { termFreq, tokenize } from '../pipeline/tokenize';
import { handleLexical, handleSemantic } from '../workers/aggregatorHandlers';
import { pairKey, scoreClusters, scorePairs, type PRScore } from './graphAccuracy';

const COUNT = GENERATED_DEMO_DOCUMENT_COUNT;
const MODEL_ROOT = new URL('../../public/models/', import.meta.url).pathname;
const DEMO_DIR = new URL('../../public/demo/', import.meta.url).pathname;

interface CorpusDoc {
  id: string;
  text: string;
  title: string;
}

interface EvalDoc extends CorpusDoc {
  index: number;
  theme: string;
}

function buildCorpus(): EvalDoc[] {
  return Array.from({ length: COUNT }, (_, offset) => {
    const index = offset + 1;
    const text = generatedDemoText(index, undefined, COUNT);
    return {
      id: generatedDemoFilename(index, COUNT),
      index,
      theme: generatedDemoThemeSlug(index),
      text,
      // The PDF writer stores the first line as the Info title, which is what
      // the pdf.js parser reports as the document title.
      title: text.split('\n')[0]!.replace(/^#\s*/, ''),
    };
  });
}

function groundTruth(docs: EvalDoc[]): { related: Set<string>; cited: Set<string> } {
  const idOf = new Map(docs.map((d) => [d.index, d.id]));
  const related = new Set<string>();
  const cited = new Set<string>();
  for (const a of docs) {
    for (const b of docs) {
      if (a.index < b.index && a.theme === b.theme) related.add(pairKey(a.id, b.id));
    }
    const refs = generatedDemoCrossReferences(a.index, COUNT);
    for (const target of [refs.prevInTheme, refs.nextInTheme, refs.partner]) {
      const targetId = idOf.get(target);
      if (!targetId || targetId === a.id) continue;
      cited.add(pairKey(a.id, targetId));
      related.add(pairKey(a.id, targetId));
    }
  }
  return { related, cited };
}

/** Mirror of the pipeline worker's analyzeText + the coordinator's lexical input. */
function lexicalInput(doc: CorpusDoc): LexicalDocInput {
  const { tf, total } = termFreq(tokenize(doc.text));
  return {
    id: doc.id,
    title: doc.title,
    fileName: doc.id,
    path: `demo/${doc.id}`,
    tf,
    phraseTf: extractPhraseTf(doc.text),
    totalTerms: total,
    textLower: doc.text.slice(0, MAX_EMBED_TEXT_BYTES).toLowerCase(),
    mdLinkTargets: [],
    entities: extractEntities(doc.text),
  };
}

/** Mirror of the pipeline worker's embedTexts + poolDocVector (WASM/q8 path). */
async function embedDocs(chunksPerDoc: string[][]): Promise<Float32Array> {
  const { pipeline, env } = await import('@huggingface/transformers');
  env.allowLocalModels = true;
  env.allowRemoteModels = false;
  env.localModelPath = MODEL_ROOT;
  const extractor = await pipeline('feature-extraction', EMBED_MODEL_ID, { dtype: 'q8', device: 'cpu' });
  const out = new Float32Array(chunksPerDoc.length * EMBED_DIMS);
  try {
    for (let d = 0; d < chunksPerDoc.length; d += 1) {
      const chunks = chunksPerDoc[d]!;
      const tensor = await extractor(chunks, { pooling: 'mean', normalize: true });
      const data = tensor.data as Float32Array;
      const docVector = out.subarray(d * EMBED_DIMS, (d + 1) * EMBED_DIMS);
      for (let c = 0; c < chunks.length; c += 1) {
        for (let k = 0; k < EMBED_DIMS; k += 1) docVector[k] += data[c * EMBED_DIMS + k]!;
      }
      let norm = 0;
      for (let k = 0; k < EMBED_DIMS; k += 1) norm += docVector[k]! * docVector[k]!;
      norm = Math.sqrt(norm);
      if (norm > 1e-12) for (let k = 0; k < EMBED_DIMS; k += 1) docVector[k]! /= norm;
      tensor.dispose();
    }
  } finally {
    await extractor.dispose();
  }
  return out;
}

async function runPipeline(docs: CorpusDoc[]): Promise<{ edges: Edge[]; clusters: Record<string, number> }> {
  const lexical = handleLexical({
    requestId: 0,
    type: 'lexical',
    docs: docs.map(lexicalInput),
    params: {
      tfidfTopN: TFIDF_TOP_N,
      minShared: KEYWORD_EDGE_MIN_SHARED,
      edgesPerDoc: KEYWORD_EDGES_PER_DOC,
      minTitleLen: MIN_MENTION_TITLE_LEN,
      entityMinShared: ENTITY_EDGE_MIN_SHARED,
      entityEdgesPerDoc: ENTITY_EDGES_PER_DOC,
    },
  });
  const titleEdges = buildTitleEdges(
    docs.map((d) => ({ id: d.id, kind: 'document', title: d.title }) as DocNode),
  );
  const lexEdges = [...lexical.edges, ...titleEdges];

  const boilerplate = new Set(lexical.boilerplateLines);
  const chunks = docs.map((d) => chunkText(stripBoilerplate(d.text, boilerplate)).chunks);
  const vectors = await embedDocs(chunks);
  const semantic = await handleSemantic({
    requestId: 0,
    type: 'semantic',
    ids: docs.map((d) => d.id),
    vectors,
    dims: EMBED_DIMS,
    existingEdges: lexEdges.map((e) => ({ source: e.source, target: e.target, weight: e.weight })),
    params: {
      threshold: SIM_THRESHOLD,
      topK: SIM_TOP_K,
      dupThreshold: DUP_SIM_THRESHOLD,
      relativeMargin: SIM_RELATIVE_MARGIN,
    },
  });
  return { edges: [...lexEdges, ...semantic.edges], clusters: semantic.clusters };
}

const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;
const row = (name: string, s: PRScore): string =>
  `  ${name.padEnd(10)} edges=${String(s.predicted).padStart(4)}  precision=${pct(s.precision).padStart(6)}  recall=${pct(s.recall).padStart(6)}  f1=${pct(s.f1).padStart(6)}`;

describe('graph accuracy on the generated demo corpus', () => {
  it('scores edges and clusters against the known themes and citations', { timeout: 180_000 }, async () => {
    const docs = buildCorpus();
    const { related, cited } = groundTruth(docs);
    const { edges, clusters } = await runPipeline(docs);

    const kinds = [...new Set(edges.map((e) => e.kind))].sort();
    const byKind = Object.fromEntries(
      kinds.map((kind) => [kind, scorePairs(edges.filter((e) => e.kind === kind), related)]),
    ) as Record<string, PRScore>;
    const overall = scorePairs(edges, related);
    // Citations alone recover every related pair here, which real corpora
    // rarely have; this row is what the inferred edge kinds find on their own.
    const inferred = scorePairs(edges.filter((e) => e.kind !== 'reference'), related);
    const references = scorePairs(edges.filter((e) => e.kind === 'reference'), cited);
    const clusterScore = scoreClusters(clusters, new Map(docs.map((d) => [d.id, d.theme])));

    process.stdout.write(
      [
        `Graph accuracy — ${COUNT} generated records, ${related.size} related pairs ` +
          `(SIM_THRESHOLD=${SIM_THRESHOLD}, SIM_TOP_K=${SIM_TOP_K}, CHUNK_TOKENS=${CHUNK_TOKENS})`,
        ...kinds.map((kind) => row(kind, byKind[kind]!)),
        row('all', overall),
        row('inferred', inferred) + '  (all edges except citations)',
        row('citations', references) + '  (reference edges vs explicit citations only)',
        `  clusters   ${clusterScore.clusters} found for ${clusterScore.classes} themes  ` +
          `purity=${pct(clusterScore.purity)}  inverse purity=${pct(clusterScore.inversePurity)}  NMI=${clusterScore.nmi.toFixed(3)}`,
      ].join('\n') + '\n',
    );

    // Every citation becomes a reference edge, and no reference edge is invented.
    expect(references.precision).toBe(1);
    expect(references.recall).toBe(1);
    // The graph as a whole connects every related pair...
    expect(overall.recall).toBeGreaterThanOrEqual(0.98);
    // ...and nearly every edge joins related records. Before the corpus-wide
    // entity caps and the relative semantic margin, about half did not
    // (precision 55%: entity edges on shared people/customer names, then
    // semantic top-k filler).
    expect(overall.precision).toBeGreaterThanOrEqual(0.9);
    expect(inferred.precision).toBeGreaterThanOrEqual(0.85);
    expect(inferred.recall).toBeGreaterThanOrEqual(0.55);
    expect(byKind.entity!.precision).toBeGreaterThanOrEqual(0.9);
    expect(byKind.semantic!.precision).toBeGreaterThanOrEqual(0.93);
    expect(byKind.keyword!.precision).toBeGreaterThanOrEqual(0.88);
    expect(byKind.title!.precision).toBe(1);
    // Themes are never split, and Louvain rarely merges two into one cluster.
    expect(clusterScore.inversePurity).toBeGreaterThanOrEqual(0.97);
    expect(clusterScore.purity).toBeGreaterThanOrEqual(0.9);
    expect(clusterScore.nmi).toBeGreaterThanOrEqual(0.97);
  });

  it('keeps the hand-labelled topics of the committed demo PDFs together', { timeout: 180_000 }, async () => {
    const docs = await loadDemoPdfs();
    expect(docs).toHaveLength(36 + COUNT);
    const { edges, clusters } = await runPipeline(docs);

    const pdf = (name: string): string => `${name}.pdf`;
    const together = new Set<string>();
    for (const group of Object.values(HELD_OUT_GROUPS)) {
      for (const a of group) for (const b of group) if (a < b) together.add(pairKey(pdf(a), pdf(b)));
    }
    const apart = new Set<string>();
    for (const [x, y] of HELD_OUT_UNRELATED) {
      for (const a of HELD_OUT_GROUPS[x]!) {
        for (const b of HELD_OUT_GROUPS[y]!) {
          const key = pairKey(pdf(a), pdf(b));
          if (a !== b && !together.has(key)) apart.add(key);
        }
      }
    }
    const linked = new Set(edges.map((e) => pairKey(e.source, e.target)));
    const coClustered = (key: string): boolean => {
      const [a, b] = key.split('|');
      return clusters[a!] === clusters[b!];
    };
    const count = (keys: Set<string>, test: (key: string) => boolean): number => [...keys].filter(test).length;
    const degree = new Map<string, number>();
    for (const key of linked) for (const id of key.split('|')) degree.set(id, (degree.get(id) ?? 0) + 1);
    const isolated = docs.filter((d) => !degree.has(d.id)).map((d) => d.id);

    const stats = {
      linkedTogether: count(together, (k) => linked.has(k)),
      clusteredTogether: count(together, coClustered),
      linkedApart: count(apart, (k) => linked.has(k)),
      clusteredApart: count(apart, coClustered),
    };
    process.stdout.write(
      `Held-out topics — ${together.size} same-topic pairs: ${stats.linkedTogether} linked, ` +
        `${stats.clusteredTogether} co-clustered; ${apart.size} unrelated pairs: ` +
        `${stats.linkedApart} linked, ${stats.clusteredApart} co-clustered; isolated docs: ${isolated.length}\n`,
    );

    // Before the link thresholds were tuned on the generated records, this
    // scored 17 linked and 24 co-clustered same-topic pairs, 1 linked and 4
    // co-clustered unrelated ones. The floors hold that line, with a pair or
    // two of slack for ONNX runtime drift.
    expect(isolated).toEqual([]);
    expect(stats.linkedTogether).toBeGreaterThanOrEqual(16);
    expect(stats.clusteredTogether).toBeGreaterThanOrEqual(22);
    expect(stats.linkedApart).toBeLessThanOrEqual(1);
    expect(stats.clusteredApart).toBeLessThanOrEqual(4);
  });
});

/**
 * Topic groups among the 36 committed demo PDFs, labelled by reading them
 * (a doc may sit in two groups). Pairs inside a group are related; pairs across
 * HELD_OUT_UNRELATED groups are not. Everything else is unlabelled: this
 * company's docs cross-reference each other freely.
 */
const HELD_OUT_GROUPS: Record<string, string[]> = {
  security: [
    'security-audit-report',
    'soc2-type2-audit-letter',
    'compliance-certificate-iso27001',
    'penetration-test-report',
    'vendor-review-notes',
    'data-privacy-policy',
    'gdpr-dpia-assessment',
  ],
  postgres: ['postgres-upgrade-plan', 'postgres-performance-tuning', 'migration-checklist', 'incident-post-mortem-2026-05'],
  incidents: [
    'oncall-handoff-notes',
    'incident-post-mortem-2026-05',
    'incident-2026-04-outage-report',
    'incident-response-training',
    'disaster-recovery-plan',
  ],
  people: ['hiring-plan-h2-2026', 'employee-benefits-overview', 'onboarding-checklist', 'team-offsite-summary'],
  performance: ['load-test-results', 'api-gateway-benchmark', 'capacity-planning-notes'],
  spend: ['vendor-contract-summary', 'cloud-cost-analysis', 'quarterly-business-review'],
};
const HELD_OUT_UNRELATED: [string, string][] = [
  ['people', 'security'],
  ['people', 'postgres'],
  ['people', 'performance'],
  ['people', 'incidents'],
  ['people', 'spend'],
  ['spend', 'postgres'],
  ['performance', 'security'],
];

/** The 100 demo PDFs (committed + generated), parsed with the app's pdf engine. */
async function loadDemoPdfs(): Promise<CorpusDoc[]> {
  // pdf.js's fake worker (Node has no Worker) picks this up instead of the
  // browser asset URL the engine configures; Node 22 also lacks Promise.try.
  const promise = Promise as unknown as { try?: unknown };
  promise.try ??= (fn: (...args: unknown[]) => unknown, ...args: unknown[]) =>
    new Promise((resolve) => resolve(fn(...args)));
  (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = await import(
    // @ts-expect-error -- untyped worker bundle
    'pdfjs-dist/build/pdf.worker.min.mjs'
  );
  const manifest = JSON.parse(readFileSync(join(DEMO_DIR, 'manifest.json'), 'utf-8')) as {
    files: string[];
    generated: { count: number };
  };
  const files = [
    ...manifest.files.map((name) => {
      const buf = readFileSync(join(DEMO_DIR, name));
      return { name, bytes: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer };
    }),
    ...createGeneratedDemoDocuments(manifest.generated.count).map((f) => ({ name: f.name, bytes: f.bytes })),
  ];
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {}); // pdf.js font noise
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    const docs: CorpusDoc[] = [];
    for (const file of files) {
      const parsed = await parsePdfEngine(file.bytes, file.name, { ocrMaxPages: 0, ocrLanguage: 'eng' });
      if (parsed.status === 'unreadable') throw new Error(`${file.name}: ${parsed.warning ?? 'unreadable'}`);
      docs.push({ id: file.name, title: parsed.title, text: parsed.text });
    }
    return docs;
  } finally {
    warn.mockRestore();
    log.mockRestore();
  }
}

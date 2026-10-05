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
 */

import { describe, expect, it } from 'vitest';
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
  SIM_THRESHOLD,
  SIM_TOP_K,
  TFIDF_TOP_N,
} from '../config';
import {
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
import { extractPhraseTf } from '../pipeline/phrases';
import { termFreq, tokenize } from '../pipeline/tokenize';
import { handleLexical, handleSemantic } from '../workers/aggregatorHandlers';
import { pairKey, scoreClusters, scorePairs, type PRScore } from './graphAccuracy';

const COUNT = GENERATED_DEMO_DOCUMENT_COUNT;
const MODEL_ROOT = new URL('../../public/models/', import.meta.url).pathname;

interface EvalDoc {
  id: string;
  index: number;
  theme: string;
  text: string;
  title: string;
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
function lexicalInput(doc: EvalDoc): LexicalDocInput {
  const { tf, total } = termFreq(tokenize(doc.text));
  return {
    id: doc.id,
    title: doc.title,
    fileName: doc.id,
    path: `demo/generated/${doc.id}`,
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

async function runPipeline(docs: EvalDoc[]): Promise<{ edges: Edge[]; clusters: Record<string, number> }> {
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
    params: { threshold: SIM_THRESHOLD, topK: SIM_TOP_K, dupThreshold: DUP_SIM_THRESHOLD },
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
    const references = scorePairs(edges.filter((e) => e.kind === 'reference'), cited);
    const clusterScore = scoreClusters(clusters, new Map(docs.map((d) => [d.id, d.theme])));

    process.stdout.write(
      [
        `Graph accuracy — ${COUNT} generated records, ${related.size} related pairs ` +
          `(SIM_THRESHOLD=${SIM_THRESHOLD}, SIM_TOP_K=${SIM_TOP_K}, CHUNK_TOKENS=${CHUNK_TOKENS})`,
        ...kinds.map((kind) => row(kind, byKind[kind]!)),
        row('all', overall),
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
    // ...but about half its edges join unrelated records (mostly entity edges
    // on shared people/customer names, then semantic top-k filler).
    expect(overall.precision).toBeGreaterThanOrEqual(0.52);
    expect(byKind.semantic!.precision).toBeGreaterThanOrEqual(0.6);
    expect(byKind.keyword!.precision).toBeGreaterThanOrEqual(0.88);
    expect(byKind.title!.precision).toBe(1);
    // Themes are never split, but Louvain merges some into shared clusters.
    expect(clusterScore.inversePurity).toBeGreaterThanOrEqual(0.97);
    expect(clusterScore.purity).toBeGreaterThanOrEqual(0.62);
    expect(clusterScore.nmi).toBeGreaterThanOrEqual(0.89);
  });
});

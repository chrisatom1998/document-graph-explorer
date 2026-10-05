/**
 * The 30-query retrieval benchmark (src/dev/retrievalBenchmarkCases.ts), run
 * under `npm test` against the real demo corpus with real embeddings.
 *
 * Mirrors the ingest path end to end, minus the workers: the 36 committed demo
 * PDFs plus the 64 generated records are parsed with the app's pdf engine,
 * boilerplate-stripped and chunked with the app's chunker, and embedded with
 * the bundled bge-small-en-v1.5 (q8, mean pooling, normalized — the WASM
 * backend's settings) through the Node build of transformers.js. Queries get
 * the same retrieval prefix the app sends. The whole run takes ~10 s.
 *
 * It guards two things: ranking quality (Recall@5, MRR@10, critical queries)
 * and the semantic score floor — off-topic queries must find no semantic
 * evidence, so search can say "no match" instead of padding results.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { env, pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';

vi.mock('../pipeline/coordinator', () => ({
  embedQuery: vi.fn().mockRejectedValue(new Error('the benchmark injects its own embedder')),
}));

import { embeddingQueryText } from '../ai/embeddingPolicy';
import { EMBED_DIMS, EMBED_MODEL_ID, QUERY_MIN_SEMANTIC_SCORE } from '../config';
import { createGeneratedDemoDocuments } from '../demo/generatedDocuments';
import {
  RETRIEVAL_BENCHMARK_CASES,
  SCORE_FLOOR_CALIBRATION_QUERIES,
} from '../dev/retrievalBenchmarkCases';
import type { DocNode } from '../model/types';
import { findBoilerplateLines, stripBoilerplate } from '../pipeline/boilerplate';
import { chunkText } from '../pipeline/chunker';
import { parsePdfEngine } from '../pipeline/parsers/pdfEngine';
import type { ChunkData } from '../store/runtimeStores';
import { retrieveCorpus, type RetrievalDependencies, type RetrievalHit } from './retrieval';
import { benchmarkMetrics, type BenchmarkCaseResult } from './retrievalBenchmark';

const ROOT = join(__dirname, '../..');
const DEMO_DIR = join(ROOT, 'public/demo');

// Measured on this corpus when the floor was calibrated: Recall@5 0.958,
// MRR@10 0.979, critical 6/6. Small slack absorbs ONNX runtime drift.
const MIN_RECALL_AT_5 = 0.95;
const MIN_MRR_AT_10 = 0.97;

const OFF_TOPIC_QUERIES = [
  ...RETRIEVAL_BENCHMARK_CASES.filter((c) => c.expectedFiles.length === 0).map((c) => c.query),
  ...SCORE_FLOOR_CALIBRATION_QUERIES,
];

let deps: RetrievalDependencies;
let fileById: Map<string, string>;

async function loadCorpus(): Promise<{ docs: { file: string; title: string; chunks: string[] }[] }> {
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
  const parsed = [];
  try {
    for (const file of files) {
      const pdf = await parsePdfEngine(file.bytes, file.name, { ocrMaxPages: 0, ocrLanguage: 'eng' });
      if (pdf.status === 'unreadable') throw new Error(`${file.name}: ${pdf.warning ?? 'unreadable'}`);
      parsed.push({ file: file.name, title: pdf.title, text: pdf.text });
    }
  } finally {
    warn.mockRestore();
    log.mockRestore();
  }
  const boilerplate = findBoilerplateLines(parsed.map((doc) => doc.text.split('\n')));
  return {
    docs: parsed.map((doc) => ({
      file: doc.file,
      title: doc.title,
      chunks: chunkText(stripBoilerplate(doc.text, boilerplate)).chunks,
    })),
  };
}

async function embed(extractor: FeatureExtractionPipeline, texts: string[]): Promise<Float32Array> {
  const out = new Float32Array(texts.length * EMBED_DIMS);
  for (let start = 0; start < texts.length; start += 16) {
    const tensor = await extractor(texts.slice(start, start + 16), { pooling: 'mean', normalize: true });
    out.set(tensor.data as Float32Array, start * EMBED_DIMS);
    tensor.dispose();
  }
  return out;
}

function documentNode(id: string, title: string): DocNode {
  return {
    id, title, kind: 'document', fileType: 'pdf', topics: [], entities: [], keywords: [],
    wordCount: 0, cluster: 0, degree: 0, status: 'ok',
  };
}

beforeAll(async () => {
  const { docs } = await loadCorpus();
  env.allowLocalModels = true;
  env.allowRemoteModels = false;
  env.localModelPath = join(ROOT, 'public/models/');
  const extractor = await pipeline('feature-extraction', EMBED_MODEL_ID, { dtype: 'q8' });

  const chunks = new Map<string, ChunkData>();
  fileById = new Map();
  const nodes = docs.map((doc, index) => {
    const id = `doc-${index}`;
    fileById.set(id, doc.file);
    return documentNode(id, doc.title);
  });
  for (const [index, doc] of docs.entries()) {
    chunks.set(`doc-${index}`, { texts: doc.chunks, vectors: await embed(extractor, doc.chunks), dims: EMBED_DIMS });
  }
  const queries = [...new Set([...RETRIEVAL_BENCHMARK_CASES.map((c) => c.query), ...OFF_TOPIC_QUERIES])];
  const queryVectors = await embed(extractor, queries.map((q) => embeddingQueryText(q, 'english')));
  const vectorByQuery = new Map(
    queries.map((q, i) => [q, queryVectors.slice(i * EMBED_DIMS, (i + 1) * EMBED_DIMS)]),
  );
  deps = {
    nodes,
    chunks,
    docVectors: new Map(),
    texts: new Map(),
    embedQuery: async (q) => vectorByQuery.get(q) ?? Promise.reject(new Error(`unembedded query: ${q}`)),
  };
}, 180_000);

/** Same options and per-document ranking as the in-app benchmark panel. */
function search(query: string): Promise<RetrievalHit[]> {
  return retrieveCorpus(query, { limit: 4096, perDocument: 256, timeoutMs: 0 }, deps);
}

function rankedFiles(hits: RetrievalHit[]): string[] {
  return [...new Set(hits.map((hit) => fileById.get(hit.docId)!))];
}

describe('retrieval benchmark on the demo corpus', () => {
  it('parses all 100 demo documents', () => {
    expect(deps.nodes).toHaveLength(100);
  });

  it('keeps Recall@5, MRR@10 and every critical query', async () => {
    const results: BenchmarkCaseResult[] = [];
    for (const c of RETRIEVAL_BENCHMARK_CASES) {
      results.push({
        id: c.id,
        category: c.category,
        query: c.query,
        expectedFiles: c.expectedFiles,
        rankedFiles: rankedFiles(await search(c.query)),
        latencyMs: 0,
        critical: c.critical ?? false,
      });
    }
    const metrics = benchmarkMetrics(results);
    expect(metrics.recallAt5).toBeGreaterThanOrEqual(MIN_RECALL_AT_5);
    expect(metrics.mrrAt10).toBeGreaterThanOrEqual(MIN_MRR_AT_10);
    expect(metrics.criticalAccuracy).toBe(1);
  });

  it.each(OFF_TOPIC_QUERIES)('finds no semantic match for off-topic query: %s', async (query) => {
    const semanticHits = (await search(query)).filter((hit) => hit.semanticScore !== undefined);
    expect(semanticHits.map((hit) => `${fileById.get(hit.docId)} ${hit.semanticScore!.toFixed(3)}`)).toEqual([]);
  });

  it('sits the floor above every off-topic query and below every answerable one', async () => {
    const bestScore = async (query: string, files?: string[]) => {
      const hits = await retrieveCorpus(query, { limit: 4096, perDocument: 256, timeoutMs: 0, minSemanticScore: -1 }, deps);
      return Math.max(...hits
        .filter((hit) => !files || files.includes(fileById.get(hit.docId)!))
        .map((hit) => hit.semanticScore ?? -1));
    };
    const offTopic = Math.max(...await Promise.all(OFF_TOPIC_QUERIES.map((q) => bestScore(q))));
    // Paraphrase questions have no lexical fallback, so the floor must not cut them.
    const paraphrase = await Promise.all(RETRIEVAL_BENCHMARK_CASES
      .filter((c) => c.category === 'paraphrase')
      .map((c) => bestScore(c.query, c.expectedFiles)));
    expect(offTopic).toBeLessThan(QUERY_MIN_SEMANTIC_SCORE);
    expect(Math.min(...paraphrase)).toBeGreaterThanOrEqual(QUERY_MIN_SEMANTIC_SCORE);
  });
});

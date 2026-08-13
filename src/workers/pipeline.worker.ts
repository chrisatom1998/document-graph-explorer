/**
 * Pipeline worker: parse (txt/md/html — NEVER pdf, which runs on the main
 * thread), analyze pre-extracted text, and bge-small-en-v1.5 embeddings via
 * transformers.js. One of POOL_SIZE instances managed by WorkerPool.
 */

// NOTE: @huggingface/transformers is imported DYNAMICALLY (see getExtractor).
// A top-level import would put its huge module graph on the worker's boot
// path: parse requests would wait on it, and in dev a failure inside that
// graph kills the worker before onmessage registers ("stuck parsing").
import type { FeatureExtractionPipeline, Tensor } from '@huggingface/transformers';
import { EMBED_DIMS, EMBED_MODEL_ID } from '../config';
import type { LinkRef, NodeStatus, ParsedDoc, PoolRequest, PoolResponse } from '../model/types';
import { extractEntities } from '../pipeline/entities';
import { extractPhraseTf } from '../pipeline/phrases';
import { summarize } from '../pipeline/summarize';
import { tokenize, termFreq } from '../pipeline/tokenize';
import { extractCodeSymbols, parseCode } from '../pipeline/parsers/code';
import { parseHtml } from '../pipeline/parsers/html';
import { parseMarkdown } from '../pipeline/parsers/markdown';
import { parseOffice } from '../pipeline/parsers/office';
import { parseTxt, type ParserResult } from '../pipeline/parsers/txt';

declare const self: DedicatedWorkerGlobalScope;

function respond(msg: PoolResponse, transfer?: Transferable[]): void {
  if (transfer && transfer.length > 0) self.postMessage(msg, transfer);
  else self.postMessage(msg);
}

// ---------------------------------------------------------------------------
// parse / analyze
// ---------------------------------------------------------------------------

function analyzeText(
  text: string,
  title: string,
  headings: string[],
  mdLinkTargets: string[],
  docLinks: LinkRef[],
  status: NodeStatus,
  warning?: string,
): ParsedDoc {
  const tokens = tokenize(text);
  const { tf, total } = termFreq(tokens);
  const phraseTf = extractPhraseTf(text);
  let wordCount = 0;
  for (const word of text.split(/\s+/)) if (word.length > 0) wordCount += 1;
  return {
    contentHash: '', // the coordinator supplies the content id
    title,
    text,
    wordCount,
    headings,
    mdLinkTargets,
    docLinks,
    entities: extractEntities(text),
    tf,
    phraseTf,
    totalTerms: total,
    chunks: [], // the coordinator chunks after corpus-wide boilerplate strip
    summary: summarize(text),
    status,
    warning,
  };
}

async function runParser(req: Extract<PoolRequest, { type: 'parse' }>): Promise<ParserResult> {
  switch (req.fileType) {
    case 'md':
      return parseMarkdown(req.bytes, req.name);
    case 'html':
      return parseHtml(req.bytes, req.name);
    case 'docx':
    case 'pptx':
    case 'xlsx':
      return parseOffice(req.bytes, req.name, req.fileType);
    case 'txt':
    case 'json':
    case 'yaml':
    case 'csv':
    case 'other':
      return parseTxt(req.bytes, req.name);
    case 'code':
      return parseCode(req.bytes, req.name);
    case 'pdf':
      throw new Error('PDF parsing runs on the main thread (pdf.js owns its own worker)');
    default:
      throw new Error(`Unknown fileType: ${String(req.fileType)}`);
  }
}

// ---------------------------------------------------------------------------
// embeddings
// ---------------------------------------------------------------------------

const EMBED_BATCH_SIZE = 8;

/**
 * Backend choice. WebGPU runs bge-small ~5-10x faster than WASM, but the WebGPU
 * execution provider has no kernels for the q8 model's integer ops
 * (MatMulInteger & co. would silently fall back to CPU with device round-trips,
 * ending up SLOWER than plain WASM) — so the GPU path uses the fp16 weights
 * and requires the adapter's 'shader-f16' feature. Anything else → WASM + q8.
 */
interface WebGpuAdapterLike {
  features: { has(name: string): boolean };
}

async function pickBackend(): Promise<{ device: 'webgpu' | 'wasm'; dtype: 'fp16' | 'q8' }> {
  try {
    const gpu = (navigator as { gpu?: { requestAdapter(): Promise<WebGpuAdapterLike | null> } })
      .gpu;
    if (gpu) {
      const adapter = await gpu.requestAdapter();
      if (adapter?.features.has('shader-f16')) return { device: 'webgpu', dtype: 'fp16' };
    }
  } catch {
    /* detection failure = no WebGPU */
  }
  return { device: 'wasm', dtype: 'q8' };
}

let extractorPromise: Promise<FeatureExtractionPipeline> | null = null;
let webgpuFailed = false; // a GPU that detects but can't run the model → pin to WASM

const MODEL_FILE_BY_DTYPE = { fp16: 'model_fp16.onnx', q8: 'model_quantized.onnx' } as const;

/**
 * Warm the HTTP cache for the model's files with a plain streaming fetch,
 * reporting download progress from our own read loop.
 *
 * We must never hand transformers.js a progress_callback: its with-progress
 * download path re-allocates and copies its whole buffer on every chunk when
 * the response carries no content-length, and production hosts (Vercel,
 * `vite preview`) serve the .onnx compressed, which strips content-length.
 * That O(n²) loop stalls the read until Chromium kills the stream with a
 * bare "TypeError: network error" — deterministically, on every cold load.
 * Without a callback transformers uses one arrayBuffer() read, which is
 * safe; it re-reads the files we warmed here from the HTTP cache.
 */
async function prefetchModelAssets(dtype: keyof typeof MODEL_FILE_BY_DTYPE): Promise<void> {
  const base = `/models/${EMBED_MODEL_ID}/`;
  const onnxPath = `${base}onnx/${MODEL_FILE_BY_DTYPE[dtype]}`;
  await Promise.all(
    ['config.json', 'tokenizer.json', 'tokenizer_config.json'].map((f) =>
      fetch(base + f).then((r) => r.arrayBuffer()),
    ),
  );
  // Compressed responses carry no usable content-length, but content-range on
  // a 1-byte probe always reports the full entity size for the progress bar.
  let total = 0;
  try {
    const probe = await fetch(onnxPath, { headers: { Range: 'bytes=0-0' } });
    const size = probe.headers.get('content-range')?.match(/\/(\d+)$/);
    if (probe.status === 206 && size) total = Number(size[1]);
    await probe.body?.cancel();
  } catch {
    /* progress falls back to bytes-only */
  }
  const res = await fetch(onnxPath);
  if (!res.ok || !res.body) throw new Error(`model prefetch failed: HTTP ${res.status}`);
  const reader = res.body.getReader();
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    loaded += value.length;
    respond({ requestId: -1, type: 'model:progress', loaded, total, note: onnxPath });
  }
}

async function createExtractor(): Promise<FeatureExtractionPipeline> {
  const { pipeline, env } = await import('@huggingface/transformers');
  // PRIVACY (audit H-1): transformers.js defaults ORT's wasmPaths to
  // cdn.jsdelivr.net — executable code from a third-party CDN inside the
  // worker that holds all document text, and a hard offline breaker.
  // Resetting it makes ORT fall back to its import.meta.url resolution,
  // which Vite bundles as a same-origin asset.
  if (env?.backends?.onnx?.wasm) {
    env.backends.onnx.wasm.wasmPaths = undefined;
  }
  // ZERO NETWORK: the model ships in /public/models — never touch HF Hub.
  // allowLocalModels defaults to false in browser builds, so set it
  // explicitly; allowRemoteModels=false turns any accidental remote fetch
  // into a hard error (and the production CSP no longer allows HF anyway).
  env.allowLocalModels = true;
  env.allowRemoteModels = false;
  env.localModelPath = '/models/';

  const build = async (backend: { device: 'webgpu' | 'wasm'; dtype: 'fp16' | 'q8' }) => {
    try {
      await prefetchModelAssets(backend.dtype);
    } catch (err) {
      // Progress UX only — transformers fetches the files itself either way.
      console.warn('model prefetch failed; loading without progress', err);
    }
    return pipeline('feature-extraction', EMBED_MODEL_ID, {
      device: backend.device,
      dtype: backend.dtype,
    });
  };

  const backend = webgpuFailed ? { device: 'wasm' as const, dtype: 'q8' as const } : await pickBackend();
  try {
    return await build(backend);
  } catch (err) {
    if (backend.device !== 'webgpu') throw err;
    // Adapter advertised support but session creation failed — fall back.
    webgpuFailed = true;
    console.warn('WebGPU embedding backend failed, falling back to WASM:', err);
    return build({ device: 'wasm', dtype: 'q8' });
  }
}

function getExtractor(): Promise<FeatureExtractionPipeline> {
  if (!extractorPromise) {
    extractorPromise = createExtractor();
    // allow a retry after a failed model load (e.g. missing/corrupt local files)
    extractorPromise.catch(() => {
      extractorPromise = null;
    });
  }
  return extractorPromise;
}

/** Embed texts in batches; returns flattened unit vectors [n * EMBED_DIMS]. */
async function embedTexts(texts: string[]): Promise<Float32Array> {
  const extractor = await getExtractor();
  const out = new Float32Array(texts.length * EMBED_DIMS);
  for (let start = 0; start < texts.length; start += EMBED_BATCH_SIZE) {
    const batch = texts.slice(start, start + EMBED_BATCH_SIZE);
    const tensor: Tensor = await extractor(batch, { pooling: 'mean', normalize: true });
    const dims = tensor.dims;
    const cols = dims[dims.length - 1];
    if (cols !== EMBED_DIMS) {
      throw new Error(`Unexpected embedding dims ${dims.join('x')}, expected ${EMBED_DIMS}`);
    }
    const data = tensor.data;
    if (!(data instanceof Float32Array)) {
      // e.g. raw float16 output — copying it as-is would be silent garbage
      throw new Error(`Unexpected embedding dtype ${data.constructor.name}`);
    }
    out.set(data.subarray(0, batch.length * EMBED_DIMS), start * EMBED_DIMS);
    tensor.dispose();
  }
  return out;
}

/** Mean-pool a document's chunk vectors into a single unit vector. */
function poolDocVector(chunkVectors: Float32Array, nChunks: number): Float32Array {
  const docVector = new Float32Array(EMBED_DIMS);
  for (let c = 0; c < nChunks; c += 1) {
    const offset = c * EMBED_DIMS;
    for (let d = 0; d < EMBED_DIMS; d += 1) docVector[d] += chunkVectors[offset + d];
  }
  if (nChunks > 0) {
    let norm = 0;
    for (let d = 0; d < EMBED_DIMS; d += 1) {
      docVector[d] /= nChunks;
      norm += docVector[d] * docVector[d];
    }
    norm = Math.sqrt(norm);
    if (norm > 1e-12) {
      for (let d = 0; d < EMBED_DIMS; d += 1) docVector[d] /= norm;
    }
  }
  return docVector;
}

async function handleEmbed(req: Extract<PoolRequest, { type: 'embed' }>): Promise<void> {
  const chunkVectors = await embedTexts(req.chunks);
  const nChunks = req.chunks.length;
  const docVector = poolDocVector(chunkVectors, nChunks);
  respond(
    {
      requestId: req.requestId,
      type: 'embed:done',
      docId: req.docId,
      docVector,
      chunkVectors,
      nChunks,
    },
    [docVector.buffer, chunkVectors.buffer],
  );
}

/**
 * Batched embedding: pack every document's chunks into one flat list, embed
 * in model-sized batches (so single-chunk docs share a batch instead of each
 * paying a full inference call), then slice each doc's chunk vectors back out
 * and mean-pool its doc vector. One worker round trip for many documents.
 */
async function handleEmbedBatch(
  req: Extract<PoolRequest, { type: 'embedBatch' }>,
): Promise<void> {
  const allChunks: string[] = [];
  for (const doc of req.docs) for (const chunk of doc.chunks) allChunks.push(chunk);

  const allVectors = allChunks.length > 0 ? await embedTexts(allChunks) : new Float32Array(0);

  const transfer: Transferable[] = [];
  let offset = 0;
  const docs = req.docs.map((doc) => {
    const nChunks = doc.chunks.length;
    // Copy this doc's slice into its own buffer so each can be transferred
    // back independently (a subarray view can't be detached on its own).
    const chunkVectors = allVectors.slice(
      offset * EMBED_DIMS,
      (offset + nChunks) * EMBED_DIMS,
    );
    offset += nChunks;
    const docVector = poolDocVector(chunkVectors, nChunks);
    transfer.push(docVector.buffer, chunkVectors.buffer);
    return { docId: doc.docId, docVector, chunkVectors, nChunks };
  });

  respond({ requestId: req.requestId, type: 'embedBatch:done', docs }, transfer);
}

// ---------------------------------------------------------------------------
// dispatch
// ---------------------------------------------------------------------------

async function handle(req: PoolRequest): Promise<void> {
  try {
    switch (req.type) {
      case 'parse': {
        const parsed = await runParser(req);
        const doc = analyzeText(
          parsed.text,
          parsed.title,
          parsed.headings,
          parsed.mdLinkTargets,
          parsed.docLinks,
          parsed.status,
          parsed.warning,
        );
        respond({ requestId: req.requestId, type: 'parse:done', fileId: req.fileId, doc });
        break;
      }
      case 'analyze': {
        // pre-extracted text (pdf path + cache backfill): tokenize/entities/
        // wordCount only, echoing the given title/status/warning. docLinks for
        // pdf come from parsePdf on the main thread, so the worker leaves them
        // empty. Code files re-derive their defined symbols from the text so
        // cache-hydrated corpora keep symbol-mention edges.
        const headings =
          req.fileType === 'code' ? extractCodeSymbols(req.text, req.name) : [];
        const doc = analyzeText(req.text, req.title, headings, [], [], req.status, req.warning);
        respond({ requestId: req.requestId, type: 'parse:done', fileId: req.fileId, doc });
        break;
      }
      case 'embed': {
        await handleEmbed(req);
        break;
      }
      case 'embedBatch': {
        await handleEmbedBatch(req);
        break;
      }
      case 'embedQuery': {
        const vector = await embedTexts([req.text]);
        respond({ requestId: req.requestId, type: 'embedQuery:done', vector }, [vector.buffer]);
        break;
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // The pool surfaces only `message` to the UI; without the stack a
    // runtime-generated error (e.g. a bare "network error" TypeError from a
    // failed fetch inside ORT) is undiagnosable from the console alone.
    console.error(`[pipeline.worker] ${req.type} failed:`, err);
    const fileId =
      req.type === 'parse' || req.type === 'analyze'
        ? req.fileId
        : req.type === 'embed'
          ? req.docId
          : undefined;
    respond({ requestId: req.requestId, type: 'error', message, fileId });
  }
}

self.onmessage = (ev: MessageEvent<PoolRequest>) => {
  void handle(ev.data);
};

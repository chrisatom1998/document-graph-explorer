/**
 * Pipeline worker: parse (txt/md/html — NEVER pdf, which runs on the main
 * thread), analyze pre-extracted text, and bge-small-en-v1.5 embeddings via
 * transformers.js. One of POOL_SIZE instances managed by WorkerPool.
 */

// NOTE: @huggingface/transformers is imported DYNAMICALLY (see getExtractor).
// A top-level import would put its huge module graph on the worker's boot
// path: parse requests would wait on it, and in dev a failure inside that
// graph kills the worker before onmessage registers ("stuck parsing").
import type {
  FeatureExtractionPipeline,
  ProgressInfo,
  Tensor,
} from '@huggingface/transformers';
import { EMBED_DIMS, EMBED_MODEL_ID } from '../config';
import type { LinkRef, NodeStatus, ParsedDoc, PoolRequest, PoolResponse } from '../model/types';
import { extractEntities } from '../pipeline/entities';
import { tokenize, termFreq } from '../pipeline/tokenize';
import { parseHtml } from '../pipeline/parsers/html';
import { parseMarkdown } from '../pipeline/parsers/markdown';
import { parseOffice } from '../pipeline/parsers/office';
import { parseTxt, type ParserResult } from '../pipeline/parsers/txt';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

function respond(msg: PoolResponse, transfer?: Transferable[]): void {
  if (transfer && transfer.length > 0) ctx.postMessage(msg, transfer);
  else ctx.postMessage(msg);
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
    totalTerms: total,
    chunks: [], // the coordinator chunks after corpus-wide boilerplate strip
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

  const build = async (backend: { device: 'webgpu' | 'wasm'; dtype: 'fp16' | 'q8' }) =>
    pipeline('feature-extraction', EMBED_MODEL_ID, {
      device: backend.device,
      dtype: backend.dtype,
      progress_callback: (p: ProgressInfo) => {
        if (p.status === 'progress') {
          respond({
            requestId: -1,
            type: 'model:progress',
            loaded: p.loaded,
            total: p.total,
            note: p.file,
          });
        }
      },
    });

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

async function handleEmbed(req: Extract<PoolRequest, { type: 'embed' }>): Promise<void> {
  const chunkVectors = await embedTexts(req.chunks);
  const nChunks = req.chunks.length;
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
        // pre-extracted text (pdf path): tokenize/entities/wordCount only,
        // echoing the given title/status/warning. docLinks for pdf come from
        // parsePdf on the main thread, so the worker leaves them empty.
        const doc = analyzeText(req.text, req.title, [], [], [], req.status, req.warning);
        respond({ requestId: req.requestId, type: 'parse:done', fileId: req.fileId, doc });
        break;
      }
      case 'embed': {
        await handleEmbed(req);
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
    const fileId =
      req.type === 'parse' || req.type === 'analyze'
        ? req.fileId
        : req.type === 'embed'
          ? req.docId
          : undefined;
    respond({ requestId: req.requestId, type: 'error', message, fileId });
  }
}

ctx.onmessage = (ev: MessageEvent<PoolRequest>) => {
  void handle(ev.data);
};

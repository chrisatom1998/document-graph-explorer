/** Central tunables. Every threshold the spec names lives here. */

// --- Extraction (spec §5) ---
export const SIM_THRESHOLD = 0.62; // semantic edge: cosine similarity floor
export const SIM_TOP_K = 5; //         ...AND within each doc's top-k neighbors
export const TFIDF_TOP_N = 15; // keywords kept per document
export const KEYWORD_EDGE_MIN_SHARED = 2; // shared rare keywords to form a keyword edge
export const KEYWORD_EDGES_PER_DOC = 5; // cap keyword edges per doc (anti-hairball)
export const ENTITY_EDGE_MIN_SHARED = 2; // shared named entities to form an entity edge
export const ENTITY_EDGES_PER_DOC = 4; // cap entity edges per doc (anti-hairball)
export const TOPIC_MIN_DOCS = 2; // docs sharing a topic before it becomes a hub
export const TOPIC_MAX_DOC_FRACTION = 0.33; // drop topics carried by >⅓ of the corpus
// BGE small supports longer inputs than the old MiniLM default, but keep chunks
// compact: smaller evidence windows improve retrieval precision and chat grounding.
export const CHUNK_TOKENS = 192; // conservative ~wordpiece budget per chunk
export const CHUNK_OVERLAP = 0.15; // 15% overlap between chunks
export const MAX_EMBED_TEXT_BYTES = 200 * 1024; // cap text used for embedding (spec §4.3)
export const MIN_MENTION_TITLE_LEN = 5; // ignore very short titles for mention matching

// --- Embedding model ---
export const EMBED_MODEL_ID = 'Xenova/bge-small-en-v1.5';
export const EMBED_DIMS = 384;
export const EMBED_QUERY_PREFIX = 'Represent this sentence for searching relevant passages: ';
// Bump automatically whenever a setting that changes vector meaning changes.
// Persisted vectors must never be mixed with queries from another profile.
export const EMBEDDING_FINGERPRINT = [
  EMBED_MODEL_ID,
  `dims=${EMBED_DIMS}`,
  'pooling=mean',
  'normalize=true',
  `chunkTokens=${CHUNK_TOKENS}`,
  `overlap=${CHUNK_OVERLAP}`,
].join('|');

// --- Optional cloud AI (Gemini; model routing lives in ai/geminiModels.ts) ---
export const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
export const ENRICH_BATCH_SIZE = 15; // docs per request (spec says 10–20)
export const ENRICH_MAX_RETRIES = 3;
// Kept far below Gemini's context limit. Large documents are selected by
// relevant/representative sections before they leave the browser.
export const DOCUMENT_AI_MAX_CONTEXT_CHARS = 240_000;

// --- Search ---
export const SEARCH_MIN_SCORE = 0.35; // semantic search relevance floor
export const SEARCH_MAX_RESULTS = 12;

// --- Extractive (local, no-LLM) chat answers ---
export const EXTRACT_MAX_PASSAGES = 4; // distinct-doc passages shown in a local answer
export const EXTRACT_PASSAGE_CHARS = 600; // per-passage verbatim quote cap
export const SOURCE_SNIPPET_CHARS = 200; // citation-chip preview length (chat + extractive answers)

// --- Insights ---
export const DUP_SIM_THRESHOLD = 0.93; // cosine sim above which two docs are "possible duplicates"
export const STALE_DOC_DAYS = 180; // file mtime older than this -> "stale doc" insight
export const BRIDGE_TOP_N = 8; // bridge documents surfaced in the insights panel
export const BRIDGE_MIN_SCORE = 0.05; // normalized betweenness floor for a "bridge"
export const BRIDGE_MAX_PIVOTS = 512; // sample sources above this corpus size (approx. betweenness)

// --- Layout / render budgets (spec §7) ---
export const MAX_NODES = 4096; // instanced mesh capacity
export const LABEL_BUDGET = 40; // nearest-N labels rendered
export const FRAME_BUDGET_MS = 22; // auto-quality trip threshold
export const FRAME_BUDGET_SUSTAIN_MS = 2000; // ...sustained this long before degrading
export const CAMERA_GLIDE_MS = 800;
export const MINIMAP_MIN_NODES = 20; // corner minimap appears at this corpus size

// --- Ingestion ---
// Files are read fully into memory (and their text persisted to IndexedDB);
// without a cap a single multi-GB drop freezes or crashes the tab.
export const MAX_INGEST_FILE_BYTES = 64 * 1024 * 1024;
// The per-file cap alone doesn't stop a folder of many large-but-legal files
// from exhausting tab memory — cap the whole drop too.
export const MAX_INGEST_TOTAL_BYTES = 512 * 1024 * 1024;
export const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  'dist',
  'build',
  '__pycache__',
  '.next',
  '.venv',
  'venv',
]);
export const POOL_SIZE = Math.max(
  1,
  Math.min(6, (typeof navigator !== 'undefined' ? (navigator.hardwareConcurrency ?? 4) : 4) - 1),
);

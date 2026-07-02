/** Central tunables. Every threshold the spec names lives here. */

// --- Extraction (spec §5) ---
export const SIM_THRESHOLD = 0.62; // semantic edge: cosine similarity floor
export const SIM_TOP_K = 5; //         ...AND within each doc's top-k neighbors
export const TFIDF_TOP_N = 15; // keywords kept per document
export const KEYWORD_EDGE_MIN_SHARED = 2; // shared rare keywords to form a keyword edge
export const KEYWORD_EDGES_PER_DOC = 5; // cap keyword edges per doc (anti-hairball)
export const CHUNK_TOKENS = 512; // ~tokens per embedding chunk
export const CHUNK_OVERLAP = 0.15; // 15% overlap between chunks
export const MAX_EMBED_TEXT_BYTES = 200 * 1024; // cap text used for embedding (spec §4.3)
export const MIN_MENTION_TITLE_LEN = 5; // ignore very short titles for mention matching

// --- Embedding model ---
export const EMBED_MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
export const EMBED_DIMS = 384;

// --- Enrichment (user choice: Gemini) ---
export const GEMINI_MODEL = 'gemini-3.5-flash'; // configurable default; override in Settings
export const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
export const ENRICH_BATCH_SIZE = 15; // docs per request (spec says 10–20)
export const ENRICH_MAX_RETRIES = 3;

// --- Search ---
export const SEARCH_MIN_SCORE = 0.35; // semantic search relevance floor
export const SEARCH_MAX_RESULTS = 12;

// --- Insights ---
export const DUP_SIM_THRESHOLD = 0.93; // cosine sim above which two docs are "possible duplicates"
export const BRIDGE_TOP_N = 8; // bridge documents surfaced in the insights panel
export const BRIDGE_MIN_SCORE = 0.05; // normalized betweenness floor for a "bridge"
export const BRIDGE_MAX_PIVOTS = 512; // sample sources above this corpus size (approx. betweenness)

// --- Layout / render budgets (spec §7) ---
export const MAX_NODES = 4096; // instanced mesh capacity
export const LABEL_BUDGET = 40; // nearest-N labels rendered
export const FRAME_BUDGET_MS = 22; // auto-quality trip threshold
export const FRAME_BUDGET_SUSTAIN_MS = 2000; // ...sustained this long before degrading
export const CAMERA_GLIDE_MS = 800;

// --- Ingestion ---
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

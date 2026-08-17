/** Max chunks included as context in "most relevant" chat. */
export const RAG_TOP_K = 8;
/** Cosine floor for relevant-mode retrieval. */
export const RAG_MIN_SCORE = 0.3;
/** Avoid one long document crowding out the corpus in relevant mode. */
export const RAG_MAX_CHUNKS_PER_DOC = 2;
/** Max chars per chunk in the chat prompt. */
export const CHUNK_CONTEXT_CHARS = 1500;
/** Streaming responses can run long. */
export const REQUEST_TIMEOUT_MS = 120_000;
/** Citation preview length. */
export const SOURCE_SNIPPET_CHARS = 200;

import { SOURCE_SNIPPET_CHARS } from '../config';

/** Max chunks included as context in "most relevant" chat. */
export const RAG_TOP_K = 8;
/** Cosine floor for relevant-mode retrieval. */
export const RAG_MIN_SCORE = 0.3;
/** Avoid one long document crowding out the corpus in relevant mode. */
export const RAG_MAX_CHUNKS_PER_DOC = 2;
/** Max chars per chunk in the chat prompt. */
export const CHUNK_CONTEXT_CHARS = 1500;
/** Base streaming timeout; large all-documents prompts add time after retrieval. */
export const REQUEST_TIMEOUT_MS = 120_000;
/** Distinct-doc quotes shown for local all-documents answers (not the full corpus). */
export const EXTRACT_ALL_DOCS_MAX_PASSAGES = 12;

export { SOURCE_SNIPPET_CHARS };

import { QUERY_MIN_SEMANTIC_SCORE, SOURCE_SNIPPET_CHARS } from '../config';

/** Max chunks included as context in "most relevant" chat. */
export const RAG_TOP_K = 8;
/**
 * Cosine floor for relevant-mode retrieval: the same calibrated floor search
 * uses. At 0.3 every passage passed (bge-small scores even unrelated text
 * above 0.5), so an off-topic question still got eight unrelated passages as
 * "context" instead of the no-match answer.
 */
export const RAG_MIN_SCORE = QUERY_MIN_SEMANTIC_SCORE;
/** Avoid one long document crowding out the corpus in relevant mode. */
export const RAG_MAX_CHUNKS_PER_DOC = 2;
/** Max chars per chunk in the chat prompt. */
export const CHUNK_CONTEXT_CHARS = 1500;
/** Base streaming timeout; large all-documents prompts add time after retrieval. */
export const REQUEST_TIMEOUT_MS = 120_000;
/** Distinct-doc quotes shown for local all-documents answers (not the full corpus). */
export const EXTRACT_ALL_DOCS_MAX_PASSAGES = 12;

export { SOURCE_SNIPPET_CHARS };

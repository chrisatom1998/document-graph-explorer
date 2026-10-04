/**
 * Character / token packing for chat context, including the all-documents
 * scope. Token counts use a conservative 2 chars/token so CJK and code-heavy
 * corpora are less likely to overflow the selected model's window.
 */

/** Conservative chars-per-token for prompt packing (English is often ~4). */
export const CHARS_PER_TOKEN = 2;

/** Models advertised with a 1M-token context (Gemini, Claude, etc.). */
export const MILLION_TOKEN_WINDOW = 1_000_000;

/** Floor / ceiling for reserved prompt + history + reply tokens. */
export const RAG_ALL_DOCS_RESERVED_TOKENS_MIN = 16_000;
export const RAG_ALL_DOCS_RESERVED_TOKENS_MAX = 100_000;

/** @deprecated Prefer reservedTokensForWindow(); kept as the 1M-window reserve. */
export const RAG_ALL_DOCS_RESERVED_TOKENS = RAG_ALL_DOCS_RESERVED_TOKENS_MAX;

/** Absolute ceiling on all-documents prompt text (1M window, conservative). */
export const RAG_ALL_DOCS_MAX_CHARS = allDocsMaxChars(MILLION_TOKEN_WINDOW);

/** Floor so a huge corpus still keeps a usable excerpt per included doc. */
export const RAG_ALL_DOCS_MIN_CHARS_PER_DOC = 200;

export function estimateTokensFromChars(charCount: number): number {
  return Math.ceil(Math.max(0, charCount) / CHARS_PER_TOKEN);
}

export function reservedTokensForWindow(windowTokens: number): number {
  const window = Math.max(0, windowTokens);
  return Math.min(
    RAG_ALL_DOCS_RESERVED_TOKENS_MAX,
    Math.max(RAG_ALL_DOCS_RESERVED_TOKENS_MIN, Math.floor(window * 0.1)),
  );
}

/** Document-text character budget for one all-documents turn. */
export function allDocsMaxChars(windowTokens: number): number {
  const reserved = reservedTokensForWindow(windowTokens);
  const availableTokens = Math.max(0, windowTokens - reserved);
  return availableTokens * CHARS_PER_TOKEN;
}

export interface AllDocsWindowEstimate {
  documentCount: number;
  charsPerDocument: number;
  contextChars: number;
  contextTokens: number;
  reservedTokens: number;
  windowTokens: number;
  tokensRemaining: number;
  documentsThatFit: number;
  fitsEntireCorpus: boolean;
  /**
   * Independent all-docs turns that would fit if each turn *added* another
   * full corpus (this app does not do that — each request rebuilds context).
   */
  theoreticalTurnsIfAccumulated: number;
  /** Fraction of the window used by document context on one turn. */
  windowFractionUsed: number;
}

/** How much of a context window one all-documents turn consumes. */
export function estimateAllDocsWindow(options: {
  documentCount: number;
  charsPerDocument: number;
  windowTokens?: number;
  reservedTokens?: number;
}): AllDocsWindowEstimate {
  const documentCount = Math.max(0, Math.floor(options.documentCount));
  const charsPerDocument = Math.max(1, Math.floor(options.charsPerDocument));
  const windowTokens = options.windowTokens ?? MILLION_TOKEN_WINDOW;
  const reservedTokens = options.reservedTokens ?? reservedTokensForWindow(windowTokens);
  const contextChars = documentCount * charsPerDocument;
  const contextTokens = estimateTokensFromChars(contextChars);
  const availableForDocs = Math.max(0, windowTokens - reservedTokens);
  const documentsThatFit = Math.floor((availableForDocs * CHARS_PER_TOKEN) / charsPerDocument);
  const tokensRemaining = Math.max(0, windowTokens - reservedTokens - contextTokens);
  const theoreticalTurnsIfAccumulated =
    contextTokens > 0 ? Math.floor(availableForDocs / contextTokens) : Infinity;

  return {
    documentCount,
    charsPerDocument,
    contextChars,
    contextTokens,
    reservedTokens,
    windowTokens,
    tokensRemaining,
    documentsThatFit,
    fitsEntireCorpus: documentCount <= documentsThatFit,
    theoreticalTurnsIfAccumulated,
    windowFractionUsed: windowTokens > 0 ? contextTokens / windowTokens : 0,
  };
}

/** Packing width for one document given a corpus size and a total char budget. */
export function charsPerDocumentForBudget(
  documentCount: number,
  maxTotalChars: number,
  maxCharsPerDoc: number,
  minCharsPerDoc: number = RAG_ALL_DOCS_MIN_CHARS_PER_DOC,
): number {
  if (documentCount <= 0) return maxCharsPerDoc;
  return Math.min(
    maxCharsPerDoc,
    Math.max(minCharsPerDoc, Math.floor(maxTotalChars / documentCount)),
  );
}

export const REQUEST_TIMEOUT_MAX_MS = 600_000;

/** Generation timeout after retrieval: 2 minutes plus 1s per ~2k tokens, capped. */
export function generationTimeoutMs(contextChars: number, baseMs: number): number {
  const extraMs = Math.floor(estimateTokensFromChars(contextChars) / 2_000) * 1_000;
  return Math.min(REQUEST_TIMEOUT_MAX_MS, baseMs + extraMs);
}

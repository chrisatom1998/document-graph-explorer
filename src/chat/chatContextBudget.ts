/**
 * Character / token packing for chat context, including the all-documents
 * scope that can fill a 1M-token model window.
 *
 * Token counts are a conservative English estimate (4 chars/token). Real
 * BPE tokenizers vary; this is only for packing and capacity reports.
 */

/** Conservative English chars-per-token used for prompt packing. */
export const CHARS_PER_TOKEN = 4;

/** Models advertised with a 1M-token context (Gemini, Claude, etc.). */
export const MILLION_TOKEN_WINDOW = 1_000_000;

/**
 * Leave room for the system prompt, 8-turn history, and the model's reply.
 * 100k tokens is 10% of a 1M window.
 */
export const RAG_ALL_DOCS_RESERVED_TOKENS = 100_000;

/** Ceiling on all-documents prompt text. Typical corpora use far less. */
export const RAG_ALL_DOCS_MAX_CHARS =
  (MILLION_TOKEN_WINDOW - RAG_ALL_DOCS_RESERVED_TOKENS) * CHARS_PER_TOKEN;

/** Floor so a huge corpus still keeps a usable excerpt per included doc. */
export const RAG_ALL_DOCS_MIN_CHARS_PER_DOC = 200;

export function estimateTokensFromChars(charCount: number): number {
  return Math.ceil(Math.max(0, charCount) / CHARS_PER_TOKEN);
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
  const reservedTokens = options.reservedTokens ?? RAG_ALL_DOCS_RESERVED_TOKENS;
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

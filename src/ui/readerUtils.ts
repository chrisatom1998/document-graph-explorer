/**
 * Shared document reader constants and text truncation utilities.
 */

/**
 * Upper bound on text length for full AST/DOM parsing in preview components
 * (DocumentMarkdown, HtmlPreview). Inputs above 8 MB skip parsing to protect
 * the main thread.
 */
export const MAX_RENDER_CHARS = 8_000_000;

/** Cap on the plain-text fallback excerpt so a single huge text node cannot freeze the DOM. */
export const FALLBACK_EXCERPT_CHARS = 200_000;

/**
 * Formats a plain-text excerpt capped at `cap` characters (defaults to `FALLBACK_EXCERPT_CHARS`).
 * Appends a truncation message if the input exceeds the cap.
 */
export function getFallbackExcerpt(text: string, cap: number = FALLBACK_EXCERPT_CHARS): string {
  if (text.length > cap) {
    return `${text.slice(0, cap)}\n\n… (truncated)`;
  }
  return text;
}

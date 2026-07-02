/**
 * Recovers the visible label of a PDF link annotation: the text items whose
 * geometry falls inside the annotation's rectangle. PDF links carry no anchor
 * text of their own — the URL lives in the annotation layer while the words
 * the user clicks are ordinary page text — so pairing them is a geometry
 * problem: both live in the same page user-space coordinates.
 *
 * PURE — no pdfjs import (pdf.js can't load in the unit-test environment),
 * just a minimal structural view of its TextItem.
 */

/** The parts of a pdf.js TextItem this module needs. */
export interface PdfTextSpan {
  str: string;
  /** pdf.js text matrix [a, b, c, d, tx, ty]; tx/ty = baseline origin. */
  transform: unknown[];
  width: number;
}

const V_TOLERANCE = 2; // pt of slack above/below the rect for the baseline
const MAX_LABEL_CHARS = 140;

/**
 * Text under `rect` ([x1, y1, x2, y2], any corner order), joined in stream
 * order. A span counts when its baseline sits inside the rect vertically and
 * the horizontal overlap covers most of the span (or most of the rect — a
 * short link inside one long text item can't be split without glyph-level
 * positions, so taking the whole item beats returning nothing).
 * Returns '' when nothing matches.
 */
export function labelForRect(
  spans: PdfTextSpan[],
  rect: readonly number[],
): string {
  if (rect.length < 4) return '';
  const x1 = Math.min(rect[0], rect[2]);
  const x2 = Math.max(rect[0], rect[2]);
  const y1 = Math.min(rect[1], rect[3]);
  const y2 = Math.max(rect[1], rect[3]);

  const parts: string[] = [];
  for (const span of spans) {
    if (!span.str || span.str.trim() === '') continue;
    const tx = span.transform[4];
    const ty = span.transform[5];
    if (typeof tx !== 'number' || typeof ty !== 'number') continue;
    if (ty < y1 - V_TOLERANCE || ty > y2 + V_TOLERANCE) continue;

    const width = span.width > 0 ? span.width : 0;
    const overlap = Math.min(tx + width, x2) - Math.max(tx, x1);
    if (overlap <= 0) continue;
    if (width > 0 && overlap < 0.5 * width && overlap < 0.9 * (x2 - x1)) continue;

    parts.push(span.str);
  }

  const label = parts.join(' ').replace(/\s+/g, ' ').trim();
  return label.length > MAX_LABEL_CHARS ? `${label.slice(0, MAX_LABEL_CHARS - 1)}…` : label;
}

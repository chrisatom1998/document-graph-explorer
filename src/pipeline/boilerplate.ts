/**
 * Corpus-wide boilerplate detection (spec §9 "garbage-in similarity"):
 * near-duplicate lines (legal footers, templates) are stripped before
 * embedding so they don't make everything look similar. PURE functions.
 */

// Contract constants for this module (not spec-level tunables in config.ts):
const MIN_LINE_LEN = 25; // normalized line must be at least this long
const MIN_DOCS_ABS = 4; // must appear in at least this many docs...
const MIN_DOCS_FRACTION = 0.6; // ...and in at least this fraction of docs

function normalizeLine(line: string): string {
  return line.trim().toLowerCase();
}

/**
 * Lines (trimmed, lowercased, ≥ 25 chars) that appear in ≥ 60% of docs AND
 * in ≥ 4 docs. Input: one string[] of lines per document.
 */
export function findBoilerplateLines(docLines: string[][]): Set<string> {
  const boilerplate = new Set<string>();
  const nDocs = docLines.length;
  if (nDocs < MIN_DOCS_ABS) return boilerplate;

  const docCounts = new Map<string, number>();
  for (const lines of docLines) {
    const seen = new Set<string>();
    for (const raw of lines) {
      const line = normalizeLine(raw);
      if (line.length < MIN_LINE_LEN || seen.has(line)) continue;
      seen.add(line);
      docCounts.set(line, (docCounts.get(line) ?? 0) + 1);
    }
  }

  const minDocs = Math.max(MIN_DOCS_ABS, Math.ceil(nDocs * MIN_DOCS_FRACTION));
  for (const [line, count] of docCounts) {
    if (count >= minDocs) boilerplate.add(line);
  }
  return boilerplate;
}

/** Removes lines whose normalized form is in the boilerplate set. */
export function stripBoilerplate(text: string, boilerplate: Set<string>): string {
  if (boilerplate.size === 0) return text;
  return text
    .split('\n')
    .filter((line) => !boilerplate.has(normalizeLine(line)))
    .join('\n');
}

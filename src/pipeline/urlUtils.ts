/**
 * Shared link-target helpers for the "hard edge" reference rules (spec §5.1):
 * previously duplicated between pipeline/links.ts (runs in the aggregator
 * worker, over plain LexicalDocInput records) and graph/linkResolver.ts
 * (runs on the main thread, over live DocNode objects). PURE — no DOM-only
 * APIs, so this is safe in a Vitest/Node environment and in web workers.
 */

/**
 * An external web link (http/https/mailto/tel/ftp/protocol-relative). These
 * point outside the corpus, so they never resolve to (or form a reference
 * edge with) another ingested document.
 */
export function isExternalUrl(target: string): boolean {
  const t = target.trim();
  return /^(https?:|mailto:|tel:|ftp:)/i.test(t) || t.startsWith('//');
}

/** basename, lowercased, without #fragment / ?query / ./ prefixes. */
export function normalizeLinkTarget(target: string): string {
  let t = target.trim();
  const hash = t.indexOf('#');
  if (hash >= 0) t = t.slice(0, hash);
  const query = t.indexOf('?');
  if (query >= 0) t = t.slice(0, query);
  while (t.startsWith('./')) t = t.slice(2);
  t = t.replace(/\/+$/, '');
  const slash = Math.max(t.lastIndexOf('/'), t.lastIndexOf('\\'));
  if (slash >= 0) t = t.slice(slash + 1);
  return t.toLowerCase();
}

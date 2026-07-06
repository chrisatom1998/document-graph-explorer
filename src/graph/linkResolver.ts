/**
 * Resolves a markdown link href / Obsidian-style [[wikilink]] target to a
 * document already in the graph, so the document reader (DocumentMarkdown)
 * can turn it into an in-app jump instead of a dead link.
 *
 * Matching mirrors the "hard edge" rules in pipeline/links.ts (normalized
 * basename against each doc's fileName, i.e. `basename(path ?? title)`) plus
 * a title-only fallback for wikilinks, which reference a note's title rather
 * than a filename. Deliberately duplicated rather than imported: links.ts
 * runs in the aggregator worker over plain LexicalDocInput records, while
 * this runs on the main thread over live DocNode objects — sharing would
 * mean threading a third shape through both, for ~10 lines of logic.
 */

import type { DocNode } from '../model/types';

/** External web links never resolve to a doc in the corpus. */
function isExternalUrl(target: string): boolean {
  const t = target.trim();
  return /^(https?:|mailto:|tel:|ftp:)/i.test(t) || t.startsWith('//');
}

/** basename, lowercased, without #fragment / ?query / ./ prefixes. */
function normalizeLinkTarget(target: string): string {
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

function stripExt(s: string): string {
  return s.replace(/\.[a-z0-9]{1,8}$/i, '');
}

function basename(path: string): string {
  return path.replace(/\\/g, '/').split('/').pop() ?? path;
}

export interface LinkIndex {
  /** normalized basename (with extension) -> docId */
  byFileName: Map<string, string>;
  /** normalized title (no extension) -> docId */
  byTitle: Map<string, string>;
}

/** Build once per graph-nodes change; O(n) over documents. */
export function buildLinkIndex(nodes: DocNode[]): LinkIndex {
  const byFileName = new Map<string, string>();
  const byTitle = new Map<string, string>();
  for (const n of nodes) {
    if (n.kind !== 'document') continue;
    const fileName = normalizeLinkTarget(basename(n.path ?? n.title));
    if (fileName && !byFileName.has(fileName)) byFileName.set(fileName, n.id);
    const title = n.title.trim().toLowerCase();
    if (title && !byTitle.has(title)) byTitle.set(title, n.id);
  }
  return { byFileName, byTitle };
}

/**
 * Resolve a link href or wikilink target to a doc id, or null if it points
 * outside the corpus (external URL) or doesn't match any ingested doc. PURE.
 */
export function resolveLinkTarget(target: string, index: LinkIndex): string | null {
  const raw = target.trim();
  if (!raw || isExternalUrl(raw)) return null;
  const norm = normalizeLinkTarget(raw);
  if (!norm) return null;
  const byFile = index.byFileName.get(norm);
  if (byFile) return byFile;
  return index.byTitle.get(stripExt(norm)) ?? null;
}

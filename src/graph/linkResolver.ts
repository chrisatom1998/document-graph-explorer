/**
 * Resolves a markdown link href / Obsidian-style [[wikilink]] target to a
 * document already in the graph, so the document reader (DocumentMarkdown)
 * can turn it into an in-app jump instead of a dead link.
 *
 * Matching mirrors the "hard edge" rules in pipeline/links.ts (normalized
 * basename against each doc's fileName, i.e. `basename(path ?? title)`) plus
 * a title-only fallback for wikilinks, which reference a note's title rather
 * than a filename. The normalization helpers themselves (isExternalUrl,
 * normalizeLinkTarget) are shared via pipeline/urlUtils.ts — links.ts runs
 * in the aggregator worker over plain LexicalDocInput records, while this
 * runs on the main thread over live DocNode objects, but the URL rules are
 * identical, so only the doc-shape-specific indexing logic below differs.
 *
 * A basename or title claimed by more than one document is not a unique
 * name — graph reference edges already refuse to guess which same-name file
 * is meant (pipeline/links.ts), and in-app jumps follow the same rule rather
 * than first-doc-winning to an arbitrary target. Path-qualified targets
 * (`pkg/two/README.md`) still resolve via an exact-path / unique-path-suffix
 * index, same idea as the path-mention rule in pipeline/links.ts.
 */

import type { DocNode } from '../model/types';
import { posixNormalize } from '../util/posixPath';
import { isExternalUrl, normalizeLinkTarget } from '../pipeline/urlUtils';

function stripExt(s: string): string {
  return s.replace(/\.[a-z0-9]{1,8}$/i, '');
}

/** Strips #fragment / ?query / leading "./" but keeps the full path (and slashes). */
function normalizePathTarget(target: string): string {
  let t = target.trim();
  const hash = t.indexOf('#');
  if (hash >= 0) t = t.slice(0, hash);
  const query = t.indexOf('?');
  if (query >= 0) t = t.slice(0, query);
  while (t.startsWith('./')) t = t.slice(2);
  return t
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .toLowerCase();
}

export interface LinkIndex {
  /** normalized basename (with extension) -> docId; omitted when ambiguous */
  byFileName: Map<string, string>;
  /** normalized title (no extension) -> docId; omitted when ambiguous */
  byTitle: Map<string, string>;
  /** normalized multi-segment path suffix -> docId; omitted when ambiguous */
  byPathSuffix: Map<string, string>;
}

/** A key claimed by more than one document owner is not stored as a winner. */
function claim(owner: Map<string, string>, ambiguous: Set<string>, key: string, id: string): void {
  if (!key) return;
  const existing = owner.get(key);
  if (existing === undefined) owner.set(key, id);
  else if (existing !== id) ambiguous.add(key);
}

function withoutAmbiguous(owner: Map<string, string>, ambiguous: Set<string>): Map<string, string> {
  if (ambiguous.size === 0) return owner;
  const out = new Map<string, string>();
  for (const [key, id] of owner) if (!ambiguous.has(key)) out.set(key, id);
  return out;
}

/** Build once per graph-nodes change; O(n) over documents. */
export function buildLinkIndex(nodes: DocNode[]): LinkIndex {
  const fileNameOwner = new Map<string, string>();
  const fileNameAmbiguous = new Set<string>();
  const titleOwner = new Map<string, string>();
  const titleAmbiguous = new Set<string>();
  const pathSuffixOwner = new Map<string, string>();
  const pathSuffixAmbiguous = new Set<string>();

  for (const n of nodes) {
    if (n.kind !== 'document') continue;
    const fileName = normalizeLinkTarget(n.path ?? n.title);
    claim(fileNameOwner, fileNameAmbiguous, fileName, n.id);
    const title = n.title.trim().toLowerCase();
    claim(titleOwner, titleAmbiguous, title, n.id);
    const path = posixNormalize(n.path ?? '').toLowerCase();
    if (path.includes('/')) {
      const segments = path.split('/');
      // All multi-segment suffixes, from the full path down to `dir/file` —
      // the same directory-disambiguates-same-name-files idea as the path
      // mention rule in pipeline/links.ts. The bare basename is excluded;
      // that's byFileName's job.
      for (let i = 0; i < segments.length - 1; i += 1) {
        const suffix = segments.slice(i).join('/');
        claim(pathSuffixOwner, pathSuffixAmbiguous, suffix, n.id);
      }
    }
  }

  return {
    byFileName: withoutAmbiguous(fileNameOwner, fileNameAmbiguous),
    byTitle: withoutAmbiguous(titleOwner, titleAmbiguous),
    byPathSuffix: withoutAmbiguous(pathSuffixOwner, pathSuffixAmbiguous),
  };
}

/**
 * Resolve a link href or wikilink target to a doc id, or null if it points
 * outside the corpus (external URL), is ambiguous, or doesn't match any
 * ingested doc. PURE.
 */
export function resolveLinkTarget(target: string, index: LinkIndex): string | null {
  const raw = target.trim();
  if (!raw || isExternalUrl(raw)) return null;
  const pathTarget = normalizePathTarget(raw);
  if (!pathTarget) return null;
  if (pathTarget.includes('/')) {
    const byPath = index.byPathSuffix.get(pathTarget);
    if (byPath) return byPath;
  }
  const norm = normalizeLinkTarget(raw);
  if (!norm) return null;
  const byFile = index.byFileName.get(norm);
  if (byFile) return byFile;
  return index.byTitle.get(stripExt(norm)) ?? null;
}

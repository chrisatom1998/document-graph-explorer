/**
 * Shared "open this document" entry point — the knowledge base's retrieval
 * counterpart. Originals-first: the exact ingested bytes open via the OS
 * default app; the styled text viewer is the fallback for docs without a
 * retained original (imported graphs, legacy cache, oversized files).
 * Callable from anywhere that has a docId (SidePanel header, chat source
 * chips) so every surface opens documents identically.
 */

import type { LinkRef } from '../model/types';
import { getOriginal } from '../persistence/originals';
import { useGraphStore } from '../store/graphStore';
import { docLinksStore, mdLinkTargetsStore, textStore } from '../store/runtimeStores';
import { useUiStore } from '../store/uiStore';
import { openDocumentViewer } from './openDocumentViewer';

/**
 * Hand the exact original bytes to the browser as a named download — the OS
 * file association (the user's chosen default app) opens it from there. A
 * browser can't launch Word/Acrobat directly; byte-identical download with
 * the right filename + MIME is the faithful equivalent.
 */
export function openOriginalFile(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // revoke on a delay — revoking synchronously can cancel the download in
  // some browsers
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * The document's original hyperlinks (persisted), each paired with its label.
 * Union the labelled links with any remaining url-only targets (shortcut
 * refs, unused defs, docs ingested before labels existed) so no web link is
 * dropped; the viewer dedupes and keeps only web links. PURE — unit-tested.
 */
export function collectViewerLinks(
  docLinks: LinkRef[],
  mdLinkTargets: string[],
): LinkRef[] {
  const covered = new Set(docLinks.map((l) => l.url));
  const extras = mdLinkTargets
    .filter((url) => !covered.has(url))
    .map((url) => ({ text: '', url }));
  return [...docLinks, ...extras];
}

export type OpenDocumentResult = 'original' | 'viewer' | 'unavailable';

/** Open a document by node id: original bytes first, text viewer fallback. */
export async function openDocument(docId: string): Promise<OpenDocumentResult> {
  const original = await getOriginal(docId);
  if (original) {
    openOriginalFile(original.name, original.blob);
    return 'original';
  }

  // Fallback viewer. window.open after an awaited IndexedDB get stays within
  // the user-activation window (SidePanel has always opened this way).
  const g = useGraphStore.getState();
  const node = g.nodes[g.nodeIndex[docId]];
  const text = textStore.get(docId);
  if (!node || node.kind !== 'document' || !text) {
    useUiStore
      .getState()
      .pushToast('No stored copy of this document — re-drop the file to restore it.', 'warning');
    return 'unavailable';
  }
  const clusterName =
    g.clusterNames[node.cluster] ?? g.localClusterNames[node.cluster] ?? `Cluster ${node.cluster}`;
  openDocumentViewer(
    node,
    text,
    clusterName,
    collectViewerLinks(docLinksStore.get(docId) ?? [], mdLinkTargetsStore.get(docId) ?? []),
  );
  return 'viewer';
}

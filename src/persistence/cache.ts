import { EMBED_DIMS } from '../config';
import type { DocNode, GraphExport } from '../model/types';
import { useUiStore } from '../store/uiStore';
import { getDb, type DocumentRecord, type EmbeddingRecord, type SnapshotRecord } from './db';

export interface CachedDoc {
  node: DocNode;
  text: string;
  chunkTexts: string[];
  chunkVectors: Float32Array | null;
  docVector: Float32Array | null;
  mdLinkTargets: string[];
}

/** Lightweight snapshot summary for listing (no heavy exportData/positions). */
export interface SnapshotSummary {
  id: number;
  name: string;
  savedAt: number;
  nodeCount: number;
}

function isQuotaExceeded(err: unknown): boolean {
  return (
    (err instanceof DOMException && err.name === 'QuotaExceededError') ||
    (err instanceof Error && err.name === 'QuotaExceededError')
  );
}

let warnedOnce = false;
function cacheUnavailable(err: unknown): void {
  if (warnedOnce) return;
  warnedOnce = true;
  console.warn(
    '[knowledge-nebula] IndexedDB unavailable — session caching disabled for this visit.',
    err,
  );
  useUiStore
    .getState()
    .pushToast(
      isQuotaExceeded(err)
        ? "Storage is full — your session won't be saved. Clear cached data in Settings to free space."
        : "This browser blocked local storage — your session won't be saved automatically.",
      'warning',
    );
}

function nonEmpty(a: Float32Array | null | undefined): Float32Array | null {
  return a && a.length > 0 ? a : null;
}

/** Joins the documents + embeddings stores for a single content hash. */
export async function lookupDocCache(hash: string): Promise<CachedDoc | undefined> {
  try {
    const db = await getDb();
    const tx = db.transaction(['documents', 'embeddings']);
    const [doc, emb] = await Promise.all([
      tx.objectStore('documents').get(hash),
      tx.objectStore('embeddings').get(hash),
    ]);
    if (!doc) return undefined;
    return {
      node: doc.node,
      text: doc.text,
      chunkTexts: doc.chunkTexts,
      chunkVectors: nonEmpty(emb?.chunkVectors),
      docVector: nonEmpty(emb?.docVector),
      mdLinkTargets: doc.mdLinkTargets ?? [],
    };
  } catch (err) {
    cacheUnavailable(err);
    return undefined;
  }
}

export async function lookupGraphCache(
  corpusHash: string,
): Promise<
  | { exportData: GraphExport; positions: Record<string, [number, number, number]> }
  | undefined
> {
  try {
    const db = await getDb();
    const rec = await db.get('graphs', corpusHash);
    if (!rec) return undefined;
    return { exportData: rec.exportData, positions: rec.positions ?? {} };
  } catch (err) {
    cacheUnavailable(err);
    return undefined;
  }
}

export async function saveDocsToCache(
  docs: {
    node: DocNode;
    text: string;
    chunkTexts: string[];
    chunkVectors: Float32Array | null;
    docVector: Float32Array | null;
    mdLinkTargets: string[];
  }[],
): Promise<void> {
  if (docs.length === 0) return;
  try {
    const db = await getDb();
    const tx = db.transaction(['documents', 'embeddings'], 'readwrite', {
      durability: 'relaxed',
    });
    const docStore = tx.objectStore('documents');
    const embStore = tx.objectStore('embeddings');
    const ops: Promise<unknown>[] = [];
    for (const d of docs) {
      const hash = d.node.id; // DocNode.id IS the content hash
      const docRec: DocumentRecord = {
        hash,
        node: d.node,
        text: d.text,
        chunkTexts: d.chunkTexts,
        mdLinkTargets: d.mdLinkTargets,
      };
      ops.push(docStore.put(docRec));
      const docVector = nonEmpty(d.docVector);
      const chunkVectors = nonEmpty(d.chunkVectors);
      if (docVector || chunkVectors) {
        const embRec: EmbeddingRecord = {
          hash,
          docVector: docVector ?? new Float32Array(0),
          chunkVectors: chunkVectors ?? new Float32Array(0),
          nChunks: chunkVectors ? Math.floor(chunkVectors.length / EMBED_DIMS) : 0,
        };
        ops.push(embStore.put(embRec));
      }
    }
    ops.push(tx.done);
    await Promise.all(ops);
  } catch (err) {
    cacheUnavailable(err);
  }
}

export async function saveGraphToCache(
  corpusHash: string,
  exportData: GraphExport,
  positions: Record<string, [number, number, number]>,
): Promise<void> {
  try {
    const db = await getDb();
    await db.put('graphs', { corpusHash, exportData, positions, savedAt: Date.now() });
  } catch (err) {
    cacheUnavailable(err);
  }
}

/**
 * Deletes document + embedding records ("remove from knowledge bank").
 * The doc's text and vectors are gone from this browser after this resolves.
 */
export async function deleteDocsFromCache(hashes: string[]): Promise<void> {
  if (hashes.length === 0) return;
  try {
    const db = await getDb();
    const tx = db.transaction(['documents', 'embeddings'], 'readwrite');
    const docStore = tx.objectStore('documents');
    const embStore = tx.objectStore('embeddings');
    await Promise.all([
      ...hashes.map((h) => docStore.delete(h)),
      ...hashes.map((h) => embStore.delete(h)),
      tx.done,
    ]);
  } catch (err) {
    cacheUnavailable(err);
  }
}

/** Deletes one saved graph snapshot (stale corpus after removal). */
export async function deleteGraphFromCache(corpusHash: string): Promise<void> {
  try {
    const db = await getDb();
    await db.delete('graphs', corpusHash);
  } catch (err) {
    cacheUnavailable(err);
  }
}

export async function getSetting<T>(key: string): Promise<T | undefined> {
  try {
    const db = await getDb();
    return (await db.get('settings', key)) as T | undefined;
  } catch (err) {
    cacheUnavailable(err);
    return undefined;
  }
}

export async function setSetting<T>(key: string, value: T): Promise<void> {
  try {
    const db = await getDb();
    await db.put('settings', value, key);
  } catch (err) {
    cacheUnavailable(err);
  }
}

/** Wipes every store ("Clear cached session" in Settings). True on success. */
export async function clearAllCaches(): Promise<boolean> {
  try {
    const db = await getDb();
    const tx = db.transaction(
      ['documents', 'embeddings', 'graphs', 'settings', 'snapshots'],
      'readwrite',
    );
    await Promise.all([
      tx.objectStore('documents').clear(),
      tx.objectStore('embeddings').clear(),
      tx.objectStore('graphs').clear(),
      tx.objectStore('settings').clear(),
      tx.objectStore('snapshots').clear(),
      tx.done,
    ]);
    return true;
  } catch (err) {
    cacheUnavailable(err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------

/** Save a named snapshot of the current graph state. */
export async function saveSnapshot(
  name: string,
  corpusHash: string,
  exportData: GraphExport,
  positions: Record<string, [number, number, number]>,
  docHashes: string[],
): Promise<number | undefined> {
  try {
    const db = await getDb();
    const rec: SnapshotRecord = {
      name,
      savedAt: Date.now(),
      corpusHash,
      docHashes,
      exportData,
      positions,
    };
    const id = await db.add('snapshots', rec);
    return id;
  } catch (err) {
    cacheUnavailable(err);
    return undefined;
  }
}

/** List all snapshots, most recent first (lightweight — no exportData). */
export async function listSnapshots(): Promise<SnapshotSummary[]> {
  try {
    const db = await getDb();
    const all = await db.getAll('snapshots');
    return all
      .map((r) => ({
        id: r.id!,
        name: r.name,
        savedAt: r.savedAt,
        nodeCount: r.exportData?.nodes?.length ?? 0,
      }))
      .sort((a, b) => b.savedAt - a.savedAt);
  } catch (err) {
    cacheUnavailable(err);
    return [];
  }
}

/** Load a full snapshot record by ID. */
export async function loadSnapshot(id: number): Promise<SnapshotRecord | undefined> {
  try {
    const db = await getDb();
    return await db.get('snapshots', id);
  } catch (err) {
    cacheUnavailable(err);
    return undefined;
  }
}

/** Delete a snapshot by ID. */
export async function deleteSnapshot(id: number): Promise<boolean> {
  try {
    const db = await getDb();
    await db.delete('snapshots', id);
    return true;
  } catch (err) {
    cacheUnavailable(err);
    return false;
  }
}

/**
 * Cache facade over IndexedDB — the pipeline's persistence contract.
 * Every function degrades gracefully: private-browsing / quota / blocked
 * failures log ONE warning and behave as a cache miss; the app runs fully
 * without persistence (spec §11: works with zero network AND zero storage).
 */

import { EMBED_DIMS } from '../config';
import type { DocNode, GraphExport } from '../model/types';
import { getDb, type DocumentRecord, type EmbeddingRecord } from './db';

export interface CachedDoc {
  node: DocNode;
  text: string;
  chunkTexts: string[];
  chunkVectors: Float32Array | null;
  docVector: Float32Array | null;
}

let warnedOnce = false;
function cacheUnavailable(err: unknown): void {
  if (warnedOnce) return;
  warnedOnce = true;
  console.warn(
    '[knowledge-nebula] IndexedDB unavailable — session caching disabled for this visit.',
    err,
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
    const tx = db.transaction(['documents', 'embeddings', 'graphs', 'settings'], 'readwrite');
    await Promise.all([
      tx.objectStore('documents').clear(),
      tx.objectStore('embeddings').clear(),
      tx.objectStore('graphs').clear(),
      tx.objectStore('settings').clear(),
      tx.done,
    ]);
    return true;
  } catch (err) {
    cacheUnavailable(err);
    return false;
  }
}

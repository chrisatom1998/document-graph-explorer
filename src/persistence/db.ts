/**
 * IndexedDB schema + memoized connection (idb v8).
 *
 * DB 'knowledge-nebula', version 1, four stores:
 * - documents:  contentHash -> parsed doc (DocNode snapshot, full text, chunk texts)
 * - embeddings: contentHash -> Float32Array vectors, stored natively (no base64
 *   round-trip — this is what makes the <3s session restore possible)
 * - graphs:     corpusHash  -> GraphExport + settled layout positions
 * - settings:   string      -> small values (e.g. 'lastCorpusHash')
 */

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { DocNode, GraphExport } from '../model/types';

export const DB_NAME = 'knowledge-nebula';
export const DB_VERSION = 1;

export interface DocumentRecord {
  hash: string;
  node: DocNode;
  text: string;
  chunkTexts: string[];
}

export interface EmbeddingRecord {
  hash: string;
  /** zero-length = absent */
  docVector: Float32Array;
  /** flattened [nChunks * EMBED_DIMS]; zero-length = absent */
  chunkVectors: Float32Array;
  nChunks: number;
}

export interface GraphRecord {
  corpusHash: string;
  exportData: GraphExport;
  positions: Record<string, [number, number, number]>;
  savedAt: number;
}

export interface NebulaDB extends DBSchema {
  documents: { key: string; value: DocumentRecord };
  embeddings: { key: string; value: EmbeddingRecord };
  graphs: { key: string; value: GraphRecord };
  settings: { key: string; value: unknown };
}

let dbPromise: Promise<IDBPDatabase<NebulaDB>> | null = null;

/** Memoized connection. Rejections drop the memo so later calls may retry. */
export function getDb(): Promise<IDBPDatabase<NebulaDB>> {
  if (dbPromise) return dbPromise;
  const p = openDB<NebulaDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      db.createObjectStore('documents', { keyPath: 'hash' });
      db.createObjectStore('embeddings', { keyPath: 'hash' });
      db.createObjectStore('graphs', { keyPath: 'corpusHash' });
      db.createObjectStore('settings'); // out-of-line string keys
    },
    terminated() {
      // abnormal close (not db.close()) — allow a clean reopen next call
      dbPromise = null;
    },
  });
  dbPromise = p;
  p.catch(() => {
    // private mode / quota / blocked upgrade: callers degrade to no-cache;
    // clearing the memo lets a later call retry.
    if (dbPromise === p) dbPromise = null;
  });
  return p;
}

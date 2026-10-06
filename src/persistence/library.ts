/**
 * The remembered library: which document id each file on disk produced, keyed
 * by its relative path, byte size and modified time. Re-reading a folder looks
 * files up here first, so an unchanged file is neither read nor hashed again:
 * its parsed text, embeddings and audio analysis come straight from the
 * documents store. Bytes are only read when the stored record is gone (purged
 * on removal, or cleared in Settings) or the file changed on disk.
 *
 * Saved audio analyses (music-analysis:* and audio-inference:* keys in the
 * settings store) are separate content-hash caches; "Forget saved library"
 * clears them together with this index so the next import analyses afresh.
 */

import type { FileType } from '../model/types';
import { getDb, type LibraryFileRecord } from './db';

/** Index entries are ~150 bytes; the cap only guards a pathological profile. */
export const LIBRARY_INDEX_LIMIT = 50_000;
const MUSIC_ANALYSIS_PREFIX = 'music-analysis:';
const AUDIO_INFERENCE_PREFIX = 'audio-inference:';

export interface LibraryFileIdentity {
  /** Relative path as ingest names it (path, falling back to the file name). */
  path: string;
  size: number;
  lastModified: number;
}

export interface LibraryHit {
  docId: string;
  fileType: FileType;
}

export function libraryKey({ path, size, lastModified }: LibraryFileIdentity): string {
  return `${path}\0${size}\0${lastModified}`;
}

/**
 * Remembered ids for the given files. A hit requires the parsed document AND
 * the retained original to still exist: the original is what reanalysis and
 * "Open" read, so without it the file must be read again. Storage failures
 * return no hits — the caller falls back to reading every file.
 */
export async function lookupLibraryFiles(
  files: LibraryFileIdentity[],
): Promise<Map<string, LibraryHit>> {
  const hits = new Map<string, LibraryHit>();
  if (files.length === 0) return hits;
  try {
    const db = await getDb();
    const tx = db.transaction(['library', 'documents', 'originals']);
    const library = tx.objectStore('library');
    const documents = tx.objectStore('documents');
    const originals = tx.objectStore('originals');
    await Promise.all(
      files.map(async (file) => {
        const key = libraryKey(file);
        const entry = await library.get(key);
        if (!entry) return;
        const [doc, original] = await Promise.all([
          documents.getKey(entry.docId),
          originals.getKey(entry.docId),
        ]);
        if (doc !== undefined && original !== undefined) {
          hits.set(key, { docId: entry.docId, fileType: entry.fileType });
        }
      }),
    );
    await tx.done;
  } catch {
    return new Map();
  }
  return hits;
}

/** Whether the parsed document for this id is still stored. */
export async function hasDocumentRecord(docId: string): Promise<boolean> {
  try {
    return (await (await getDb()).getKey('documents', docId)) !== undefined;
  } catch {
    return false;
  }
}

/** Record which document each read file produced. Best effort, never throws. */
export async function rememberLibraryFiles(
  entries: (LibraryFileIdentity & LibraryHit)[],
): Promise<void> {
  if (entries.length === 0) return;
  try {
    const db = await getDb();
    const tx = db.transaction('library', 'readwrite');
    void tx.done.catch(() => {});
    const savedAt = Date.now();
    for (const entry of entries) {
      const record: LibraryFileRecord = {
        key: libraryKey(entry),
        docId: entry.docId,
        fileType: entry.fileType,
        savedAt,
      };
      void tx.store.put(record);
    }
    const count = await tx.store.count();
    if (count > LIBRARY_INDEX_LIMIT) {
      const all = await tx.store.getAll();
      all.sort((a, b) => a.savedAt - b.savedAt);
      for (const stale of all.slice(0, count - LIBRARY_INDEX_LIMIT)) void tx.store.delete(stale.key);
    }
    await tx.done;
  } catch {
    /* A missing index only costs a re-read next time. */
  }
}

export interface LibraryStats {
  /** Files whose path, size and date are remembered. */
  files: number;
  /** Saved whole-track audio analyses, reusable even after a track is removed or renamed. */
  analyses: number;
}

export async function libraryStats(): Promise<LibraryStats | null> {
  try {
    const db = await getDb();
    const tx = db.transaction(['library', 'settings']);
    const [files, keys] = await Promise.all([
      tx.objectStore('library').count(),
      tx.objectStore('settings').getAllKeys(),
    ]);
    await tx.done;
    const analyses = keys.filter((key) => String(key).startsWith(MUSIC_ANALYSIS_PREFIX)).length;
    return { files, analyses };
  } catch {
    return null;
  }
}

/**
 * Forget the remembered library: the path index and every saved audio
 * analysis. Tracks already in a workspace keep their results; files read
 * after this are read, hashed and analysed again. True on success.
 */
export async function clearLibrary(): Promise<boolean> {
  try {
    const db = await getDb();
    const tx = db.transaction(['library', 'settings'], 'readwrite');
    void tx.done.catch(() => {});
    const settings = tx.objectStore('settings');
    const keys = (await settings.getAllKeys()).filter((key) => {
      const text = String(key);
      return text.startsWith(MUSIC_ANALYSIS_PREFIX) || text.startsWith(AUDIO_INFERENCE_PREFIX);
    });
    await Promise.all([tx.objectStore('library').clear(), ...keys.map((key) => settings.delete(key))]);
    await tx.done;
    return true;
  } catch {
    return false;
  }
}

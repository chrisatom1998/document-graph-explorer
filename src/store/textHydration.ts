/**
 * On-demand full-text hydration + safe eviction for textStore.
 *
 * Full text is the one unbounded per-document payload (chunk texts and
 * vectors are capped by MAX_EMBED_TEXT_BYTES), and it is already persisted
 * verbatim in the IndexedDB `documents` store. This module lets the app drop
 * resident full texts once a corpus grows past a budget and reload them
 * transparently when a reader, pipeline pass, or AI action needs them again.
 *
 * Eviction invariants (each protects a case where memory is the only copy):
 * - never evict a doc in dirtyDocIds — saveSession/eager flush read
 *   `textStore.get(id) ?? ''` and would commit '' over good data;
 * - never evict while IndexedDB persistence is degraded (cacheUnavailable);
 * - never evict a doc without a CONFIRMED persisted DocumentRecord — imported
 *   graphs and unflushed parses exist in memory only.
 */

import { isPersistenceHealthy, reportPersistenceUnavailable } from '../persistence/cache';
import { getDb } from '../persistence/db';
import { chunkStore, dirtyDocIds, onRuntimeStoresCleared, textStore } from './runtimeStores';
import { useGraphStore } from './graphStore';
import { useUiStore } from './uiStore';

/**
 * Resident full-text budget. 64MB keeps a typical multi-hundred-document
 * corpus fully warm (zero rehydration latency anywhere) while bounding the
 * pathological cases — thousands of large extracted texts — that used to sit
 * in memory forever. Counted in UTF-16 code units (string length), which
 * matches resident bytes for ASCII-dominant corpus text (V8 one-byte strings)
 * and undercounts by at most 2x for non-Latin text.
 */
export const TEXT_STORE_KEEP_BYTES = 64 * 1024 * 1024;

/** Debounce for the watermark trigger armed after single/bulk hydrations. */
const WATERMARK_EVICTION_DELAY_MS = 1_000;

/**
 * Bumped on every runtime-store teardown (reset, corpus switch, snapshot
 * restore). An async hydration started before the bump must not repopulate
 * textStore for a corpus that no longer exists.
 */
let generation = 0;

/** Doc ids whose DocumentRecord is confirmed to exist in IndexedDB. */
const persistedDocIds = new Set<string>();

/** LRU bookkeeping: docId -> monotonic use tick (higher = more recent). */
let useTick = 0;
const lastUse = new Map<string, number>();

let watermarkTimer: ReturnType<typeof setTimeout> | null = null;

function resetTextHydration(): void {
  generation += 1;
  persistedDocIds.clear();
  lastUse.clear();
  if (watermarkTimer !== null) {
    clearTimeout(watermarkTimer);
    watermarkTimer = null;
  }
}
onRuntimeStoresCleared(resetTextHydration);

function touch(id: string): void {
  useTick += 1;
  lastUse.set(id, useTick);
}

/**
 * Record that these docs' DocumentRecords are known to exist in IndexedDB —
 * either just written there (a committed saveDocsToCache) or just read from
 * there (session/snapshot hydration, ingest cache hits). Only confirmed ids
 * are ever eligible for eviction.
 */
export function markDocsPersisted(ids: Iterable<string>): void {
  for (const id of ids) persistedDocIds.add(id);
}

/** Drop bookkeeping for docs leaving the corpus (their records may be purged). */
export function forgetPersistedDocs(ids: Iterable<string>): void {
  for (const id of ids) {
    persistedDocIds.delete(id);
    lastUse.delete(id);
  }
}

/**
 * "This doc has readable full text" — resident, or evicted but recoverable
 * from its persisted record. The synchronous replacement for the old
 * `textStore.has(id)` readability predicates.
 */
export function hasDocTextSync(id: string): boolean {
  return textStore.has(id) || persistedDocIds.has(id);
}

/**
 * Text a corpus-wide compute pass should use for a doc, WITHOUT awaiting.
 *
 * Never returns '' for a document that actually has a body: when the full
 * text is not resident (evicted, and a bulk hydration could not bring it back
 * because persistence failed), it falls back to the doc's chunk texts, which
 * are never evicted. Those cover the leading MAX_EMBED_TEXT_BYTES — exactly
 * the slice every caller truncates to anyway — so the fallback is near
 * equivalent, where '' would silently recompute edges, keywords, and
 * embeddings as if the document were blank (and a rebuild would wipe good
 * vectors). Genuinely textless docs (imported graphs) still yield ''.
 */
export function docTextForCompute(id: string): string {
  const resident = textStore.get(id);
  if (resident !== undefined) return resident;
  const chunks = chunkStore.get(id)?.texts;
  return chunks && chunks.length > 0 ? chunks.join('\n\n') : '';
}

/** A hydration that resolved after its doc left the corpus must not resurrect it. */
function stillInCorpus(id: string): boolean {
  return useGraphStore.getState().nodeIndex[id] !== undefined;
}

/**
 * Full text for one doc: resident value, or rehydrated from its
 * DocumentRecord (and cached back into textStore). Undefined only on a
 * confirmed miss — no resident text and no persisted record.
 */
export async function getDocText(id: string): Promise<string | undefined> {
  const resident = textStore.get(id);
  if (resident !== undefined) {
    touch(id);
    return resident;
  }
  const gen = generation;
  try {
    const db = await getDb();
    const record = await db.get('documents', id);
    if (record === undefined) return undefined;
    if (gen === generation && stillInCorpus(id)) {
      textStore.set(id, record.text);
      persistedDocIds.add(id);
      touch(id);
      scheduleWatermarkEviction();
    }
    return record.text;
  } catch (err) {
    // Persistence just degraded under us — surface it once and stop evicting
    // for the rest of the visit (memory may now be the only copy).
    reportPersistenceUnavailable(err);
    return undefined;
  }
}

/**
 * Bulk variant for corpus-wide passes: one readonly transaction for every
 * missing id, resident ids answered synchronously. Ids with no record are
 * simply absent from the result.
 */
export async function getDocTexts(ids: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const missing: string[] = [];
  for (const id of ids) {
    const resident = textStore.get(id);
    if (resident !== undefined) {
      touch(id);
      out.set(id, resident);
    } else {
      missing.push(id);
    }
  }
  if (missing.length === 0) return out;
  const gen = generation;
  try {
    const db = await getDb();
    const docStore = db.transaction('documents').objectStore('documents');
    const records = await Promise.all(missing.map((id) => docStore.get(id)));
    for (let i = 0; i < missing.length; i += 1) {
      const record = records[i];
      if (record === undefined) continue;
      out.set(missing[i], record.text);
      if (gen === generation && stillInCorpus(missing[i])) {
        textStore.set(missing[i], record.text);
        persistedDocIds.add(missing[i]);
        touch(missing[i]);
      }
    }
    if (gen === generation) scheduleWatermarkEviction();
  } catch (err) {
    reportPersistenceUnavailable(err);
  }
  return out;
}

export interface EvictDocTextsOptions {
  /** Resident full-text budget to trim down to. Default TEXT_STORE_KEEP_BYTES. */
  keepBytes?: number;
}

/**
 * Trim resident full texts down to the budget, least-recently-used first.
 * Skips dirty docs, docs without a confirmed persisted record, and the docs
 * currently on screen (side panel selection, compare panes); refuses to run
 * at all while persistence is degraded. Returns the evicted ids.
 */
export function evictDocTexts(options: EvictDocTextsOptions = {}): string[] {
  if (!isPersistenceHealthy()) return [];
  const keepBytes = options.keepBytes ?? TEXT_STORE_KEEP_BYTES;
  let residentBytes = 0;
  for (const text of textStore.values()) residentBytes += text.length;
  if (residentBytes <= keepBytes) return [];

  const ui = useUiStore.getState();
  const pinned = new Set([ui.selectedId, ui.compareLeftId, ui.compareRightId]);
  const candidates = [...textStore.keys()]
    .filter((id) => persistedDocIds.has(id) && !dirtyDocIds.has(id) && !pinned.has(id))
    .sort((a, b) => (lastUse.get(a) ?? 0) - (lastUse.get(b) ?? 0));

  const evicted: string[] = [];
  for (const id of candidates) {
    if (residentBytes <= keepBytes) break;
    const text = textStore.get(id);
    if (!text) continue; // empty texts free nothing
    residentBytes -= text.length;
    textStore.delete(id);
    lastUse.delete(id);
    evicted.push(id);
  }
  return evicted;
}

/**
 * Watermark trigger: after a hydration pushes the resident set over budget,
 * trim it once things settle. Corpus-wide pipeline passes (any non-'ready'
 * phase) hold their working set transiently and run their own pass-end
 * eviction, so this deliberately skips mid-run.
 */
function scheduleWatermarkEviction(): void {
  if (watermarkTimer !== null) return;
  watermarkTimer = setTimeout(() => {
    watermarkTimer = null;
    if (useGraphStore.getState().phase !== 'ready') return;
    evictDocTexts();
  }, WATERMARK_EVICTION_DELAY_MS);
}

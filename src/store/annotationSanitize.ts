/**
 * Bounds for annotation records crossing a trust boundary.
 *
 * Annotations arrive from three places: this device's IndexedDB, an imported
 * corpus record, and — the reason these caps exist — collaboration peers, who
 * are only as trustworthy as whoever holds the invite. A peer writes into the
 * shared Yjs map and every change is applied to the local store and persisted,
 * so an unbounded record is a write primitive against this device's storage
 * quota.
 *
 * Kept free of store, DOM, and persistence imports so the collab session
 * module can share it without pulling zustand into that chunk. Limits mirror
 * validateImport.ts, which clamps the other untrusted-input path.
 */

import type { DocAnnotationRecord } from '../persistence/db';

/** Oversized keys are rejected, not truncated — truncation collides keys. */
export const MAX_ANNOTATION_KEY_CHARS = 1024; // matches MAX_PATH_CHARS
export const MAX_ANNOTATION_NOTE_CHARS = 10_000;
export const MAX_ANNOTATION_TAGS = 64; // matches MAX_LIST_ITEMS
export const MAX_ANNOTATION_TAG_CHARS = 200; // matches MAX_LIST_ITEM_CHARS
export const MAX_ANNOTATION_RECORDS = 4096; // matches MAX_NODES
export const MAX_SCANNED_ENTRIES = 100_000;
/**
 * Existing local work may predate the 4,096-record admission limit. Keep it
 * readable after upgrade while retaining a hard ceiling for a corrupted
 * IndexedDB record.
 */
export const MAX_PERSISTED_ANNOTATION_RECORDS = MAX_SCANNED_ENTRIES;
/**
 * Tolerance for a peer whose clock runs ahead of ours. Conflicts resolve by
 * last-write-wins on updatedAt, so an unclamped far-future stamp would let one
 * peer's record win against every later edit, permanently.
 */
export const MAX_CLOCK_SKEW_MS = 5 * 60_000;

function clampString(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value.length > max ? value.slice(0, max) : value;
}

function sanitizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const tag of value) {
    if (typeof tag !== 'string') continue;
    out.push(clampString(tag, MAX_ANNOTATION_TAG_CHARS));
    if (out.length >= MAX_ANNOTATION_TAGS) break;
  }
  return out;
}

/** Clamp a peer-supplied stamp so last-write-wins cannot be locked forever. */
export function clampUpdatedAt(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  if (value < 0) return 0;
  const ceiling = Date.now() + MAX_CLOCK_SKEW_MS;
  return value > ceiling ? ceiling : value;
}

/**
 * Normalize and bound one record. `fallbackUpdatedAt` is what a missing or
 * unusable timestamp becomes — callers hydrating a live session pass
 * `Date.now()`, callers reading from disk pass 0.
 */
export function sanitizeAnnotationRecord(
  value: unknown,
  fallbackUpdatedAt = 0,
): DocAnnotationRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Partial<DocAnnotationRecord>;
  return {
    note: clampString(raw.note, MAX_ANNOTATION_NOTE_CHARS),
    tags: sanitizeTags(raw.tags),
    pinned: raw.pinned === true,
    updatedAt: clampUpdatedAt(raw.updatedAt, fallbackUpdatedAt),
  };
}

/** Empty annotations are not user data and must not consume the record cap. */
export function isAnnotationHusk(value: DocAnnotationRecord): boolean {
  return value.note.trim() === '' && value.tags.length === 0 && !value.pinned;
}

/** True when the key itself is unusable — reject the whole record. */
export function isValidAnnotationKey(key: string): boolean {
  if (key.length === 0 || key.length > MAX_ANNOTATION_KEY_CHARS) return false;
  // `__proto__` assignment pollutes a normal object; inherited names like
  // `constructor` make `key in annotations` look like an existing record.
  return key !== '__proto__' && !Object.hasOwn(Object.prototype, key);
}

/**
 * Normalize a whole map, bounding both the records kept and the entries
 * examined: a map of a million invalid entries `continue`s without advancing
 * the keep-count, so the keep-cap alone never ends the loop (validateImport.ts
 * bounds its own loops for the same reason).
 */
export function sanitizeAnnotationMap(
  raw: Record<string, unknown> | undefined,
  fallbackUpdatedAt = 0,
  maxRecords = MAX_ANNOTATION_RECORDS,
): Record<string, DocAnnotationRecord> {
  const out: Record<string, DocAnnotationRecord> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const keepLimit = Math.max(
    0,
    Math.min(Math.floor(maxRecords), MAX_SCANNED_ENTRIES),
  );
  let kept = 0;
  let examined = 0;
  for (const [key, value] of Object.entries(raw)) {
    if (kept >= keepLimit || ++examined > MAX_SCANNED_ENTRIES) break;
    if (!isValidAnnotationKey(key)) continue;
    const record = sanitizeAnnotationRecord(value, fallbackUpdatedAt);
    if (!record || isAnnotationHusk(record)) continue;
    out[key] = record;
    kept++;
  }
  return out;
}

/**
 * Visit at most the configured number of keys from an untrusted iterable.
 * Yjs can deliver a single transaction containing an arbitrary number of map
 * changes, so live collaboration needs the same scan ceiling as map hydration.
 */
export function forEachBoundedAnnotationKey(
  keys: Iterable<string>,
  visit: (key: string) => void,
  maxEntries = MAX_SCANNED_ENTRIES,
): number {
  const limit = Math.max(
    0,
    Math.min(Math.floor(maxEntries), MAX_SCANNED_ENTRIES),
  );
  let examined = 0;
  for (const key of keys) {
    if (examined >= limit) break;
    examined++;
    visit(key);
  }
  return examined;
}

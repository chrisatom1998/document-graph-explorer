import { validAnnotationVersion } from '../persistence/annotationVersion';
import type { DocAnnotationRecord } from '../persistence/db';

const PREFIX = 'knowledge-nebula:pending-annotation:';
const storageKey = (scope: string, key: string, nonce?: string) => PREFIX + JSON.stringify(nonce ? [scope, key, nonce] : [scope, key]);

export interface RecoveredAnnotation {
  key: string;
  value: DocAnnotationRecord | null;
  updatedAt: number;
  serialized: string;
}

/** A synchronous recovery copy closes the gap before an IndexedDB commit. */
export function journalAnnotation(scope: string, key: string, value: DocAnnotationRecord | null, updatedAt = value?.updatedAt ?? Date.now()): string | null {
  const nonce = crypto.randomUUID();
  const serialized = JSON.stringify({ format: 2, value, updatedAt, nonce });
  try {
    localStorage.setItem(storageKey(scope, key, nonce), serialized);
    return serialized;
  } catch {
    return null; // IndexedDB may still work; the UI must keep showing pending.
  }
}

export function recoverAnnotations(scope: string): RecoveredAnnotation[] {
  const result: RecoveredAnnotation[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const name = localStorage.key(i);
      if (!name?.startsWith(PREFIX)) continue;
      try {
        const identity: unknown = JSON.parse(name.slice(PREFIX.length));
        if (!Array.isArray(identity) || ![2, 3].includes(identity.length) || identity[0] !== scope || typeof identity[1] !== 'string') continue;
        const serialized = localStorage.getItem(name);
        if (!serialized) continue;
        const entry = JSON.parse(serialized);
        if (!entry || !validAnnotationVersion(entry.updatedAt)) continue;
        const value = entry.value;
        if (value !== null && (!value || typeof value !== 'object' || typeof value.note !== 'string' || !Array.isArray(value.tags) || !value.tags.every((tag: unknown) => typeof tag === 'string') || typeof value.pinned !== 'boolean' || !validAnnotationVersion(value.updatedAt))) continue;
        // Old journals stamped the write, not the edit. Recover the edit clock
        // from non-null values. Legacy deletions have no trustworthy edit
        // version and must never delete an existing durable annotation.
        const updatedAt = entry.format === 2 ? entry.updatedAt : value?.updatedAt ?? 0;
        result.push({ key: identity[1], value, updatedAt, serialized });
      } catch { /* Ignore malformed storage entries. */ }
    }
  } catch { /* Storage may be unavailable while IndexedDB is usable. */ }
  return result;
}

/** An older write must not delete a recovery copy made by a later edit/tab. */
export function clearJournalAnnotation(scope: string, key: string, serialized: string): void {
  try {
    const entry = JSON.parse(serialized);
    // Legacy entries used one shared slot; new mutations have separate slots
    // so an older tab cannot overwrite another tab's unsaved recovery copy.
    for (const name of [storageKey(scope, key, entry.nonce), storageKey(scope, key)]) {
      if (localStorage.getItem(name) === serialized) localStorage.removeItem(name);
    }
  } catch { /* Keep the recovery copy if storage cannot be changed. */ }
}

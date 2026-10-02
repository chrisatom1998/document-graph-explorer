import type { DocAnnotationRecord } from '../persistence/db';

const PREFIX = 'knowledge-nebula:pending-annotation:';
const storageKey = (scope: string, key: string) => PREFIX + JSON.stringify([scope, key]);

export interface RecoveredAnnotation {
  key: string;
  value: DocAnnotationRecord | null;
  updatedAt: number;
  serialized: string;
}

/** A synchronous recovery copy closes the gap before an IndexedDB commit. */
export function journalAnnotation(scope: string, key: string, value: DocAnnotationRecord | null): string | null {
  const serialized = JSON.stringify({ value, updatedAt: Date.now(), nonce: crypto.randomUUID() });
  try {
    localStorage.setItem(storageKey(scope, key), serialized);
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
        if (!Array.isArray(identity) || identity.length !== 2 || identity[0] !== scope || typeof identity[1] !== 'string') continue;
        const serialized = localStorage.getItem(name);
        if (!serialized) continue;
        const entry = JSON.parse(serialized);
        if (!entry || typeof entry.updatedAt !== 'number' || !Number.isFinite(entry.updatedAt)) continue;
        const value = entry.value;
        if (value !== null && (!value || typeof value !== 'object' || typeof value.note !== 'string' || !Array.isArray(value.tags) || !value.tags.every((tag: unknown) => typeof tag === 'string') || typeof value.pinned !== 'boolean' || typeof value.updatedAt !== 'number')) continue;
        result.push({ key: identity[1], value, updatedAt: entry.updatedAt, serialized });
      } catch { /* Ignore malformed storage entries. */ }
    }
  } catch { /* Storage may be unavailable while IndexedDB is usable. */ }
  return result;
}

/** An older write must not delete a recovery copy made by a later edit/tab. */
export function clearJournalAnnotation(scope: string, key: string, serialized: string): void {
  try {
    const name = storageKey(scope, key);
    if (localStorage.getItem(name) === serialized) localStorage.removeItem(name);
  } catch { /* Keep the recovery copy if storage cannot be changed. */ }
}

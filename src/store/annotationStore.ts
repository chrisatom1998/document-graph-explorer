/**
 * Per-corpus document annotations (notes, tags, pins) with lazy hydration
 * and debounced, per-key save-through persistence.
 *
 * Race posture (simpler than chatHistorySync's, on purpose): every edit is
 * tagged with the corpus id the store hydrated FROM, and the debounced save
 * writes to exactly that corpus record via updateCorpusAnnotations(scope, …).
 * A corpus switch mid-debounce therefore cannot clobber the wrong workspace —
 * the write lands on the record the data belongs to, no matter what is active
 * by then. The only scope-sensitive step is hydration, which claims the scope
 * before awaiting and re-checks it after (the chatHistorySync pattern).
 *
 * Persistence is per-key: only the keys edited in this tab are patched into
 * the record (deletes as explicit nulls), so a second tab's annotations
 * survive. Failed writes stay dirty, surface one toast, and retry.
 *
 * Annotations are durable user-authored content: nothing here clears them on
 * corpus reset, and they are keyed by the document's stable key (see
 * annotationKey) so an edited file keeps its notes.
 */

import { create } from 'zustand';
import type { DocNode } from '../model/types';
import type { DocAnnotationRecord } from '../persistence/db';
import {
  getCorpusRecord,
  updateCorpusAnnotations,
} from '../persistence/corpusRepository';

const SAVE_DEBOUNCE_MS = 350;
const RETRY_AFTER_FAILURE_MS = 15_000;

/**
 * Stable identity for annotations. Folder paths are unique within a corpus
 * and survive content edits — the property this key exists for. A file
 * dropped individually has no path, and titles are NOT unique, so the
 * content-derived node id disambiguates; such a doc keeps its annotation on
 * re-drop (same content → same id) but loses it if edited. Losing a note on
 * an edited pathless file beats two same-titled files silently sharing one.
 */
export function annotationKey(node: Pick<DocNode, 'path' | 'title' | 'id'>): string {
  return node.path ?? `${node.title} ${node.id}`;
}

export function emptyAnnotation(): DocAnnotationRecord {
  return { note: '', tags: [], pinned: false, updatedAt: 0 };
}

/**
 * True when the record holds nothing at all — safe to drop from the live store.
 * Deliberately compares the note exactly: a whitespace-only note is a husk at
 * rest but a legitimate mid-edit state (the textarea is controlled off this
 * record, so pruning it would swallow the keystroke that produced it).
 */
function isEmpty(a: DocAnnotationRecord): boolean {
  return a.note === '' && a.tags.length === 0 && !a.pinned;
}

/** Husk at rest (whitespace-only note, nothing else) — prune on the way to disk. */
function isHusk(a: DocAnnotationRecord): boolean {
  return a.note.trim() === '' && a.tags.length === 0 && !a.pinned;
}

/** Persisted records cross a trust boundary — normalize shape on the way in. */
function sanitize(
  raw: Record<string, DocAnnotationRecord> | undefined,
): Record<string, DocAnnotationRecord> {
  const out: Record<string, DocAnnotationRecord> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [key, value] of Object.entries(raw)) {
    if (!value || typeof value !== 'object') continue;
    out[key] = {
      note: typeof value.note === 'string' ? value.note : '',
      tags: Array.isArray(value.tags)
        ? value.tags.filter((t): t is string => typeof t === 'string')
        : [],
      pinned: value.pinned === true,
      updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : 0,
    };
  }
  return out;
}

interface AnnotationState {
  /** Corpus id these annotations belong to; null until first hydration. */
  scope: string | null;
  annotations: Record<string, DocAnnotationRecord>;
  /** Replace everything (hydration). */
  hydrate: (scope: string, annotations: Record<string, DocAnnotationRecord>) => void;
  /** Merge one doc's annotation and schedule a persist to the hydrated scope. */
  update: (key: string, patch: Partial<Omit<DocAnnotationRecord, 'updatedAt'>>) => void;
}

let loadingScope: string | null = null;
// Keys edited since their last successful write, with an edit generation so a
// re-edit racing an in-flight write is never marked clean by that write.
let dirty = new Map<string, number>();
let dirtyScope: string | null = null;
let editGeneration = 0;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let failureToastShown = false;
let lifecycleArmed = false;

/** Toast lazily to avoid a static ui-store dependency from persistence code. */
function toastAnnotationFailure(message: string, gate?: () => boolean): void {
  if (gate && !gate()) return;
  void import('../store/uiStore')
    .then(({ useUiStore }) => useUiStore.getState().pushToast(message, 'warning'))
    .catch(() => undefined);
}

function toastSaveFailure(): void {
  toastAnnotationFailure("Couldn't save your notes — will keep retrying.", () => {
    if (failureToastShown) return false;
    failureToastShown = true;
    return true;
  });
}

/** The patch for one dirty key, read fresh from the store at write time. */
function patchFor(key: string): DocAnnotationRecord | null {
  const record = useAnnotationStore.getState().annotations[key];
  if (!record || isHusk(record)) return null;
  return record;
}

async function writeDirty(): Promise<void> {
  const scope = dirtyScope;
  if (!scope || dirty.size === 0) return;
  if (useAnnotationStore.getState().scope !== scope) {
    // Store was re-hydrated away without a flush (shouldn't happen — ensure
    // flushes first) — the values backing these keys are gone; drop them
    // rather than write another corpus's data.
    dirty = new Map();
    dirtyScope = null;
    return;
  }
  const snapshot = [...dirty.entries()];
  const patch: Record<string, DocAnnotationRecord | null> = {};
  for (const [key] of snapshot) patch[key] = patchFor(key);
  try {
    await updateCorpusAnnotations(scope, patch);
    for (const [key, generation] of snapshot) {
      if (dirty.get(key) === generation) dirty.delete(key);
    }
    if (dirty.size === 0) failureToastShown = false;
  } catch (error) {
    console.warn('[knowledge-nebula] annotation save failed', error);
    toastSaveFailure();
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void writeDirty();
    }, RETRY_AFTER_FAILURE_MS);
  }
}

/**
 * Reload / tab close / app hide must not eat the debounce window. Armed
 * lazily on first edit; fires a best-effort write (in-flight IndexedDB
 * transactions generally complete after pagehide).
 */
function armLifecycleFlush(): void {
  if (lifecycleArmed || typeof window === 'undefined') return;
  lifecycleArmed = true;
  const drain = () => void flushAnnotationSave();
  window.addEventListener('pagehide', drain);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') drain();
  });
}

function schedulePersist(): void {
  armLifecycleFlush();
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void writeDirty();
  }, SAVE_DEBOUNCE_MS);
}

/** Flush any pending annotation writes immediately (unload, panel close, tests). */
export async function flushAnnotationSave(): Promise<void> {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = null;
  await writeDirty();
}

export const useAnnotationStore = create<AnnotationState>((set, get) => ({
  scope: null,
  annotations: {},
  hydrate: (scope, annotations) => set({ scope, annotations: sanitize(annotations) }),
  update: (key, patch) => {
    const { scope, annotations } = get();
    if (!scope) return; // nowhere to persist — the UI gates on scope
    const current = annotations[key] ?? emptyAnnotation();
    const next: DocAnnotationRecord = { ...current, ...patch, updatedAt: Date.now() };
    const nextAll = { ...annotations };
    if (isEmpty(next)) delete nextAll[key];
    else nextAll[key] = next;
    set({ annotations: nextAll });
    dirtyScope = scope;
    dirty.set(key, ++editGeneration);
    schedulePersist();
  },
}));

/**
 * Ensure the store holds the active corpus's annotations. Cheap no-op when
 * already hydrated for that scope. Claims the scope before awaiting so
 * concurrent callers don't double-load; releases the claim on failure so a
 * later call retries.
 */
export async function ensureAnnotationsLoaded(corpusId: string): Promise<void> {
  const state = useAnnotationStore.getState();
  if (state.scope === corpusId || loadingScope === corpusId) return;
  loadingScope = corpusId;
  try {
    // Dirty edits for the OUTGOING scope must land before this store is
    // re-hydrated — writeDirty drops them once the backing values are gone.
    await flushAnnotationSave();
    const record = await getCorpusRecord(corpusId);
    // A switch may have happened while reading; only apply if still wanted.
    if (loadingScope !== corpusId) return;
    useAnnotationStore.getState().hydrate(corpusId, record?.annotations ?? {});
  } catch (error) {
    console.warn('[knowledge-nebula] annotation restore failed', error);
    // The Notes & Tags section stays hidden while the store isn't hydrated
    // for this corpus (hydrating empty here could overwrite real notes on the
    // next edit) — so without a toast this failure is completely invisible.
    toastAnnotationFailure("Couldn't load your notes and tags for this workspace.");
  } finally {
    if (loadingScope === corpusId) loadingScope = null;
  }
}

/** Test seam: reset module-level claim/debounce/dirty state between tests. */
export function _resetAnnotationsForTests(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  if (retryTimer) clearTimeout(retryTimer);
  debounceTimer = null;
  retryTimer = null;
  dirty = new Map();
  dirtyScope = null;
  loadingScope = null;
  failureToastShown = false;
  useAnnotationStore.setState({ scope: null, annotations: {} });
}

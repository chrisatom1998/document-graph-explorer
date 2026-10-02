/**
 * Per-corpus document annotations (notes, tags, pins) with lazy hydration
 * and debounced, per-key save-through persistence. A synchronous recovery
 * journal preserves edits if reload interrupts the debounce or database write.
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

import { clearJournalAnnotation, journalAnnotation, recoverAnnotations } from './annotationRecovery';

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
      updatedAt: Number.isSafeInteger(value.updatedAt) && value.updatedAt >= 0 ? value.updatedAt : 0,
    };
  }
  return out;
}

interface AnnotationState {
  /** Corpus id these annotations belong to; null until first hydration. */
  scope: string | null;
  annotations: Record<string, DocAnnotationRecord>;
  saveStatus: 'saved' | 'saving' | 'error';
  /** Replace everything (hydration). */
  hydrate: (scope: string, annotations: Record<string, DocAnnotationRecord>) => void;
  /** Merge one doc's annotation and schedule a persist to the hydrated scope. */
  update: (key: string, patch: Partial<Omit<DocAnnotationRecord, 'updatedAt'>>) => void;
  /** Apply a collaboration update while preserving its conflict timestamp. */
  applyRemote: (key: string, annotation: DocAnnotationRecord | null) => void;
}

let loadingScope: string | null = null;
let loadingPromise: Promise<boolean> | null = null;
let loadGeneration = 0;
// Retain values by workspace: a failed flush must survive replacing the UI's
// active annotations. Generations keep an older write from clearing a re-edit.
interface PendingAnnotation {
  generation: number;
  value: DocAnnotationRecord | null;
  journal: string | null;
  updatedAt: number;
  remoteBase?: DocAnnotationRecord | null;
}
let dirtyByScope = new Map<string, Map<string, PendingAnnotation>>();
let editGeneration = 0;
let versionsByScope = new Map<string, Map<string, number>>();
let writing: Promise<void> | null = null;
function observeVersion(scope: string, key: string, version: number): void {
  if (!Number.isSafeInteger(version) || version < 0) return;
  let versions = versionsByScope.get(scope);
  if (!versions) { versions = new Map(); versionsByScope.set(scope, versions); }
  versions.set(key, Math.max(versions.get(key) ?? 0, version));
}
function nextVersion(scope: string, key: string): number {
  return Math.max(Date.now(), (versionsByScope.get(scope)?.get(key) ?? 0) + 1);
}
function sameAnnotation(a: DocAnnotationRecord | null, b: DocAnnotationRecord | null): boolean {
  return a === b || Boolean(a && b && a.note === b.note && a.pinned === b.pinned && JSON.stringify(a.tags) === JSON.stringify(b.tags));
}
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

function markDirty(scope: string, key: string, record: DocAnnotationRecord | undefined, updatedAt: number, remoteBase?: DocAnnotationRecord | null): void {
  let dirty = dirtyByScope.get(scope);
  if (!dirty) {
    dirty = new Map();
    dirtyByScope.set(scope, dirty);
  }
  const value = !record || isHusk(record) ? null : record;
  const previousJournal = dirty.get(key)?.journal;
  const journal = journalAnnotation(scope, key, value, updatedAt);
  if (journal && previousJournal) clearJournalAnnotation(scope, key, previousJournal);
  dirty.set(key, {
    generation: ++editGeneration,
    value,
    journal,
    updatedAt, ...(remoteBase !== undefined ? { remoteBase } : {}),
  });
  observeVersion(scope, key, updatedAt);
  useAnnotationStore.setState({ saveStatus: 'saving' });
}

async function writeDirty(): Promise<void> {
  // Serialize this tab's flushes so a completed baseline is observed before
  // a newer edit is submitted. Cross-tab ordering is guarded in IndexedDB.
  while (writing) await writing;
  const batch = writeDirtyBatch();
  writing = batch;
  try { await batch; } finally { if (writing === batch) writing = null; }
}

async function writeDirtyBatch(): Promise<void> {
  let failed = false;
  for (const [scope, dirty] of [...dirtyByScope]) {
    const snapshot = [...dirty.entries()];
    const patch: Record<string, DocAnnotationRecord | null> = {};
    for (const [key, pending] of snapshot) patch[key] = pending.value;
    try {
      const versions = Object.fromEntries(snapshot.map(([key, pending]) => [key, pending.updatedAt]));
      const results = await updateCorpusAnnotations(scope, patch, versions, Object.fromEntries(snapshot.filter(([, pending]) => pending.remoteBase !== undefined).map(([key, pending]) => [key, pending.remoteBase!])));
      for (const [key, pending] of snapshot) {
        if (pending.journal) clearJournalAnnotation(scope, key, pending.journal);
        const result = results?.[key];
        if (result) observeVersion(scope, key, result.updatedAt);
        const later = dirty.get(key);
        // A newer live collaboration update may be based on our pending write.
        // Advance that baseline only if THIS write actually won, never when
        // another tab's different value was returned as the transaction winner.
        if (later && later.generation !== pending.generation && later.remoteBase !== undefined && result &&
            result.updatedAt === pending.updatedAt && sameAnnotation(result.value, pending.value) &&
            JSON.stringify(later.remoteBase) === JSON.stringify(pending.remoteBase)) later.remoteBase = result.value;
        if (dirty.get(key)?.generation === pending.generation) {
          dirty.delete(key);
          if (result && useAnnotationStore.getState().scope === scope && !sameAnnotation(pending.value, result.value)) {
            const annotations = { ...useAnnotationStore.getState().annotations };
            if (result.value) annotations[key] = result.value;
            else delete annotations[key];
            useAnnotationStore.setState({ annotations });
            toastAnnotationFailure('A competing saved edit was kept. The latest saved note and tags are now shown.');
          }
        }
      }
      if (dirty.size === 0 && dirtyByScope.get(scope) === dirty) dirtyByScope.delete(scope);
    } catch (error) {
      console.warn('[knowledge-nebula] annotation save failed', error);
      toastSaveFailure();
      failed = true;
    }
  }
  if (dirtyByScope.size === 0) failureToastShown = false;
  const activeDirty = dirtyByScope.get(useAnnotationStore.getState().scope ?? '');
  useAnnotationStore.setState({ saveStatus: activeDirty?.size ? (failed ? 'error' : 'saving') : 'saved' });
  if (failed) {
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
  saveStatus: 'saved',
  hydrate: (scope, annotations) => {
    const next = sanitize(annotations);
    for (const [key, value] of Object.entries(next)) observeVersion(scope, key, value.updatedAt);
    // A retry may still be pending when the user returns to this workspace.
    for (const [key, pending] of dirtyByScope.get(scope) ?? []) {
      if (pending.value === null) delete next[key];
      else next[key] = pending.value;
    }
    set({ scope, annotations: next, saveStatus: dirtyByScope.get(scope)?.size ? 'saving' : 'saved' });
  },
  update: (key, patch) => {
    const { scope, annotations } = get();
    if (!scope) return; // nowhere to persist — the UI gates on scope
    const current = annotations[key] ?? emptyAnnotation();
    const next: DocAnnotationRecord = { ...current, ...patch, updatedAt: nextVersion(scope, key) };
    const nextAll = { ...annotations };
    if (isEmpty(next)) delete nextAll[key];
    else nextAll[key] = next;
    // Publish the edit clock before subscribers propagate a deletion.
    markDirty(scope, key, nextAll[key], next.updatedAt);
    set({ annotations: nextAll });
    schedulePersist();
  },
  applyRemote: (key, annotation) => {
    const { scope, annotations } = get();
    // Legacy Y.Map removals carry no edit time. They cannot safely delete a
    // local note: a delayed removal is indistinguishable from a new deletion.
    if (!scope || !annotation) return;
    const nextAll = { ...annotations };
    const next = sanitize({ [key]: annotation })[key];
    if (!next) return;
    const pending = dirtyByScope.get(scope)?.get(key);
    const baseline = pending?.remoteBase !== undefined ? pending.remoteBase : annotations[key] ?? null;
    // Empty, timestamped records represent shared deletion tombstones.
    const updatedAt = next.updatedAt;
    if (updatedAt < (versionsByScope.get(scope)?.get(key) ?? 0)) return;
    if (!next || isEmpty(next)) delete nextAll[key];
    else nextAll[key] = next;
    markDirty(scope, key, nextAll[key], updatedAt, baseline);
    set({ annotations: nextAll });
    schedulePersist();
  },
}));

/** Snapshot for opt-in sharing, including timestamped deletion markers. */
export function annotationSyncSnapshot(): Record<string, DocAnnotationRecord> {
  const { scope, annotations } = useAnnotationStore.getState();
  const snapshot = { ...annotations };
  for (const [key, updatedAt] of versionsByScope.get(scope ?? '') ?? []) {
    if (!(key in snapshot)) snapshot[key] = { ...emptyAnnotation(), updatedAt };
  }
  return snapshot;
}

/**
 * Ensure the store holds the active corpus's annotations. Cheap no-op when
 * already hydrated for that scope. Concurrent callers await the same result;
 * false means a failed or superseded load and permits a later retry.
 */
export function ensureAnnotationsLoaded(corpusId: string): Promise<boolean> {
  if (loadingScope === corpusId && loadingPromise) return loadingPromise;
  const generation = ++loadGeneration;
  const state = useAnnotationStore.getState();
  if (state.scope === corpusId) {
    // Returning to the still-visible workspace cancels a pending switch away.
    loadingScope = null;
    loadingPromise = null;
    return Promise.resolve(true);
  }
  loadingScope = corpusId;
  loadingPromise = (async () => {
    try {
      // Failed outgoing saves retain their own payload for a later retry.
      await flushAnnotationSave();
      const record = await getCorpusRecord(corpusId);
      if (generation !== loadGeneration) return false;
      // Recover only this corpus, after reading its durable snapshot. A newer
      // committed annotation wins over an older interrupted write.
      for (const [key, version] of Object.entries(record?.annotationVersions ?? {})) observeVersion(corpusId, key, version);
      for (const recovered of recoverAnnotations(corpusId)) {
        const durable = Math.max(record?.annotationVersions?.[recovered.key] ?? 0, record?.annotations?.[recovered.key]?.updatedAt ?? 0);
        observeVersion(corpusId, recovered.key, durable);
        if (durable >= recovered.updatedAt) {
          clearJournalAnnotation(corpusId, recovered.key, recovered.serialized);
          continue;
        }
        let dirty = dirtyByScope.get(corpusId);
        if (!dirty) { dirty = new Map(); dirtyByScope.set(corpusId, dirty); }
        observeVersion(corpusId, recovered.key, recovered.updatedAt);
        if ((dirty.get(recovered.key)?.updatedAt ?? -1) < recovered.updatedAt) dirty.set(recovered.key, {
          generation: ++editGeneration, value: recovered.value, journal: recovered.serialized, updatedAt: recovered.updatedAt,
        });
      }
      useAnnotationStore.getState().hydrate(corpusId, record?.annotations ?? {});
      if (dirtyByScope.get(corpusId)?.size) schedulePersist();
      return true;
    } catch (error) {
      console.warn('[knowledge-nebula] annotation restore failed', error);
      if (generation === loadGeneration) {
        toastAnnotationFailure("Couldn't load your notes and tags for this workspace.");
      }
      return false;
    } finally {
      if (generation === loadGeneration) {
        loadingScope = null;
        loadingPromise = null;
      }
    }
  })();
  return loadingPromise;
}

/** Test seam: reset module-level claim/debounce/dirty state between tests. */
export function _resetAnnotationsForTests(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  if (retryTimer) clearTimeout(retryTimer);
  debounceTimer = null;
  retryTimer = null;
  dirtyByScope = new Map();
  versionsByScope = new Map();
  loadingScope = null;
  loadingPromise = null;
  loadGeneration++;
  failureToastShown = false;
  useAnnotationStore.setState({ scope: null, annotations: {}, saveStatus: 'saved' });
}

/**
 * Session persistence (spec §8.4, acceptance §11):
 * - auto-save 1.5s after the pipeline reaches 'ready'
 * - re-save positions 2.5s after the force layout settles (the cooled shape
 *   is what greets the user next visit)
 * - bulk restore on startup: target < 3s for ~200 docs, fully offline
 */

import { EMBED_DIMS, EMBEDDING_FINGERPRINT } from '../config';
import {
  layoutAddNodes,
  layoutReheat,
  layoutSetClusters,
  layoutSetLinks,
  onLayoutSettled,
} from '../layout/layoutBridge';
import type { GraphExport } from '../model/types';
import { computeLocalClusterNames } from '../graph/clusterNaming';
import { enqueueRun } from '../pipeline/runQueue';
import { useGraphStore } from '../store/graphStore';
import { useCorpusStore } from '../store/corpusStore';
import {
  chunkStore,
  captureDirtyDocs,
  docLinksStore,
  docVectorStore,
  mdLinkTargetsStore,
  markDocsClean,
  textStore,
} from '../store/runtimeStores';
// store/textHydration is loaded dynamically below: session.ts sits in the
// eager entry chunk (boot-time restore) and the hydration/LRU module belongs
// to the lazy pipeline graph — a static import here would put it (and its
// budgeted bytes) in the entry bundle.
import { useUiStore } from '../store/uiStore';
import {
  loadSnapshot,
  reportPersistenceUnavailable,
  saveDocsToCache,
  saveSnapshot,
  validChunkVectors,
  validDocVector,
} from './cache';
import { getDb } from './db';
import {
  activateCorpus,
  getCorpusRecord,
  initializeCorpusRepository,
} from './corpusRepository';
import { toGraphExport } from './graphExport';
import { collectPositions, saveGraphRecord, saveSession } from './sessionSave';
// validateImport is loaded dynamically at the one restore-time call below —
// like textHydration, it belongs to the lazy import/share graph, and a static
// import from this boot-path module would move it into the eager entry chunk.
import { flushPendingChatSave } from './chatHistorySync';

export { saveSession } from './sessionSave';

const FULL_SAVE_DEBOUNCE_MS = 1500;
const POSITION_SAVE_DEBOUNCE_MS = 2500;
let initialized = false;
let suppressAutoSave = false; // restoring is not a change worth re-saving
let fullSaveTimer: ReturnType<typeof setTimeout> | null = null;
let positionSaveTimer: ReturnType<typeof setTimeout> | null = null;

function handleLayoutSettled(): void {
  if (positionSaveTimer !== null) clearTimeout(positionSaveTimer);
  positionSaveTimer = setTimeout(() => {
    positionSaveTimer = null;
    saveGraphRecord().catch((err) =>
      console.warn('[knowledge-nebula] position save failed', err),
    );
  }, POSITION_SAVE_DEBOUNCE_MS);
}

/**
 * Wire auto-save. Idempotent; called once from App.
 * The settled listener is re-registered on every phase->ready transition
 * because layoutReset() (new corpus / import) clears the listener set —
 * onLayoutSettled is Set-backed, so re-adding the same fn never duplicates.
 */
export function initPersistence(): void {
  if (initialized) return;
  initialized = true;

  // Best-effort: ask the browser not to evict our IndexedDB data under
  // storage pressure. Unsupported/denied is silent — nothing to react to,
  // and cacheUnavailable() already surfaces the case where writes fail.
  if (navigator.storage?.persist) {
    navigator.storage.persist().catch(() => {});
  }

  onLayoutSettled(handleLayoutSettled);

  useGraphStore.subscribe((state, prev) => {
    if (state.phase === prev.phase) return;
    if (state.phase === 'ready') {
      onLayoutSettled(handleLayoutSettled); // survive layoutReset between corpora
      if (suppressAutoSave) return;
      if (fullSaveTimer !== null) clearTimeout(fullSaveTimer);
      fullSaveTimer = setTimeout(() => {
        fullSaveTimer = null;
        saveSession().catch((err) =>
          console.warn('[knowledge-nebula] session save failed', err),
        );
      }, FULL_SAVE_DEBOUNCE_MS);
    } else if (prev.phase === 'ready') {
      // corpus is changing again — pending snapshots would be stale
      if (fullSaveTimer !== null) {
        clearTimeout(fullSaveTimer);
        fullSaveTimer = null;
      }
      if (positionSaveTimer !== null) {
        clearTimeout(positionSaveTimer);
        positionSaveTimer = null;
      }
    }
  });
}
// ---------------------------------------------------------------------------
// Shared hydration logic (used by both session restore and snapshot restore)
// ---------------------------------------------------------------------------

/**
 * Hydrate graph store, runtime stores, and layout from the given data.
 * This is the shared code path for restoreSession() and restoreSnapshot().
 *
 * Records restored from IndexedDB are run through the same sanitizer as a
 * fresh untrusted import (sanitizeGraphExport): they can predate the
 * sanitizer's rules (older app versions), or drift from the current schema
 * in ways a hand-rolled shape check here wouldn't catch — dangling edges
 * still crash the layout worker's link initializer regardless of the data's
 * origin.
 */
export async function hydrateFromRecord(
  rawExportData: GraphExport,
  positions: Record<string, [number, number, number]>,
  corpusHash: string | null,
): Promise<boolean> {
  let exportData: GraphExport;
  try {
    // sanitizeGraphExport throws on a structurally unusable record (wrong
    // version, malformed node/edge arrays, or no valid nodes at all) —
    // exactly the cases the old manual check here used to catch by hand.
    const { sanitizeGraphExport } = await import('./validateImport');
    exportData = sanitizeGraphExport(rawExportData);
  } catch {
    return false; // malformed IndexedDB record — treat like "couldn't restore"
  }

  // --- bulk-read texts + vectors: one readonly tx, concurrent gets ---
  const docIds = exportData.nodes
    .filter((n) => n.kind === 'document')
    .map((n) => n.id);
  const db = await getDb();
  const tx = db.transaction(['documents', 'embeddings']);
  const docStore = tx.objectStore('documents');
  const embStore = tx.objectStore('embeddings');
  const [docRecs, embRecs] = await Promise.all([
    Promise.all(docIds.map((id) => docStore.get(id))),
    Promise.all(docIds.map((id) => embStore.get(id))),
  ]);
  let needsEmbeddingRebuild = false;
  const nodesById = new Map(exportData.nodes.map((node) => [node.id, node]));
  const persistedIds: string[] = [];

  for (let i = 0; i < docIds.length; i++) {
    const id = docIds[i];
    const doc = docRecs[i];
    const emb = embRecs[i];
    const compatible = emb?.fingerprint === EMBEDDING_FINGERPRINT;
    const docVectorValid = compatible && validDocVector(emb?.docVector);
    const chunkVectorsValid =
      compatible && doc !== undefined && validChunkVectors(emb?.chunkVectors, doc.chunkTexts.length);
    const node = nodesById.get(id);
    const canEmbed = doc !== undefined && node?.status !== 'unreadable' && doc.text.trim().length > 0;
    if (canEmbed && (!docVectorValid || (doc.chunkTexts.length > 0 && !chunkVectorsValid))) {
      needsEmbeddingRebuild = true;
    }
    if (doc) {
      textStore.set(id, doc.text);
      chunkStore.set(id, {
        texts: doc.chunkTexts,
        vectors: chunkVectorsValid ? emb!.chunkVectors : null,
        dims: EMBED_DIMS,
      });
      mdLinkTargetsStore.set(id, doc.mdLinkTargets ?? []);
      docLinksStore.set(id, doc.docLinks ?? []);
      persistedIds.push(id); // this record was just read FROM the DB
    }
    if (docVectorValid) docVectorStore.set(id, emb!.docVector);
  }
  const { evictDocTexts, markDocsPersisted } = await import('../store/textHydration');
  markDocsPersisted(persistedIds);

  // --- hydrate graph store ---
  const g = useGraphStore.getState();
  g.addNodes(exportData.nodes);
  g.setEdges(exportData.edges);
  g.setClusterNames(exportData.clusterNames ?? {});
  // No semantic pass runs on restore, so recompute the keyword-derived names here.
  g.setLocalClusterNames(computeLocalClusterNames(exportData.nodes));
  if (corpusHash) g.setCorpusHash(corpusHash);
  suppressAutoSave = true;
  try {
    g.setPhase('ready'); // subscriber runs synchronously — keep it suppressed
  } finally {
    suppressAutoSave = false;
  }

  // --- hydrate layout at the exact settled positions ---
  layoutAddNodes(
    exportData.nodes.map((n) => ({
      id: n.id,
      cluster: n.cluster,
      initial: positions[n.id], // undefined -> layout picks a spawn (fallback)
    })),
  );
  layoutSetLinks(
    exportData.edges.map((e) => ({ source: e.source, target: e.target, weight: e.weight })),
  );
  layoutSetClusters(
    Object.fromEntries(exportData.nodes.map((n): [string, number] => [n.id, n.cluster])),
  );
  layoutReheat(0.03); // barely moves — restores the settled shape

  // Restore eagerly populated every doc's full text (simplest, and search
  // needs nothing extra); trim the resident set back to budget right away so
  // a large corpus doesn't start the visit hundreds of MB over.
  evictDocTexts();

  if (needsEmbeddingRebuild) {
    useUiStore.getState().pushToast('Search index updated — rebuilding local embeddings.', 'info');
    // Dynamic import preserves the existing persistence/coordinator cycle break.
    void import('../pipeline/coordinatorLazy')
      .then((m) => m.rebuildEmbeddings())
      .catch((err) => console.error('embedding rebuild after restore failed', err));
  }

  return true;
}

/**
 * Restore the last session from IndexedDB. Returns true on success.
 * Reads are bulk (single transaction, all gets issued up front) — no
 * per-record awaits — to hit the <3s acceptance target.
 */
export async function restoreSession(): Promise<boolean> {
  try {
    const activeId = await initializeCorpusRepository();
    const activeCorpus = await getCorpusRecord(activeId);
    // Restore the persisted ingest report up front: it exists even for a
    // corpus that never reached 'ready' (e.g. a first ingest that failed in
    // full), which is exactly when the report matters most.
    useGraphStore.getState().setIngestReport(activeCorpus?.ingestReport ?? null);
    const lastCorpusHash = activeCorpus?.corpusHash;
    if (!lastCorpusHash) return false; // no prior session — first visit, not a failure

    const cached = activeCorpus?.exportData
      ? { exportData: activeCorpus.exportData, positions: activeCorpus.positions ?? {} }
      : undefined;
    if (!cached) {
      useUiStore
        .getState()
        .pushToast("Your last session couldn't be found — starting fresh.", 'warning');
      return false;
    }
    const restored = await hydrateFromRecord(cached.exportData, cached.positions, lastCorpusHash);
    if (!restored) {
      useUiStore
        .getState()
        .pushToast("Your last session couldn't be restored — starting fresh.", 'warning');
    }
    return restored;
  } catch (err) {
    console.warn('[knowledge-nebula] session restore failed', err);
    reportPersistenceUnavailable(err);
    useCorpusStore.getState().setLocalState([], null);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Named snapshot save / restore
// ---------------------------------------------------------------------------

/**
 * Save the current graph state as a named snapshot.
 * Returns the snapshot ID on success, undefined on failure.
 */
export async function saveCurrentSnapshot(name: string): Promise<number | undefined> {
  const s = useGraphStore.getState();
  if (s.phase !== 'ready' || s.nodes.length === 0) return undefined;

  const corpusHash = s.corpusHash ?? 'unnamed';
  const corpusId = useCorpusStore.getState().activeCorpusId ?? undefined;
  const exportData = toGraphExport(false);
  const positions = collectPositions(s.nodes);
  const docHashes = s.nodes
    .filter((n) => n.kind === 'document')
    .map((n) => n.id);

  // Ensure documents + embeddings are persisted before snapshotting. Dirty
  // docs only: clean records already exist under the same content-hash keys,
  // and rewriting them from memory would clobber persisted text with '' for
  // any doc whose full text has been evicted (see store/textHydration).
  const pending = captureDirtyDocs();
  const docs = [...pending.keys()]
    .map((id) => s.nodes[s.nodeIndex[id]])
    .filter((node) => node?.kind === 'document')
    .map((node) => {
      const chunks = chunkStore.get(node.id);
      return {
        node,
        text: textStore.get(node.id) ?? '',
        chunkTexts: chunks?.texts ?? [],
        chunkVectors: chunks?.vectors ?? null,
        docVector: docVectorStore.get(node.id) ?? null,
        mdLinkTargets: mdLinkTargetsStore.get(node.id) ?? [],
        docLinks: docLinksStore.get(node.id) ?? [],
      };
    });
  const docsSaved = await saveDocsToCache(docs);
  if (!docsSaved) return undefined;
  const { markDocsPersisted } = await import('../store/textHydration');
  const savedIds = new Set(docs.map((d) => d.node.id));
  markDocsPersisted(markDocsClean(pending).filter((id) => savedIds.has(id)));

  return saveSnapshot(
    name,
    corpusHash,
    exportData,
    positions,
    docHashes,
    corpusId,
  );
}

/**
 * Restore a named snapshot by its IndexedDB ID.
 * Resets the current corpus first, then hydrates from the snapshot data.
 *
 * Routed through the shared run-queue (enqueueRun) so a restore can never
 * land concurrently with an in-flight ingest — both reset/repopulate the
 * graph store, runtime stores, and layout, and interleaving would corrupt
 * all three (CRITICAL: this is the same hazard importGraphJSONFile guards
 * against in exportImport.ts).
 */
export async function restoreSnapshotById(id: number): Promise<boolean> {
  const { suspendFolderWatcher } = await import('../ingest/folderWatcher');
  await suspendFolderWatcher();
  return enqueueRun(() => doRestoreSnapshotById(id));
}

async function doRestoreSnapshotById(id: number): Promise<boolean> {
  const { bindFolderWatcherToActiveCorpus } = await import('../ingest/folderWatcher');
  try {
    const rec = await loadSnapshot(id);
    if (!rec) return false;

    // Preserve the outgoing head before moving to the snapshot's owning
    // corpus. Legacy snapshots without an owner deliberately restore into the
    // current workspace, matching their pre-multi-corpus behavior.
    if (useGraphStore.getState().phase === 'ready') await saveSession();
    // Land the outgoing transcript before the active corpus moves, then mark
    // the switch so the reset's cleared message list is not persisted against
    // whichever corpus happens to be active when the debounce fires. Without
    // this, restoring a snapshot owned by another corpus could overwrite that
    // corpus's saved history with an empty one.
    await flushPendingChatSave();
    const switchingCorpus = Boolean(rec.corpusId && (await getCorpusRecord(rec.corpusId)));
    if (switchingCorpus) {
      useCorpusStore.getState().setSwitching(true);
      await activateCorpus(rec.corpusId!);
    }

    try {
      // Import resetCorpus dynamically to avoid circular dependency. The lazy
      // facade keeps coordinator itself from becoming a mixed import target.
      const { resetCorpus } = await import('../pipeline/coordinatorLazy');
      resetCorpus();

      const restored = await hydrateFromRecord(rec.exportData, rec.positions ?? {}, rec.corpusHash);
      return restored;
    } finally {
      if (switchingCorpus) useCorpusStore.getState().setSwitching(false);
    }
  } catch (err) {
    console.warn('[knowledge-nebula] snapshot restore failed', err);
    return false;
  } finally {
    await bindFolderWatcherToActiveCorpus().catch(() => undefined);
  }
}

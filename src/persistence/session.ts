/**
 * Session persistence (spec §8.4, acceptance §11):
 * - auto-save 1.5s after the pipeline reaches 'ready'
 * - re-save positions 2.5s after the force layout settles (the cooled shape
 *   is what greets the user next visit)
 * - bulk restore on startup: target < 3s for ~200 docs, fully offline
 */

import { EMBED_DIMS } from '../config';
import {
  layoutAddNodes,
  layoutReheat,
  layoutSetClusters,
  layoutSetLinks,
  onLayoutSettled,
} from '../layout/layoutBridge';
import type { DocNode, GraphExport } from '../model/types';
import { getNodePosition } from '../scene/positionBuffer';
import { useGraphStore } from '../store/graphStore';
import { chunkStore, docVectorStore, mdLinkTargetsStore, textStore } from '../store/runtimeStores';
import { useUiStore } from '../store/uiStore';
import {
  getSetting,
  loadSnapshot,
  lookupGraphCache,
  saveDocsToCache,
  saveGraphToCache,
  saveSnapshot,
  setSetting,
} from './cache';
import { getDb } from './db';
import { toGraphExport } from './exportImport';

const FULL_SAVE_DEBOUNCE_MS = 1500;
const POSITION_SAVE_DEBOUNCE_MS = 2500;

let initialized = false;
let suppressAutoSave = false; // restoring is not a change worth re-saving
let fullSaveTimer: ReturnType<typeof setTimeout> | null = null;
let positionSaveTimer: ReturnType<typeof setTimeout> | null = null;

function collectPositions(nodes: DocNode[]): Record<string, [number, number, number]> {
  const positions: Record<string, [number, number, number]> = {};
  for (const n of nodes) {
    const p = getNodePosition(n.id);
    if (p) positions[n.id] = p;
  }
  return positions;
}

/** Refresh only the graphs record (positions + current graph snapshot). */
async function saveGraphRecord(): Promise<void> {
  const s = useGraphStore.getState();
  if (s.phase !== 'ready' || !s.corpusHash || s.nodes.length === 0) return;
  const positions = collectPositions(s.nodes);
  if (Object.keys(positions).length === 0) return;
  await saveGraphToCache(s.corpusHash, toGraphExport(false), positions);
}

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

export async function saveSession(): Promise<void> {
  const s = useGraphStore.getState();
  if (!s.corpusHash || s.nodes.length === 0) return;
  if (s.phase !== 'ready') return; // never persist a half-built graph
  const corpusHash = s.corpusHash;

  // Session cache never embeds vectors in exportData — they live natively
  // (and much faster) in the embeddings store.
  const exportData = toGraphExport(false);
  const positions = collectPositions(s.nodes);

  const docs = s.nodes
    .filter((n) => n.kind === 'document')
    .map((node) => {
      const chunks = chunkStore.get(node.id);
      return {
        node,
        text: textStore.get(node.id) ?? '',
        chunkTexts: chunks?.texts ?? [],
        chunkVectors: chunks?.vectors ?? null,
        docVector: docVectorStore.get(node.id) ?? null,
        mdLinkTargets: mdLinkTargetsStore.get(node.id) ?? [],
      };
    });

  await Promise.all([
    saveGraphToCache(corpusHash, exportData, positions),
    saveDocsToCache(docs),
  ]);
  await setSetting('lastCorpusHash', corpusHash);
}

// ---------------------------------------------------------------------------
// Shared hydration logic (used by both session restore and snapshot restore)
// ---------------------------------------------------------------------------

/**
 * Hydrate graph store, runtime stores, and layout from the given data.
 * This is the shared code path for restoreSession() and restoreSnapshot().
 */
async function hydrateFromRecord(
  exportData: GraphExport,
  positions: Record<string, [number, number, number]>,
  corpusHash: string | null,
): Promise<boolean> {
  if (
    exportData.version !== 1 ||
    !Array.isArray(exportData.nodes) ||
    !Array.isArray(exportData.edges) ||
    exportData.nodes.length === 0
  ) {
    return false;
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

  for (let i = 0; i < docIds.length; i++) {
    const id = docIds[i];
    const doc = docRecs[i];
    const emb = embRecs[i];
    if (doc) {
      textStore.set(id, doc.text);
      chunkStore.set(id, {
        texts: doc.chunkTexts,
        vectors: emb && emb.chunkVectors.length > 0 ? emb.chunkVectors : null,
        dims: EMBED_DIMS,
      });
      mdLinkTargetsStore.set(id, doc.mdLinkTargets ?? []);
    }
    if (emb && emb.docVector.length > 0) docVectorStore.set(id, emb.docVector);
  }

  // --- hydrate graph store ---
  const g = useGraphStore.getState();
  g.addNodes(exportData.nodes);
  g.setEdges(exportData.edges);
  g.setClusterNames(exportData.clusterNames ?? {});
  g.patchNodes(new Map()); // no-op patch recomputes clusterCount (addNodes does not)
  if (corpusHash) g.setCorpusHash(corpusHash);
  g.setRestoredFromCache(true);
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

  return true;
}

/**
 * Restore the last session from IndexedDB. Returns true on success.
 * Reads are bulk (single transaction, all gets issued up front) — no
 * per-record awaits — to hit the <3s acceptance target.
 */
export async function restoreSession(): Promise<boolean> {
  const lastCorpusHash = await getSetting<string>('lastCorpusHash');
  if (!lastCorpusHash) return false; // no prior session — first visit, not a failure

  try {
    const cached = await lookupGraphCache(lastCorpusHash);
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
    useUiStore
      .getState()
      .pushToast("Your last session couldn't be restored — starting fresh.", 'warning');
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
  const exportData = toGraphExport(false);
  const positions = collectPositions(s.nodes);
  const docHashes = s.nodes
    .filter((n) => n.kind === 'document')
    .map((n) => n.id);

  // Ensure documents + embeddings are persisted before snapshotting
  const docs = s.nodes
    .filter((n) => n.kind === 'document')
    .map((node) => {
      const chunks = chunkStore.get(node.id);
      return {
        node,
        text: textStore.get(node.id) ?? '',
        chunkTexts: chunks?.texts ?? [],
        chunkVectors: chunks?.vectors ?? null,
        docVector: docVectorStore.get(node.id) ?? null,
        mdLinkTargets: mdLinkTargetsStore.get(node.id) ?? [],
      };
    });
  await saveDocsToCache(docs);

  return saveSnapshot(name, corpusHash, exportData, positions, docHashes);
}

/**
 * Restore a named snapshot by its IndexedDB ID.
 * Resets the current corpus first, then hydrates from the snapshot data.
 */
export async function restoreSnapshotById(id: number): Promise<boolean> {
  try {
    const rec = await loadSnapshot(id);
    if (!rec) return false;

    // Import resetCorpus dynamically to avoid circular dependency
    const { resetCorpus } = await import('../pipeline/coordinator');
    resetCorpus();

    return await hydrateFromRecord(rec.exportData, rec.positions ?? {}, rec.corpusHash);
  } catch (err) {
    console.warn('[knowledge-nebula] snapshot restore failed', err);
    return false;
  }
}


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
import type { DocNode, GraphExport } from '../model/types';
import { computeLocalClusterNames } from '../graph/clusterNaming';
import { enqueueRun } from '../pipeline/coordinator';
import { getNodePosition } from '../scene/positionBuffer';
import { useGraphStore } from '../store/graphStore';
import {
  chunkStore,
  docLinksStore,
  docVectorStore,
  mdLinkTargetsStore,
  textStore,
} from '../store/runtimeStores';
import { useUiStore } from '../store/uiStore';
import {
  deleteDocsFromCache,
  deleteGraphFromCache,
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
import { sanitizeGraphExport } from './validateImport';

const FULL_SAVE_DEBOUNCE_MS = 1500;
const POSITION_SAVE_DEBOUNCE_MS = 2500;
const DEMO_MANIFEST_URL = '/demo/manifest.json';

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

async function isDemoOnlySession(exportData: GraphExport): Promise<boolean> {
  const docs = exportData.nodes.filter((n) => n.kind === 'document');
  if (docs.length === 0) return false;

  try {
    const res = await fetch(DEMO_MANIFEST_URL);
    if (!res.ok) return false;
    const manifest = (await res.json()) as { files?: unknown };
    if (!Array.isArray(manifest.files)) return false;

    const demoFiles = new Set(
      manifest.files.filter((name): name is string => typeof name === 'string'),
    );
    return docs.every((doc) => {
      const path = doc.path ?? doc.title;
      const name = path.replace(/\\/g, '/').split('/').pop() ?? path;
      return doc.lastModified === undefined && demoFiles.has(name);
    });
  } catch {
    // network hiccup / offline / malformed manifest JSON — treat the
    // session as "not demo-only" rather than letting restoreSession's
    // caller see an uncaught rejection over what's meant to be a cheap,
    // best-effort check.
    return false;
  }
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
        docLinks: docLinksStore.get(node.id) ?? [],
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
 *
 * Records restored from IndexedDB are run through the same sanitizer as a
 * fresh untrusted import (sanitizeGraphExport): they can predate the
 * sanitizer's rules (older app versions), or drift from the current schema
 * in ways a hand-rolled shape check here wouldn't catch — dangling edges
 * still crash the layout worker's link initializer regardless of the data's
 * origin.
 */
async function hydrateFromRecord(
  rawExportData: GraphExport,
  positions: Record<string, [number, number, number]>,
  corpusHash: string | null,
): Promise<boolean> {
  let exportData: GraphExport;
  try {
    // sanitizeGraphExport throws on a structurally unusable record (wrong
    // version, malformed node/edge arrays, or no valid nodes at all) —
    // exactly the cases the old manual check here used to catch by hand.
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

  for (let i = 0; i < docIds.length; i++) {
    const id = docIds[i];
    const doc = docRecs[i];
    const emb = embRecs[i];
    const compatible = emb?.fingerprint === EMBEDDING_FINGERPRINT;
    if (doc && emb && !compatible && (emb.docVector.length > 0 || emb.chunkVectors.length > 0)) {
      needsEmbeddingRebuild = true;
    }
    if (doc) {
      textStore.set(id, doc.text);
      chunkStore.set(id, {
        texts: doc.chunkTexts,
        vectors: compatible && emb && emb.chunkVectors.length > 0 ? emb.chunkVectors : null,
        dims: EMBED_DIMS,
      });
      mdLinkTargetsStore.set(id, doc.mdLinkTargets ?? []);
      docLinksStore.set(id, doc.docLinks ?? []);
    }
    if (compatible && emb && emb.docVector.length > 0) docVectorStore.set(id, emb.docVector);
  }

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

  if (needsEmbeddingRebuild) {
    useUiStore.getState().pushToast('Search index updated — rebuilding local embeddings.', 'info');
    // Dynamic import preserves the existing persistence/coordinator cycle break.
    void import('../pipeline/coordinator')
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
    if (await isDemoOnlySession(cached.exportData)) {
      const docIds = cached.exportData.nodes
        .filter((n) => n.kind === 'document')
        .map((n) => n.id);
      await Promise.all([
        deleteDocsFromCache(docIds),
        deleteGraphFromCache(lastCorpusHash),
        setSetting('lastCorpusHash', ''),
      ]);
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
        docLinks: docLinksStore.get(node.id) ?? [],
      };
    });
  await saveDocsToCache(docs);

  return saveSnapshot(name, corpusHash, exportData, positions, docHashes);
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
export function restoreSnapshotById(id: number): Promise<boolean> {
  return enqueueRun(() => doRestoreSnapshotById(id));
}

async function doRestoreSnapshotById(id: number): Promise<boolean> {
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


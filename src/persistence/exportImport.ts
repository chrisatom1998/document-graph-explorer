/**
 * GraphExport JSON round-trip + PNG snapshot.
 *
 * Privacy: GraphExport carries graph data only (and, opt-in, base64 doc
 * vectors). The API key and other settings never leave localStorage.
 *
 * Import note: GraphExport contains no full text or chunk vectors, so an
 * imported graph reads/searches at reduced fidelity by design — semantic
 * search uses doc vectors when the export included embeddings, while lexical
 * search and local chat fall back to exported summaries/topics/keywords.
 */

import { refreshMusicEdges } from '../audio/musicLinks';
import { versionWorkPending } from '../audio/versionLinks';
import { EMBED_DIMS } from '../config';
import {
  layoutAddNodes,
  layoutReheat,
  layoutSetClusters,
  layoutSetLinks,
} from '../layout/layoutBridge';
import type { DocNode, Edge, GraphExport } from '../model/types';
import { computeLocalClusterNames } from '../graph/clusterNaming';
import { enqueueRun } from '../pipeline/runQueue';
import { randomSpherePoint } from '../pipeline/spawnPosition';
import { useGraphStore } from '../store/graphStore';
import { useCorpusStore } from '../store/corpusStore';
import { docVectorStore } from '../store/runtimeStores';
import { useSettingsStore } from '../store/settingsStore';
import { captureSceneCanvas } from '../scene/sceneCapture';
import { sanitizeGraphExport } from './validateImport';
import { base64ToF32, f32ToBase64 } from './f32base64';
import { toGraphExport } from './graphExport';

export { base64ToF32, f32ToBase64 };
export { toGraphExport } from './graphExport';

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export function dateStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5_000);
}

export async function exportGraphJSON(): Promise<void> {
  const includeEmbeddings = useSettingsStore.getState().includeEmbeddingsInExport;
  const data = toGraphExport(includeEmbeddings);
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  downloadBlob(blob, `document-graph-explorer-${dateStamp()}.json`);
}

/**
 * Canvas snapshot. The scene renders WITHOUT preserveDrawingBuffer (a
 * per-frame cost), so captureSceneCanvas renders a fresh frame and we must
 * grab the pixels synchronously in the same task — toBlob captures the
 * bitmap at call time (only the encoding is async), so this is safe.
 */
export function exportScenePNG(): Promise<boolean> {
  return new Promise((resolve) => {
    const canvas = captureSceneCanvas();
    if (!canvas || typeof canvas.toBlob !== 'function') {
      console.warn('[knowledge-nebula] no canvas found - nothing to export');
      resolve(false);
      return;
    }
    try {
      canvas.toBlob((blob) => {
        if (!blob) {
          resolve(false);
          return;
        }
        downloadBlob(blob, `document-graph-explorer-${dateStamp()}.png`);
        resolve(true);
      }, 'image/png');
    } catch (err) {
      console.warn('[knowledge-nebula] PNG export failed', err);
      resolve(false);
    }
  });
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

/** Random point on a loose spherical shell (radius 80–120) — fly-in origin for imported nodes. */
function randomShellPoint(): [number, number, number] {
  return randomSpherePoint(100, 20);
}

/**
 * Parse + validate a GraphExport file, reset the current corpus, and hydrate
 * stores + layout. Throws a descriptive Error on invalid input — callers
 * (Toolbar/UI) should try/catch and surface err.message.
 *
 * corpusHash is intentionally left null: exports carry no document text, so
 * auto-caching an imported session would overwrite good cached docs with
 * empty ones. Imported graphs live for the tab session (re-exportable).
 *
 * Routed through the shared run-queue (pipeline/coordinator.ts's
 * enqueueRun) so this can never interleave with an in-flight ingest —
 * both mutate the graph store, runtime stores, and layout, and an import
 * landing mid-ingest would corrupt all three.
 */
/**
 * Graph-export imports get their own size ceiling: config's
 * MAX_INGEST_FILE_BYTES (64 MB) is sized for a single ingested document, but a legitimate export
 * of a near-ceiling corpus with embeddings included is bigger on its own
 * (32,768 nodes × 384 f32 dims ≈ 67 MB of base64 vectors before any node or
 * edge data). 256 MB comfortably covers the largest export this app can
 * produce while still bounding what an untrusted file can make us buffer.
 */
const MAX_IMPORT_GRAPH_FILE_BYTES = 256 * 1024 * 1024;
let graphImportGeneration = 0;

export async function importGraphJSONFile(file: File): Promise<{ nodes: DocNode[]; edges: Edge[] }> {
  if (file.size > MAX_IMPORT_GRAPH_FILE_BYTES) {
    const maxMb = Math.round(MAX_IMPORT_GRAPH_FILE_BYTES / (1024 * 1024));
    throw new Error(
      `Import failed: file is too large (${Math.round(file.size / (1024 * 1024))} MB) — the maximum is ${maxMb} MB.`,
    );
  }
  const raw = await file.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Import failed: file is not valid JSON.');
  }
  const data = sanitizeGraphExport(parsed);

  // Stop and drain a watcher before entering the shared mutation queue. Doing
  // this inside the queued import could deadlock with a scan whose reconcile
  // job is already waiting behind the import.
  const { suspendFolderWatcher } = await import('../ingest/folderWatcher');
  graphImportGeneration += 1;
  await suspendFolderWatcher();
  return enqueueRun(() => doImportGraphExportData(data, 'imported'));
}

/** Apply already-decoded, untrusted graph data (for portable URL shares). */
export async function importGraphExportData(
  input: unknown,
  mode: 'shared' | 'imported' = 'shared',
  options: { signal?: AbortSignal } = {},
): Promise<{ nodes: DocNode[]; edges: Edge[] }> {
  options.signal?.throwIfAborted();
  const data = sanitizeGraphExport(input);
  const { suspendFolderWatcher } = await import('../ingest/folderWatcher');
  options.signal?.throwIfAborted();
  const generation = ++graphImportGeneration;
  await suspendFolderWatcher();
  try {
    return await enqueueRun(() => doImportGraphExportData(data, mode, options.signal), options);
  } catch (error) {
    if (options.signal?.aborted) {
      const isCurrent = () => graphImportGeneration === generation && useCorpusStore.getState().mode === 'local';
      try {
        const { tryResumeFolderWatcher } = await import('../ingest/folderWatcher');
        while (isCurrent()) {
          // A preceding queued restore can re-arm a scan after this drain.
          // Recovery yields the queue and retries if that happened, so its
          // bind never waits for a reconcile queued behind itself.
          await suspendFolderWatcher();
          if (!isCurrent()) break;
          if (await enqueueRun(() => tryResumeFolderWatcher(isCurrent))) break;
        }
      } catch { /* Keep the original cancellation if watching cannot resume. */ }
    }
    throw error;
  }
}

async function doImportGraphExportData(
  data: GraphExport,
  mode: 'shared' | 'imported',
  signal?: AbortSignal,
): Promise<{ nodes: DocNode[]; edges: Edge[] }> {
  const [{ resetCorpus }, { useCollabStore }] = await Promise.all([
    import('../pipeline/coordinatorLazy'), import('../collab/store'),
  ]);
  signal?.throwIfAborted();
  if (mode === 'shared') {
    // Populate the switcher's local list on a shared startup without loading
    // private graph contents. Registry writes belong inside the mutation queue.
    if (!useCorpusStore.getState().initialized) {
      const { initializeCorpusRepository } = await import('./corpusRepository');
      try {
        await initializeCorpusRepository();
      } catch (error) {
        const { reportPersistenceUnavailable } = await import('./cache');
        reportPersistenceUnavailable(error);
      } finally {
        // Registry initialization selects the last saved corpus. Its graph
        // has not been hydrated on this path: clear that ownership before an
        // abort releases the queue to a waiting drop or replacement link.
        if (useGraphStore.getState().nodes.length === 0) {
          useCorpusStore.getState().setEphemeral('Shared graph', 'shared');
        }
      }
      signal?.throwIfAborted();
    }
    // A link can now arrive while a local workspace is open. Preserve edits
    // and its debounced transcript before reset clears their in-memory state.
    const [{ saveSession }, { flushPendingChatSave }] = await Promise.all([
      import('./sessionSave'), import('./chatHistorySync'),
    ]);
    if (useGraphStore.getState().phase === 'ready') await saveSession();
    await flushPendingChatSave();
  }
  // A newer URL or component cleanup can cancel while imports/saves awaited.
  // From here through the store replacement there is no asynchronous gap.
  signal?.throwIfAborted();
  let nodes = data.nodes;
  let edges = refreshMusicEdges(nodes, data.edges);
  const versionsPending = versionWorkPending();

  // Clean slate first (pipeline owns worker/store/layout teardown).
  // Replacing one ephemeral graph with another does not change corpus id/mode.
  useCorpusStore.getState().setSwitching(true);
  try {
    useCollabStore.getState().leaveSession();
    resetCorpus();
    useCorpusStore
      .getState()
      .setEphemeral(mode === 'shared' ? 'Shared graph' : 'Imported graph', mode);
  } finally {
    useCorpusStore.getState().setSwitching(false);
  }

  const g = useGraphStore.getState();
  g.addNodes(nodes);
  g.setEdges(edges);
  g.setClusterNames(data.clusterNames ?? {});
  // Imports carry no pipeline passes, so derive keyword cluster names here.
  g.setLocalClusterNames(computeLocalClusterNames(nodes));

  if (data.embeddings) {
    for (const [id, b64] of Object.entries(data.embeddings)) {
      try {
        const vec = base64ToF32(b64);
        if (vec.length === EMBED_DIMS) docVectorStore.set(id, vec);
      } catch {
        /* skip malformed vector */
      }
    }
  }

  const dropped = layoutAddNodes(
    nodes.map((n) => ({ id: n.id, cluster: n.cluster, spawn: randomShellPoint() })),
  );
  if (dropped.length > 0) {
    // sanitizeGraphExport caps imports at MAX_NODES and resetCorpus emptied
    // the layout, so this only fires if validator and allocator ever drift.
    // Scrub the overflow rather than leave phantom store nodes (present in
    // counts, absent from the scene) or hand the worker dangling links.
    const gone = new Set(dropped);
    g.removeNodes(dropped);
    nodes = nodes.filter((n) => !gone.has(n.id));
    edges = edges.filter((e) => !gone.has(e.source) && !gone.has(e.target));
  }
  layoutSetLinks(
    edges.map((e) => ({
      source: e.source,
      target: e.target,
      weight: typeof e.weight === 'number' ? e.weight : 0.5,
    })),
  );
  layoutSetClusters(Object.fromEntries(nodes.map((n): [string, number] => [n.id, n.cluster])));
  layoutReheat(0.6); // no saved positions — run the layout hot

  g.setPhase('ready');
  // Version matching left over from the import refresh finishes in the background.
  if (versionsPending) {
    const { scheduleVersionCatchUp } = await import('../pipeline/coordinatorLazy');
    scheduleVersionCatchUp();
  }
  return { nodes, edges };
}

/**
 * GraphExport JSON round-trip + PNG snapshot.
 *
 * Privacy: GraphExport carries graph data only (and, opt-in, base64 doc
 * vectors). The Gemini key and other settings never leave localStorage.
 *
 * Import note: GraphExport contains no full text or chunk vectors, so an
 * imported graph reads/searches at reduced fidelity by design — semantic
 * search uses doc vectors when the export included embeddings, otherwise it
 * falls back to title/keyword matching.
 */

import { EMBED_DIMS } from '../config';
import {
  layoutAddNodes,
  layoutReheat,
  layoutSetClusters,
  layoutSetLinks,
} from '../layout/layoutBridge';
import type { GraphExport } from '../model/types';
import { computeLocalClusterNames } from '../graph/clusterNaming';
import { resetCorpus } from '../pipeline/coordinator';
import { useGraphStore } from '../store/graphStore';
import { docVectorStore } from '../store/runtimeStores';
import { useSettingsStore } from '../store/settingsStore';
import { sanitizeGraphExport } from './validateImport';
import { base64ToF32, f32ToBase64 } from './f32base64';

export { base64ToF32, f32ToBase64 };

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export function toGraphExport(includeEmbeddings: boolean): GraphExport {
  const s = useGraphStore.getState();
  const out: GraphExport = {
    version: 1,
    createdAt: new Date().toISOString(),
    generator: 'knowledge-nebula',
    includeEmbeddings,
    clusterNames: s.clusterNames,
    nodes: s.nodes,
    edges: s.edges,
  };
  if (includeEmbeddings) {
    const embeddings: Record<string, string> = {};
    for (const n of s.nodes) {
      const vec = docVectorStore.get(n.id);
      if (vec && vec.length > 0) embeddings[n.id] = f32ToBase64(vec);
    }
    out.embeddings = embeddings;
  }
  return out;
}

function dateStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

function downloadBlob(blob: Blob, filename: string): void {
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

/** Canvas snapshot (scene renders with preserveDrawingBuffer). */
export function exportScenePNG(): void {
  const canvas = document.querySelector('canvas');
  if (!canvas) {
    console.warn('[knowledge-nebula] no canvas found — nothing to export');
    return;
  }
  canvas.toBlob((blob) => {
    if (blob) downloadBlob(blob, `document-graph-explorer-${dateStamp()}.png`);
  }, 'image/png');
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

/** Random point on a loose spherical shell — fly-in origin for imported nodes. */
function randomShellPoint(): [number, number, number] {
  const u = Math.random() * 2 - 1; // cos(theta), uniform on sphere
  const phi = Math.random() * Math.PI * 2;
  const s = Math.sqrt(Math.max(0, 1 - u * u));
  const r = 80 + Math.random() * 40;
  return [r * s * Math.cos(phi), r * s * Math.sin(phi), r * u];
}

/**
 * Parse + validate a GraphExport file, reset the current corpus, and hydrate
 * stores + layout. Throws a descriptive Error on invalid input — callers
 * (Toolbar/UI) should try/catch and surface err.message.
 *
 * corpusHash is intentionally left null: exports carry no document text, so
 * auto-caching an imported session would overwrite good cached docs with
 * empty ones. Imported graphs live for the tab session (re-exportable).
 */
export async function importGraphJSONFile(file: File): Promise<void> {
  const raw = await file.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Import failed: file is not valid JSON.');
  }
  // Untrusted input: sanitizeGraphExport type-checks and clamps every field
  // before anything reaches React, the layout worker, or IndexedDB.
  const data: GraphExport = sanitizeGraphExport(parsed);
  const nodes = data.nodes;
  const edges = data.edges;

  // Clean slate first (pipeline owns worker/store/layout teardown).
  resetCorpus();

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

  layoutAddNodes(
    nodes.map((n) => ({ id: n.id, cluster: n.cluster, spawn: randomShellPoint() })),
  );
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
}

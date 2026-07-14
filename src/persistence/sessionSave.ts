import type { DocNode } from '../model/types';
import { getNodePosition } from '../scene/positionBuffer';
import { useGraphStore } from '../store/graphStore';
import {
  chunkStore,
  docLinksStore,
  docVectorStore,
  mdLinkTargetsStore,
  textStore,
} from '../store/runtimeStores';
import {
  reportPersistenceUnavailable,
  saveDocsToCache,
  saveGraphToCache,
  setSetting,
} from './cache';
import { saveActiveCorpusPositions, saveActiveCorpusSnapshot } from './corpusRepository';
import { toGraphExport } from './graphExport';

export function collectPositions(nodes: DocNode[]): Record<string, [number, number, number]> {
  const positions: Record<string, [number, number, number]> = {};
  for (const node of nodes) {
    const position = getNodePosition(node.id);
    if (position) positions[node.id] = position;
  }
  return positions;
}

/** Refresh only the graph record (positions plus current graph snapshot). */
export async function saveGraphRecord(): Promise<void> {
  const state = useGraphStore.getState();
  if (state.phase !== 'ready' || !state.corpusHash || state.nodes.length === 0) return;
  const positions = collectPositions(state.nodes);
  if (Object.keys(positions).length === 0) return;
  const exportData = toGraphExport(false);
  await Promise.all([
    saveGraphToCache(state.corpusHash, exportData, positions),
    saveActiveCorpusPositions(state.corpusHash, exportData, positions).catch(
      reportPersistenceUnavailable,
    ),
  ]);
}

/** Persist a complete ready session without importing the coordinator. */
export async function saveSession(): Promise<void> {
  const state = useGraphStore.getState();
  if (!state.corpusHash || state.nodes.length === 0 || state.phase !== 'ready') return;
  const corpusHash = state.corpusHash;
  const exportData = toGraphExport(false);
  const positions = collectPositions(state.nodes);
  const docs = state.nodes
    .filter((node) => node.kind === 'document')
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
    saveActiveCorpusSnapshot(corpusHash, exportData, positions).catch(
      reportPersistenceUnavailable,
    ),
  ]);
  await setSetting('lastCorpusHash', corpusHash);
}

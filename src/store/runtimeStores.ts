/**
 * Heavy per-document data kept OUTSIDE React/zustand on purpose:
 * full text and chunk vectors never trigger re-renders and are read
 * imperatively by the reader panel and semantic search.
 */

export const textStore = new Map<string, string>(); // docId -> full text

export interface ChunkData {
  texts: string[];
  vectors: Float32Array | null; // flattened [n * dims]
  dims: number;
}
export const chunkStore = new Map<string, ChunkData>();

export const docVectorStore = new Map<string, Float32Array>(); // docId -> doc vector

/**
 * docId -> markdown link targets, persisted across reloads so reference
 * edges survive session/snapshot restore. Not recoverable from extracted
 * text (link syntax is gone by then), so it must be cached explicitly
 * rather than reconstructed by the 'analyze' backfill pass.
 */
export const mdLinkTargetsStore = new Map<string, string[]>();

export function clearRuntimeStores(): void {
  textStore.clear();
  chunkStore.clear();
  docVectorStore.clear();
  mdLinkTargetsStore.clear();
}

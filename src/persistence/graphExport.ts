import type { GraphExport } from '../model/types';
import { useGraphStore } from '../store/graphStore';
import { docVectorStore } from '../store/runtimeStores';
import { f32ToBase64 } from './f32base64';

/** Build the portable graph payload without importing the mutation pipeline. */
export function toGraphExport(includeEmbeddings: boolean): GraphExport {
  const state = useGraphStore.getState();
  const output: GraphExport = {
    version: 1,
    createdAt: new Date().toISOString(),
    generator: 'knowledge-nebula',
    includeEmbeddings,
    clusterNames: state.clusterNames,
    nodes: state.nodes,
    edges: state.edges,
  };
  if (includeEmbeddings) {
    const embeddings: Record<string, string> = {};
    for (const node of state.nodes) {
      const vector = docVectorStore.get(node.id);
      if (vector && vector.length > 0) embeddings[node.id] = f32ToBase64(vector);
    }
    output.embeddings = embeddings;
  }
  return output;
}

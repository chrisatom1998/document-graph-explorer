import { create } from 'zustand';
import type {
  DocNode,
  Edge,
  FileStatus,
  PipelinePhase,
} from '../model/types';

interface GraphState {
  nodes: DocNode[];
  nodeIndex: Record<string, number>; // id -> index into nodes
  edges: Edge[];
  clusterNames: Record<number, string>;
  clusterCount: number;
  phase: PipelinePhase;
  fileStatuses: Record<string, FileStatus>;
  ignoredFiles: { name: string; reason: string }[];
  modelProgress: { loaded: number; total: number; note: string } | null;
  /** Live enrichment progress (Gemini passes); null outside 'enriching'. */
  enrichProgress: { done: number; total: number; note: string } | null;
  corpusHash: string | null;
  restoredFromCache: boolean;

  addNodes: (nodes: DocNode[]) => void;
  patchNodes: (patches: Map<string, Partial<DocNode>>) => void;
  removeNodes: (ids: string[]) => void;
  setEdges: (edges: Edge[]) => void;
  setClusterNames: (names: Record<number, string>) => void;
  setPhase: (phase: PipelinePhase) => void;
  setFileStatus: (status: FileStatus) => void;
  addIgnored: (name: string, reason: string) => void;
  setModelProgress: (p: GraphState['modelProgress']) => void;
  setEnrichProgress: (p: GraphState['enrichProgress']) => void;
  setCorpusHash: (h: string | null) => void;
  setRestoredFromCache: (v: boolean) => void;
  clearIngestTray: () => void;
  reset: () => void;
}

export const useGraphStore = create<GraphState>((set) => ({
  nodes: [],
  nodeIndex: {},
  edges: [],
  clusterNames: {},
  clusterCount: 0,
  phase: 'idle',
  fileStatuses: {},
  ignoredFiles: [],
  modelProgress: null,
  enrichProgress: null,
  corpusHash: null,
  restoredFromCache: false,

  addNodes: (incoming) =>
    set((s) => {
      const nodes = s.nodes.slice();
      const nodeIndex = { ...s.nodeIndex };
      for (const n of incoming) {
        if (nodeIndex[n.id] !== undefined) continue; // content-hash dedupe
        nodeIndex[n.id] = nodes.length;
        nodes.push(n);
      }
      return { nodes, nodeIndex };
    }),

  patchNodes: (patches) =>
    set((s) => {
      const nodes = s.nodes.map((n) => {
        const patch = patches.get(n.id);
        return patch ? { ...n, ...patch } : n;
      });
      const clusterCount =
        1 + nodes.reduce((m, n) => Math.max(m, n.cluster), -1);
      return { nodes, clusterCount: Math.max(clusterCount, s.clusterCount) };
    }),

  removeNodes: (ids) =>
    set((s) => {
      const gone = new Set(ids);
      const kept = s.nodes.filter((n) => !gone.has(n.id));
      if (kept.length === s.nodes.length) return s;
      const nodeIndex: Record<string, number> = {};
      kept.forEach((n, i) => {
        nodeIndex[n.id] = i;
      });
      const edges = s.edges.filter((e) => !gone.has(e.source) && !gone.has(e.target));
      const degree: Record<string, number> = {};
      for (const e of edges) {
        degree[e.source] = (degree[e.source] ?? 0) + 1;
        degree[e.target] = (degree[e.target] ?? 0) + 1;
      }
      const nodes = kept.map((n) =>
        (degree[n.id] ?? 0) !== n.degree ? { ...n, degree: degree[n.id] ?? 0 } : n,
      );
      return { nodes, nodeIndex, edges };
    }),

  setEdges: (edges) =>
    set((s) => {
      // recompute degree
      const degree: Record<string, number> = {};
      for (const e of edges) {
        degree[e.source] = (degree[e.source] ?? 0) + 1;
        degree[e.target] = (degree[e.target] ?? 0) + 1;
      }
      const nodes = s.nodes.map((n) =>
        (degree[n.id] ?? 0) !== n.degree ? { ...n, degree: degree[n.id] ?? 0 } : n,
      );
      return { edges, nodes };
    }),

  setClusterNames: (clusterNames) => set({ clusterNames }),
  setPhase: (phase) => set({ phase }),
  setFileStatus: (status) =>
    set((s) => ({ fileStatuses: { ...s.fileStatuses, [status.fileId]: status } })),
  addIgnored: (name, reason) =>
    set((s) => ({ ignoredFiles: [...s.ignoredFiles, { name, reason }] })),
  setModelProgress: (modelProgress) => set({ modelProgress }),
  setEnrichProgress: (enrichProgress) => set({ enrichProgress }),
  setCorpusHash: (corpusHash) => set({ corpusHash }),
  setRestoredFromCache: (restoredFromCache) => set({ restoredFromCache }),
  clearIngestTray: () => set({ fileStatuses: {}, ignoredFiles: [] }),
  reset: () =>
    set({
      nodes: [],
      nodeIndex: {},
      edges: [],
      clusterNames: {},
      clusterCount: 0,
      phase: 'idle',
      fileStatuses: {},
      ignoredFiles: [],
      modelProgress: null,
      enrichProgress: null,
      corpusHash: null,
      restoredFromCache: false,
    }),
}));

/** Adjacency map derived from edges; rebuilt only when edges change. */
export function buildAdjacency(edges: Edge[]): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  for (const e of edges) {
    if (!adj.has(e.source)) adj.set(e.source, new Set());
    if (!adj.has(e.target)) adj.set(e.target, new Set());
    adj.get(e.source)!.add(e.target);
    adj.get(e.target)!.add(e.source);
  }
  return adj;
}

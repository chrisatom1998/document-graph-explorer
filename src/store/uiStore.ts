import { create } from 'zustand';
import type { FileType } from '../model/types';

export type QualityTier = 0 | 1 | 2 | 3 | 4; // 0 = ultra … 4 = suggest 2D

export interface CameraCommand {
  nonce: number; // bump to re-trigger
  kind: 'frameNode' | 'frameSet' | 'fitAll';
  ids?: string[];
}

export type ToastKind = 'error' | 'warning' | 'info';

export interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
}

export interface GraphFilter {
  fileTypes: FileType[] | null; // null = all
  clusters: number[] | null;
  minDegree: number;
  minEdgeWeight: number; // 0..1 — hide edges below this weight (spec §9 hairball slider)
}

interface UiState {
  hoveredId: string | null;
  selectedId: string | null;
  selectedEdgeId: string | null;
  searchOpen: boolean;
  searchResults: string[] | null; // null = no active search
  filter: GraphFilter;
  dims: 2 | 3;
  topicNodesEnabled: boolean;
  clusterCollapsed: boolean; // super-node collapse mode (spec §9)
  qualityTier: QualityTier;
  autoQuality: boolean;
  cameraCommand: CameraCommand | null;
  settingsOpen: boolean;
  insightsOpen: boolean;
  snapshotsOpen: boolean;
  toasts: Toast[];

  setHovered: (id: string | null) => void;
  setSelected: (id: string | null) => void;
  setSelectedEdge: (id: string | null) => void;
  setSearchOpen: (open: boolean) => void;
  setSearchResults: (ids: string[] | null) => void;
  setFilter: (f: Partial<GraphFilter>) => void;
  setDims: (d: 2 | 3) => void;
  setTopicNodes: (v: boolean) => void;
  setClusterCollapsed: (v: boolean) => void;
  setQualityTier: (t: QualityTier) => void;
  setAutoQuality: (v: boolean) => void;
  sendCamera: (kind: CameraCommand['kind'], ids?: string[]) => void;
  setSettingsOpen: (v: boolean) => void;
  setInsightsOpen: (v: boolean) => void;
  setSnapshotsOpen: (v: boolean) => void;
  pushToast: (message: string, kind?: ToastKind) => void;
  dismissToast: (id: number) => void;
}

let nextToastId = 1;

export const useUiStore = create<UiState>((set) => ({
  hoveredId: null,
  selectedId: null,
  selectedEdgeId: null,
  searchOpen: false,
  searchResults: null,
  filter: { fileTypes: null, clusters: null, minDegree: 0, minEdgeWeight: 0 },
  dims: 3,
  topicNodesEnabled: false,
  clusterCollapsed: false,
  qualityTier: 0,
  autoQuality: true,
  cameraCommand: null,
  settingsOpen: false,
  insightsOpen: false,
  snapshotsOpen: false,
  toasts: [],

  setHovered: (hoveredId) => set({ hoveredId }),
  setSelected: (selectedId) =>
    set({ selectedId, selectedEdgeId: null }),
  setSelectedEdge: (selectedEdgeId) => set({ selectedEdgeId }),
  setSearchOpen: (searchOpen) => set({ searchOpen }),
  setSearchResults: (searchResults) => set({ searchResults }),
  setFilter: (f) => set((s) => ({ filter: { ...s.filter, ...f } })),
  setDims: (dims) => set({ dims }),
  setTopicNodes: (topicNodesEnabled) => set({ topicNodesEnabled }),
  setClusterCollapsed: (clusterCollapsed) => set({ clusterCollapsed }),
  setQualityTier: (qualityTier) => set({ qualityTier }),
  setAutoQuality: (autoQuality) => set({ autoQuality }),
  sendCamera: (kind, ids) =>
    set((s) => ({
      cameraCommand: { nonce: (s.cameraCommand?.nonce ?? 0) + 1, kind, ids },
    })),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setInsightsOpen: (insightsOpen) => set({ insightsOpen }),
  setSnapshotsOpen: (snapshotsOpen) => set({ snapshotsOpen }),
  pushToast: (message, kind = 'error') =>
    set((s) => ({ toasts: [...s.toasts, { id: nextToastId++, message, kind }] })),
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

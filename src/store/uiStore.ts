import { create } from 'zustand';
import type { FileType } from '../model/types';

export type QualityTier = 0 | 1 | 2 | 3 | 4; // 0 = ultra … 4 = suggest 2D

export interface CameraCommand {
  nonce: number; // bump to re-trigger
  kind: 'frameNode' | 'frameSet' | 'fitAll';
  ids?: string[];
}

/**
 * Which feature owns the current scene highlight (the shared searchResults
 * channel). Search, insights-highlight, and path mode all dim the scene the
 * same way; tracking the owner lets each panel tell whether its highlight is
 * still the active one instead of clobbering the others silently.
 */
export type HighlightOwner = 'search' | 'insights' | 'path';

export type ToastKind = 'error' | 'warning' | 'info';

/** Optional action button rendered inside a toast (e.g. "Switch to 2D"). */
export interface ToastAction {
  label: string;
  run: () => void;
}

export interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
  action?: ToastAction;
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
  searchResults: string[] | null; // null = no active highlight (shared channel)
  highlightOwner: HighlightOwner | null; // which feature set searchResults
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
  /** "How are these connected?" mode: node clicks pick endpoints instead of selecting. */
  pathMode: boolean;
  /** 0–2 doc ids picked while pathMode is on; PathPanel computes the route at 2. */
  pathEndpoints: string[];

  setHovered: (id: string | null) => void;
  setSelected: (id: string | null) => void;
  setSelectedEdge: (id: string | null) => void;
  setSearchOpen: (open: boolean) => void;
  setSearchResults: (ids: string[] | null, owner?: HighlightOwner) => void;
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
  pushToast: (message: string, kind?: ToastKind, action?: ToastAction) => void;
  dismissToast: (id: number) => void;
  /** Toggling (either way) clears any picked endpoints. */
  setPathMode: (v: boolean) => void;
  /** Dedupes; a third pick starts a new path from that node. */
  addPathEndpoint: (id: string) => void;
}

let nextToastId = 1;

export const useUiStore = create<UiState>((set) => ({
  hoveredId: null,
  selectedId: null,
  selectedEdgeId: null,
  searchOpen: false,
  searchResults: null,
  highlightOwner: null,
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
  pathMode: false,
  pathEndpoints: [],

  setHovered: (hoveredId) => set({ hoveredId }),
  setSelected: (selectedId) =>
    set({ selectedId, selectedEdgeId: null }),
  setSelectedEdge: (selectedEdgeId) => set({ selectedEdgeId }),
  setSearchOpen: (searchOpen) => set({ searchOpen }),
  setSearchResults: (searchResults, owner) =>
    set({ searchResults, highlightOwner: searchResults ? (owner ?? null) : null }),
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
  pushToast: (message, kind = 'error', action) =>
    set((s) => ({ toasts: [...s.toasts, { id: nextToastId++, message, kind, action }] })),
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  setPathMode: (pathMode) => set({ pathMode, pathEndpoints: [] }),
  addPathEndpoint: (id) =>
    set((s) => {
      if (s.pathEndpoints.includes(id)) return s;
      if (s.pathEndpoints.length >= 2) return { pathEndpoints: [id] };
      return { pathEndpoints: [...s.pathEndpoints, id] };
    }),
}));

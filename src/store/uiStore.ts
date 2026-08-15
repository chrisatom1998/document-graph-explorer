import { create } from 'zustand';
import type { EdgeKind, FileType } from '../model/types';

export type QualityTier = 0 | 1 | 2 | 3 | 4; // 0 = ultra … 4 = suggest 2D
export type FlatEdgeDetail = 'balanced' | 'all';

export interface CameraPose {
  px: number;
  py: number;
  pz: number;
  tx: number;
  ty: number;
  tz: number;
}

export interface CameraCommand {
  nonce: number; // bump to re-trigger
  kind: 'frameNode' | 'frameSet' | 'fitAll' | 'pose';
  ids?: string[];
  /** Explicit camera position + orbit target; only for kind 'pose' (saved views). */
  pose?: CameraPose;
}

/**
 * Which feature owns the current scene highlight (the shared searchResults
 * channel). Search, insights-highlight, and path mode all dim the scene the
 * same way; tracking the owner lets each panel tell whether its highlight is
 * still the active one instead of clobbering the others silently.
 */
/** `showMe` is the “frame this match set” highlight, now owned by Search. */
export type HighlightOwner = 'search' | 'insights' | 'path' | 'showMe' | 'snapshot' | 'compare';

/** Which compare pane is waiting for a graph click. */
export type ComparePickSide = 'left' | 'right';

/** Shared-term needles highlighted in both compare readers. */
export interface CompareNeedles {
  left?: string;
  right?: string;
}

/** Insights drawer section to scroll/highlight when the panel opens from a jump link. */
export type InsightsFocus = 'orphans' | 'duplicates' | 'clusters' | 'stale' | null;

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

export interface LastError {
  message: string;
  stack?: string;
  at: number;
}

export interface GraphFilter {
  fileTypes: FileType[] | null; // null = all
  clusters: number[] | null;
  minDegree: number;
  minEdgeWeight: number; // 0..1 — hide edges below this weight (spec §9 hairball slider)
  /** null = every kind; topic edges still follow the topic-nodes toggle. */
  edgeKinds: EdgeKind[] | null;
  /** Keep documents modified within this many days; null = any age. */
  modifiedWithinDays: number | null;
}

export const DEFAULT_FILTER: GraphFilter = {
  fileTypes: null,
  clusters: null,
  minDegree: 0,
  minEdgeWeight: 0,
  edgeKinds: null,
  modifiedWithinDays: null,
};

export interface SnapshotOverlay {
  summary: string;
  addedIds: string[];
  updatedIds: string[];
  removedLabels: string[];
}

/** Passage a search hit or chat citation asked the reader to scroll to. */
export interface ReaderHighlight {
  docId: string;
  text: string;
  passageIndex?: number;
}

/** Passage stashed with a pending camera-then-panel focus. */
export interface FocusPassage {
  /** Zero-based chunk index when the retriever scored a real passage. */
  index?: number;
  /** Snippet used when chunk text is unavailable (imported graphs). */
  text?: string;
}

/** Node the camera is flying to; the side panel opens when this commits. */
export interface PendingFocus {
  id: string;
  passage?: FocusPassage;
}

interface UiState {
  hoveredId: string | null;
  selectedId: string | null;
  /**
   * Camera-first focus in flight. The side panel stays closed until
   * commitPendingFocus() runs (camera arrival / reduced-motion snap).
   */
  pendingFocus: PendingFocus | null;
  /** Matching passage to scroll/highlight in the side-panel reader. */
  readerHighlight: ReaderHighlight | null;
  searchOpen: boolean;
  searchResults: string[] | null; // null = no active highlight (shared channel)
  highlightOwner: HighlightOwner | null; // which feature set searchResults
  filter: GraphFilter;
  snapshotOverlay: SnapshotOverlay | null;
  dims: 2 | 3;
  flatEdgeDetail: FlatEdgeDetail;
  topicNodesEnabled: boolean;
  clusterCollapsed: boolean; // super-node collapse mode (spec §9)
  qualityTier: QualityTier;
  autoQuality: boolean;
  cameraCommand: CameraCommand | null;
  settingsOpen: boolean;
  insightsOpen: boolean;
  /** Section to focus the next time Insights opens; cleared after the panel applies it. */
  insightsFocus: InsightsFocus;
  snapshotsOpen: boolean;
  helpOpen: boolean;
  toasts: Toast[];
  lastError: LastError | null;
  /** "How are these connected?" mode: node clicks pick endpoints instead of selecting. */
  pathMode: boolean;
  /** 0–2 doc ids picked while pathMode is on; PathPanel computes the route at 2. */
  pathEndpoints: string[];
  /** Left document in the compare overlay; set alone while picking the right side. */
  compareLeftId: string | null;
  /** Right document in the compare overlay. */
  compareRightId: string | null;
  /** Graph clicks replace this pane instead of selecting. */
  comparePick: ComparePickSide | null;
  /** Passage needles for the two compare readers (shared-term clicks). */
  compareNeedles: CompareNeedles | null;

  setHovered: (id: string | null) => void;
  setSelected: (id: string | null) => void;
  setPendingFocus: (focus: PendingFocus | null) => void;
  setReaderHighlight: (highlight: ReaderHighlight | null) => void;
  setSearchOpen: (open: boolean) => void;
  setSearchResults: (ids: string[] | null, owner?: HighlightOwner) => void;
  setFilter: (f: Partial<GraphFilter>) => void;
  setSnapshotOverlay: (overlay: SnapshotOverlay | null) => void;
  setDims: (d: 2 | 3) => void;
  setFlatEdgeDetail: (detail: FlatEdgeDetail) => void;
  setTopicNodes: (v: boolean) => void;
  setClusterCollapsed: (v: boolean) => void;
  setQualityTier: (t: QualityTier) => void;
  setAutoQuality: (v: boolean) => void;
  sendCamera: (kind: CameraCommand['kind'], ids?: string[]) => void;
  sendCameraPose: (pose: CameraPose) => void;
  setSettingsOpen: (v: boolean) => void;
  setInsightsOpen: (v: boolean, focus?: InsightsFocus) => void;
  setInsightsFocus: (focus: InsightsFocus) => void;
  setSnapshotsOpen: (v: boolean) => void;
  setHelpOpen: (v: boolean) => void;
  pushToast: (message: string, kind?: ToastKind, action?: ToastAction) => void;
  dismissToast: (id: number) => void;
  setLastError: (error: LastError | null) => void;
  /** Toggling (either way) clears any picked endpoints. Turning path on exits compare. */
  setPathMode: (v: boolean) => void;
  /** Dedupes; a third pick starts a new path from that node. */
  addPathEndpoint: (id: string) => void;
  /** Seed the left pane and wait for a graph click for the right. Keeps the side panel open. */
  startCompare: (seedId: string) => void;
  /** Open both panes and close the single-document reader. */
  openCompare: (leftId: string, rightId: string) => void;
  /** Re-enter graph-pick for one pane while the overlay stays open. */
  startComparePick: (side: ComparePickSide) => void;
  /** Fill the waiting pane. No-ops when comparePick is unset. */
  applyComparePick: (id: string) => void;
  swapCompare: () => void;
  setCompareNeedles: (needles: CompareNeedles | null) => void;
  clearCompare: () => void;
}

export function isCompareOpen(s: {
  compareLeftId: string | null;
  compareRightId: string | null;
  comparePick: ComparePickSide | null;
}): boolean {
  return s.compareLeftId !== null || s.compareRightId !== null || s.comparePick !== null;
}

export function isCompareComplete(s: {
  compareLeftId: string | null;
  compareRightId: string | null;
}): boolean {
  return s.compareLeftId !== null && s.compareRightId !== null;
}

function compareClosedPatch(s: UiState): Partial<UiState> {
  return {
    compareLeftId: null,
    compareRightId: null,
    comparePick: null,
    compareNeedles: null,
    ...(s.highlightOwner === 'compare' ? { searchResults: null, highlightOwner: null } : {}),
  };
}

let nextToastId = 1;

/**
 * The 2D/3D choice persists across reloads (the toolbar position precedent) —
 * a user who works flat should not be dropped back into the nebula on every
 * visit. Stored on its own key rather than in settingsStore: it is a view
 * preference toggled from the toolbar, not a SettingsPanel field.
 *
 * Only the dims flag is persisted here. Re-posting it to the layout worker on
 * startup is App's job, so this module stays free of a layoutBridge import.
 */
const DIMS_KEY = 'knowledge-nebula-dims';

function loadDims(): 2 | 3 {
  try {
    if (typeof localStorage === 'undefined') return 3;
    return localStorage.getItem(DIMS_KEY) === '2' ? 2 : 3;
  } catch {
    return 3; // private mode / disabled storage
  }
}

function saveDims(dims: 2 | 3): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(DIMS_KEY, String(dims));
  } catch {
    /* private mode / quota exceeded — the choice simply won't persist */
  }
}

export const useUiStore = create<UiState>((set) => ({
  hoveredId: null,
  selectedId: null,
  pendingFocus: null,
  readerHighlight: null,
  searchOpen: false,
  searchResults: null,
  highlightOwner: null,
  filter: { ...DEFAULT_FILTER },
  snapshotOverlay: null,
  dims: loadDims(),
  flatEdgeDetail: 'balanced',
  topicNodesEnabled: false,
  clusterCollapsed: false,
  qualityTier: 0,
  autoQuality: true,
  cameraCommand: null,
  settingsOpen: false,
  insightsOpen: false,
  insightsFocus: null,
  snapshotsOpen: false,
  helpOpen: false,
  toasts: [],
  lastError: null,
  pathMode: false,
  pathEndpoints: [],
  compareLeftId: null,
  compareRightId: null,
  comparePick: null,
  compareNeedles: null,

  setHovered: (hoveredId) => set({ hoveredId }),
  setSelected: (selectedId) =>
    set({ selectedId, readerHighlight: null, pendingFocus: null }),
  setPendingFocus: (pendingFocus) => set({ pendingFocus }),
  setReaderHighlight: (readerHighlight) => set({ readerHighlight }),
  setSearchOpen: (searchOpen) => set({ searchOpen }),
  setSearchResults: (searchResults, owner) =>
    set({ searchResults, highlightOwner: searchResults ? (owner ?? null) : null }),
  setFilter: (f) => set((s) => ({ filter: { ...s.filter, ...f } })),
  setSnapshotOverlay: (snapshotOverlay) => set({ snapshotOverlay }),
  setDims: (dims) => set({ dims }),
  setFlatEdgeDetail: (flatEdgeDetail) => set({ flatEdgeDetail }),
  setTopicNodes: (topicNodesEnabled) => set({ topicNodesEnabled }),
  setClusterCollapsed: (clusterCollapsed) => set({ clusterCollapsed }),
  setQualityTier: (qualityTier) => set({ qualityTier }),
  setAutoQuality: (autoQuality) => set({ autoQuality }),
  sendCamera: (kind, ids) =>
    set((s) => ({
      cameraCommand: { nonce: (s.cameraCommand?.nonce ?? 0) + 1, kind, ids },
    })),
  sendCameraPose: (pose) =>
    set((s) => ({
      cameraCommand: { nonce: (s.cameraCommand?.nonce ?? 0) + 1, kind: 'pose', pose },
    })),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setInsightsOpen: (insightsOpen, focus) =>
    set({
      insightsOpen,
      insightsFocus: insightsOpen ? (focus ?? null) : null,
    }),
  setInsightsFocus: (insightsFocus) => set({ insightsFocus }),
  setSnapshotsOpen: (snapshotsOpen) => set({ snapshotsOpen }),
  setHelpOpen: (helpOpen) => set({ helpOpen }),
  pushToast: (message, kind = 'error', action) =>
    set((s) => ({ toasts: [...s.toasts, { id: nextToastId++, message, kind, action }] })),
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  setLastError: (lastError) => set({ lastError }),
  setPathMode: (pathMode) =>
    set((s) => ({
      pathMode,
      pathEndpoints: [],
      ...(pathMode ? compareClosedPatch(s) : {}),
    })),
  addPathEndpoint: (id) =>
    set((s) => {
      if (s.pathEndpoints.includes(id)) return s;
      if (s.pathEndpoints.length >= 2) return { pathEndpoints: [id] };
      return { pathEndpoints: [...s.pathEndpoints, id] };
    }),
  startCompare: (seedId) =>
    set((s) => ({
      pathMode: false,
      pathEndpoints: [],
      compareLeftId: seedId,
      compareRightId: null,
      comparePick: 'right',
      compareNeedles: null,
      ...(s.highlightOwner === 'path' ? { searchResults: null, highlightOwner: null } : {}),
    })),
  openCompare: (leftId, rightId) =>
    set({
      pathMode: false,
      pathEndpoints: [],
      selectedId: null,
      pendingFocus: null,
      readerHighlight: null,
      compareLeftId: leftId,
      compareRightId: rightId,
      comparePick: null,
      compareNeedles: null,
    }),
  startComparePick: (side) => set({ comparePick: side }),
  applyComparePick: (id) =>
    set((s) => {
      if (!s.comparePick) return s;
      if (s.comparePick === 'left') {
        return { compareLeftId: id, comparePick: null, compareNeedles: null };
      }
      return { compareRightId: id, comparePick: null, compareNeedles: null };
    }),
  swapCompare: () =>
    set((s) => ({
      compareLeftId: s.compareRightId,
      compareRightId: s.compareLeftId,
      compareNeedles: s.compareNeedles
        ? { left: s.compareNeedles.right, right: s.compareNeedles.left }
        : null,
      comparePick:
        s.comparePick === 'left' ? 'right' : s.comparePick === 'right' ? 'left' : null,
    })),
  setCompareNeedles: (compareNeedles) => set({ compareNeedles }),
  clearCompare: () => set((s) => compareClosedPatch(s)),
}));

// Persisting from the subscriber rather than from setDims means every route
// into the flag — toolbar, the AutoQuality "Switch to 2D" toast, saved views,
// and a collab peer's view — is remembered, with no call-site changes. Last
// write wins, which is the same precedence those callers already have.
useUiStore.subscribe((s, prev) => {
  if (s.dims !== prev.dims) saveDims(s.dims);
});

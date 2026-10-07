import { lazy, Suspense, useEffect } from 'react';
import Tooltip from './ui/Tooltip';
import ToastHost from './ui/ToastHost';
import { shouldIgnoreGlobalKey } from './ui/globalKeyboard';
import { useGraphStore } from './store/graphStore';
import { useUiStore } from './store/uiStore';
import { useChatStore } from './store/chatStore';
import { layoutSetDims } from './layout/layoutBridge';
import { useInitialGraphFrame } from './scene/useInitialGraphFrame';
import { enqueueRun } from './pipeline/runQueue';
import { positionBuffer, slotOfId } from './scene/positionBuffer';
import { cameraPose } from './scene/cameraPose';
import { panInput } from './scene/panInput';
import { initPersistence, restoreSession } from './persistence/session';
import { applyShareUrlFromLocation } from './persistence/shareBootstrap';
import { initChatHistorySync } from './persistence/chatHistorySync';
import { useSettingsStore } from './store/settingsStore';
import { audioAnalysisUsedBefore } from './audio/speculativePreload';
import './styles.css';

/** Fetch and warm the audio models once a restored graph that contains audio has
 * settled, so the next sound dropped skips the model download. Dynamic import keeps analyzeMusic
 * out of the main chunk; preloadMusicModels skips hosts too small to hold them,
 * and the drop-time preload in coordinator.ts stays as the fallback. A run that is
 * already parsing or embedding (demo corpus, an early drop) goes first: the warmup
 * waits for the pipeline to return to idle rather than competing with it, and a
 * document-only ingest that starts later stops it (speculativePreload.ts). */
function preloadAudioModelsWhenIdle(): void {
  // A restored workspace settles in 'ready', an empty one in 'idle'.
  const settled = (phase: string) => phase === 'idle' || phase === 'ready';
  const start = () => {
    if (!settled(useGraphStore.getState().phase)) {
      const unsubscribe = useGraphStore.subscribe(s => {
        if (!settled(s.phase)) return;
        unsubscribe();
        preloadAudioModelsWhenIdle();
      });
      return;
    }
    // Only someone who works with audio is likely to need the models soon.
    // Everyone else (first visit, documents only) would pay ~180 MB of
    // downloads, plus ~350 MB more where WebGPU is available, and four busy
    // model workers on every launch for nothing; their first audio drop still
    // preloads while the files are hashed and parsed (coordinator.ts).
    if (!audioAnalysisUsedBefore() && !useGraphStore.getState().nodes.some(n => n.kind === 'document' && n.fileType === 'audio')) return;
    const mode = useSettingsStore.getState().musicAnalysisMode;
    void import('./audio/analyzeMusic').then(m => m.preloadMusicModels(mode, { speculative: true })).catch(() => { /* Analysis loads the models itself if preloading fails. */ });
  };
  if (typeof globalThis.requestIdleCallback === 'function') globalThis.requestIdleCallback(start, { timeout: 3000 });
  else setTimeout(start, 1500);
}

const TitleRelationships = lazy(() => import('./graph/TitleRelationships'));
const CollabAppBridge = lazy(() => import('./collab/AppBridge'));
const NebulaCanvas = lazy(() => import('./scene/NebulaCanvas'));
const DropZone = lazy(() => import('./ingest/DropZone'));
// The welcome and ingest UI pull in the component library, but neither needs
// to delay the interactive shell or graph bundle on a restored workspace.
const EmptyState = lazy(() => import('./ui/EmptyState'));
const ProgressStrip = lazy(() => import('./ui/ProgressStrip'));
// The Resonance shell owns the toolbar, filters and inspector around the graph.
const ResonanceShell = lazy(() => import('./ui/resonance/ResonanceShell'));
const InsightsDigest = lazy(() => import('./ui/InsightsDigest'));
const FirstRunGuide = lazy(() => import('./ui/FirstRunGuide'));
const InsightsPanel = lazy(() => import('./ui/InsightsPanel'));
const PathPanel = lazy(() => import('./ui/PathPanel'));
const ComparePanel = lazy(() => import('./ui/ComparePanel'));
const SnapshotDrawer = lazy(() => import('./ui/SnapshotDrawer'));
const SearchOverlay = lazy(() => import('./ui/SearchOverlay'));
const SettingsPanel = lazy(() => import('./ui/SettingsPanel'));
const UploadInsightsAgent = lazy(() => import('./ui/UploadInsights').then(module => ({ default: module.UploadInsightsAgent })));
const DjAssistant = lazy(() => import('./ui/DjAssistant'));
const MusicBackgroundStatus = lazy(() => import('./ui/MusicBackgroundStatus'));
const ChatPanel = lazy(() => import('./ui/ChatPanel'));
const HelpPopover = lazy(() => import('./ui/HelpPopover'));

function hasSavedDims(): boolean {
  try { return localStorage.getItem('knowledge-nebula-dims') !== null; } catch { return true; }
}

const RetrievalBenchmarkPanel = import.meta.env.DEV
  ? lazy(() => import('./dev/RetrievalBenchmarkPanel'))
  : null;

declare global {
  interface Window {
    __nebula?: () => {
      phase: string;
      nodes: number;
      edges: number;
      posCount: number;
      meanR: number;
      maxR: number;
      minPair: number | null;
      enrich: { done: number; total: number; note: string } | null;
      selectedId: string | null;
      controlsEnabled: boolean;
      camera: typeof cameraPose;
      canvasFocused: boolean;
      navigatorFocusWithin: boolean;
      projectedNodes: Array<{ id: string; title: string; x: number; y: number; visible: boolean }>;
    };
  }
}


export default function App() {
  const hasNodes = useGraphStore((s) => s.nodes.length > 0);
  const phase = useGraphStore((s) => s.phase);
  const searchOpen = useUiStore((s) => s.searchOpen);
  const settingsOpen = useUiStore((s) => s.settingsOpen);
  const insightsOpen = useUiStore((s) => s.insightsOpen);
  const snapshotsOpen = useUiStore((s) => s.snapshotsOpen);
  const helpOpen = useUiStore((s) => s.helpOpen);
  const pathMode = useUiStore((s) => s.pathMode);
  const chatOpen = useChatStore((s) => s.isOpen);

  // Session restore + persistence hooks, once. Fresh starts stay empty until
  // the user adds files or explicitly loads the demo corpus from EmptyState.
  useEffect(() => {
    // uiStore restores a persisted 2D choice, but only the flag — the layout
    // worker still defaults to 3D. Re-post it here, ahead of every hydration
    // path below, so restored nodes are added to an already-flat simulation
    // (no visible collapse) and a worker respawn replays the right dims.
    // Resonance is a flat map first: a fresh profile starts in 2D, while a
    // saved 2D/3D choice is kept.
    if (!hasSavedDims()) useUiStore.getState().setDims(2);
    if (useUiStore.getState().dims === 2) layoutSetDims(2);
    initPersistence();
    const openShareOrRestore = async (fromHashChange = false) => {
      try {
        const shareResult = await applyShareUrlFromLocation();
        if (shareResult !== 'none') return;
        if (fromHashChange) return;
        // Serialized like every other restore path: DropZone is already live,
        // so a drop landing mid-restore would otherwise interleave its ingest
        // with hydration and leave the two writing over each other. The shared
        // graph branch above returns before this point, so its own internally
        // queued import never nests inside this run.
        await enqueueRun(async () => {
          await restoreSession();
          const { bindFolderWatcherToActiveCorpus } = await import('./ingest/folderWatcher');
          await bindFolderWatcherToActiveCorpus();
        });
      } catch (error) {
        console.warn(fromHashChange ? 'shared graph open failed' : 'session restore failed', error);
      }
      if (!fromHashChange) preloadAudioModelsWhenIdle();
    };
    void openShareOrRestore();
    const reopenShare = () => {
      void openShareOrRestore(true);
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') reopenShare();
    };
    window.addEventListener('hashchange', reopenShare);
    document.addEventListener('visibilitychange', onVisible);
    const launchQueue = (
      window as Window & {
        launchQueue?: { setConsumer: (cb: (params: { targetURL?: string }) => void) => void };
      }
    ).launchQueue;
    launchQueue?.setConsumer((params) => {
      if (!params.targetURL) return;
      try {
        const next = new URL(params.targetURL, window.location.origin);
        if (next.origin !== window.location.origin) return;
        const nextPath = `${next.pathname}${next.search}${next.hash}`;
        const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
        if (nextPath !== currentPath) {
          window.history.replaceState(window.history.state, '', nextPath);
        }
      } catch {
        return;
      }
      reopenShare();
    });
    return () => {
      window.removeEventListener('hashchange', reopenShare);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  // Loading and saving the transcript both hinge on which workspace is active
  // at the moment they run, which a committed effect scope can't track through
  // a switch — chatHistorySync derives it from the stores instead.
  useEffect(() => {
    initChatHistorySync();
  }, []);

  useInitialGraphFrame(hasNodes);

  // Dev-only introspection for automated verification (position spread etc.).
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    window.__nebula = () => {
      const g = useGraphStore.getState();
      const { array, count } = positionBuffer;
      let meanR = 0;
      let maxR = 0;
      for (let i = 0; i < count; i++) {
        const x = array[i * 3];
        const y = array[i * 3 + 1];
        const z = array[i * 3 + 2];
        const r = Math.hypot(x, y, z);
        meanR += r;
        if (r > maxR) maxR = r;
      }
      if (count > 0) meanR /= count;

      // Project document centers using the published camera pose. Browser
      // acceptance tests use these coordinates to exercise the real R3F click
      // path without guessing where a force-directed node settled.
      const fx0 = cameraPose.tx - cameraPose.px;
      const fy0 = cameraPose.ty - cameraPose.py;
      const fz0 = cameraPose.tz - cameraPose.pz;
      const fl = Math.hypot(fx0, fy0, fz0) || 1;
      const fx = fx0 / fl;
      const fy = fy0 / fl;
      const fz = fz0 / fl;
      const rl = Math.hypot(-fz, fx) || 1;
      const rx = -fz / rl;
      const rz = fx / rl;
      const ux = -rz * fy;
      const uy = rz * fx - rx * fz;
      const uz = rx * fy;
      const tanHalfFov = Math.tan((cameraPose.fov * Math.PI) / 360);
      const canvasRect = document.querySelector('.nebula-canvas')?.getBoundingClientRect() ?? { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
      const projectedNodes = g.nodes.flatMap((node) => {
        if (node.kind !== 'document') return [];
        const slot = slotOfId.get(node.id);
        if (slot === undefined || slot >= count) return [];
        const dx = array[slot * 3] - cameraPose.px;
        const dy = array[slot * 3 + 1] - cameraPose.py;
        const dz = array[slot * 3 + 2] - cameraPose.pz;
        const depth = dx * fx + dy * fy + dz * fz;
        if (depth <= 0) return [];
        const ndcX = (dx * rx + dz * rz) / (depth * tanHalfFov * cameraPose.aspect);
        const ndcY = (dx * ux + dy * uy + dz * uz) / (depth * tanHalfFov);
        return [{
          id: node.id,
          title: node.title,
          x: canvasRect.left + ((ndcX + 1) / 2) * canvasRect.width,
          y: canvasRect.top + ((1 - ndcY) / 2) * canvasRect.height,
          visible: Math.abs(ndcX) <= 1 && Math.abs(ndcY) <= 1,
        }];
      });

      // minPair is an O(n^2) all-pairs scan — fine for the small demo corpus
      // this was written against, but it'd hang the tab on a large one.
      // Sample a capped, evenly-strided subset of nodes instead of every
      // pair; this is dev-only debug tooling, not a rendered metric, so an
      // approximate answer is fine.
      let minPair = Infinity;
      if (count > 1) {
        const MINPAIR_SAMPLE_CAP = 300;
        const sampleCount = Math.min(count, MINPAIR_SAMPLE_CAP);
        const stride = count / sampleCount;
        for (let si = 0; si < sampleCount; si++) {
          const i = Math.floor(si * stride) * 3;
          for (let sj = si + 1; sj < sampleCount; sj++) {
            const j = Math.floor(sj * stride) * 3;
            const d = Math.hypot(
              array[i] - array[j],
              array[i + 1] - array[j + 1],
              array[i + 2] - array[j + 2],
            );
            if (d < minPair) minPair = d;
          }
        }
      }
      return {
        phase: g.phase,
        nodes: g.nodes.length,
        edges: g.edges.length,
        posCount: count,
        meanR,
        maxR,
        minPair: count > 1 ? minPair : null,
        enrich: g.enrichProgress,
        selectedId: useUiStore.getState().selectedId,
        controlsEnabled: cameraPose.controlsEnabled,
        camera: { ...cameraPose },
        canvasFocused: document.activeElement?.classList.contains('nebula-canvas') ?? false,
        navigatorFocusWithin: document.querySelector('.graph-navigator:focus-within') !== null,
        projectedNodes,
      };
    };
  }, []);

  // Global keyboard: owned HERE and nowhere else.
  useEffect(() => {
    // Arrow keys pan the camera. Held keys are tracked here; CameraRig reads
    // the net direction from panInput each frame and applies a smooth pan.
    const held = new Set<string>();
    const isPanKey = (k: string) =>
      k === 'ArrowLeft' || k === 'ArrowRight' || k === 'ArrowUp' || k === 'ArrowDown';
    const syncPan = () => {
      panInput.x = (held.has('ArrowRight') ? 1 : 0) - (held.has('ArrowLeft') ? 1 : 0);
      panInput.y = (held.has('ArrowUp') ? 1 : 0) - (held.has('ArrowDown') ? 1 : 0);
    };

    const onKey = (e: KeyboardEvent) => {
      const ui = useUiStore.getState();
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        // The overlay only renders once the graph is ready, so opening it
        // earlier just sets invisible state that then swallows the next
        // Escape. Closing a stray open state stays allowed.
        if (useGraphStore.getState().phase !== 'ready' && !ui.searchOpen) return;
        const nextSearchOpen = !ui.searchOpen;
        ui.setSearchOpen(nextSearchOpen);
        if (nextSearchOpen) {
          ui.setSearchResults(null);
        }
        return;
      }
      if (shouldIgnoreGlobalKey(e)) return;
      // Plain arrows only — leave modified combos to the browser/OS.
      if (isPanKey(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault(); // otherwise the page scrolls
        held.add(e.key);
        syncPan();
        return;
      }
      if (e.key === 'Escape') {
        if (ui.searchOpen) {
          ui.setSearchOpen(false);
          ui.setSearchResults(null);
        } else if (ui.highlightOwner === 'showMe') {
          // Show-all leaves a golden match set with the overlay closed; Esc
          // must dismiss that highlight before falling through to fitAll.
          ui.setSearchResults(null);
        } else if (ui.pathMode) {
          ui.setPathMode(false);
          ui.setSearchResults(null);
        } else if (ui.settingsOpen) {
          ui.setSettingsOpen(false);
        } else if (ui.snapshotsOpen) {
          ui.setSnapshotsOpen(false);
        } else if (ui.helpOpen) {
          ui.setHelpOpen(false);
        } else if (useChatStore.getState().isOpen) {
          useChatStore.getState().setIsOpen(false);
        } else if (ui.insightsOpen) {
          ui.setInsightsOpen(false);
          ui.setSearchResults(null); // drop any section highlight with it
        } else if (ui.selectedId || ui.pendingFocus) {
          ui.setSelected(null);
        } else {
          ui.sendCamera('fitAll'); // overview (spec §7.3)
        }
      } else if (e.key === 'Home') {
        ui.sendCamera('fitAll');
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (isPanKey(e.key) && held.delete(e.key)) syncPan();
    };
    // A lost focus (alt-tab, devtools) can swallow keyup — clear held state so
    // a key never sticks and pans the camera forever.
    const onBlur = () => {
      if (held.size) {
        held.clear();
        syncPan();
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      panInput.x = 0;
      panInput.y = 0;
    };
  }, []);

  return (
    <div className="app-root">
      <Suspense fallback={null}><CollabAppBridge /></Suspense>
      <Suspense fallback={null}><TitleRelationships /><DjAssistant showLauncher={false} /><MusicBackgroundStatus /><UploadInsightsAgent /></Suspense>
      <Suspense fallback={<div className="scene-loading" role="status" aria-label="Loading interactive graph" />}>
        <ResonanceShell>
          <Suspense fallback={<div className="scene-loading" role="status" aria-label="Loading interactive graph" />}>
            <NebulaCanvas />
          </Suspense>
        </ResonanceShell>
      </Suspense>
      <Suspense fallback={null}><InsightsDigest /><FirstRunGuide /></Suspense>
      <Suspense fallback={null}><DropZone /></Suspense>
      {!hasNodes && phase === 'idle' && (
        <Suspense fallback={null}><EmptyState /></Suspense>
      )}
      {phase === 'ready' && (
        <Suspense fallback={null}>
          <ComparePanel />
        </Suspense>
      )}
      <Suspense fallback={null}><ProgressStrip /></Suspense>
      {insightsOpen && (
        <Suspense fallback={null}><InsightsPanel /></Suspense>
      )}
      {pathMode && (
        <Suspense fallback={null}><PathPanel /></Suspense>
      )}
      <Tooltip />
      {phase === 'ready' && searchOpen && (
        <Suspense fallback={null}><SearchOverlay /></Suspense>
      )}
      {settingsOpen && (
        <Suspense fallback={null}><SettingsPanel /></Suspense>
      )}
      {snapshotsOpen && (
        <Suspense fallback={null}><SnapshotDrawer /></Suspense>
      )}
      {hasNodes && chatOpen && (
        <Suspense fallback={null}><ChatPanel /></Suspense>
      )}
      {helpOpen && (
        <Suspense fallback={null}><HelpPopover /></Suspense>
      )}
      <ToastHost />
      {RetrievalBenchmarkPanel && new URLSearchParams(window.location.search).get('eval') === 'retrieval' && (
        <Suspense fallback={null}><RetrievalBenchmarkPanel /></Suspense>
      )}
    </div>
  );
}

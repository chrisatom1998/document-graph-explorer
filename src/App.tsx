import { lazy, Suspense, useEffect, useRef } from 'react';
import Tooltip from './ui/Tooltip';
import ChatLauncher from './ui/ChatLauncher';
import InsightsDigest from './ui/InsightsDigest';
import ToastHost from './ui/ToastHost';
import { shouldIgnoreGlobalKey } from './ui/globalKeyboard';
import { useGraphStore } from './store/graphStore';
import { useUiStore } from './store/uiStore';
import { useChatStore } from './store/chatStore';
import { useCorpusStore } from './store/corpusStore';
import { layoutSetDims, onLayoutSettled } from './layout/layoutBridge';
import {
  clearIngestBirthSteer,
  isIngestFraming,
  wasIngestBirthSteered,
} from './scene/ingestGesture';
import { enqueueRun } from './pipeline/runQueue';
import { positionBuffer, slotOfId } from './scene/positionBuffer';
import { cameraPose } from './scene/cameraPose';
import { panInput } from './scene/panInput';
import { initPersistence, restoreSession } from './persistence/session';
import { initializeCorpusRepository } from './persistence/corpusRepository';
import { reportPersistenceUnavailable } from './persistence/cache';
import { initChatHistorySync } from './persistence/chatHistorySync';
import './styles.css';

const CollabAppBridge = lazy(() => import('./collab/AppBridge'));
const NebulaCanvas = lazy(() => import('./scene/NebulaCanvas'));
const DropZone = lazy(() => import('./ingest/DropZone'));
// The welcome and ingest UI pull in the component library, but neither needs
// to delay the interactive shell or graph bundle on a restored workspace.
const EmptyState = lazy(() => import('./ui/EmptyState'));
const ProgressStrip = lazy(() => import('./ui/ProgressStrip'));
const Toolbar = lazy(() => import('./ui/Toolbar'));
const IngestDimsToggle = lazy(() => import('./ui/DimsToggleButton'));
const InsightsPanel = lazy(() => import('./ui/InsightsPanel'));
const PathPanel = lazy(() => import('./ui/PathPanel'));
const SidePanel = lazy(() => import('./ui/SidePanel'));
const SnapshotDrawer = lazy(() => import('./ui/SnapshotDrawer'));
const SearchOverlay = lazy(() => import('./ui/SearchOverlay'));
const GraphNavigator = lazy(() => import('./ui/GraphNavigator'));
const FilterBar = lazy(() => import('./ui/FilterBar'));
const Minimap = lazy(() => import('./ui/Minimap'));
const SettingsPanel = lazy(() => import('./ui/SettingsPanel'));
const ChatPanel = lazy(() => import('./ui/ChatPanel'));
const HelpPopover = lazy(() => import('./ui/HelpPopover'));
const FirstRunGuide = lazy(() => import('./ui/FirstRunGuide'));

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
  const selectedId = useUiStore((s) => s.selectedId);
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
    if (useUiStore.getState().dims === 2) layoutSetDims(2);
    initPersistence();
    void (async () => {
      try {
        const { decodeShareFragment, hasShareFragment } = await import('./persistence/shareUrl');
        if (hasShareFragment(window.location.href)) {
          // Populate the local workspace list without hydrating any private
          // graph. The portable view then clears the active id, letting the
          // owner explicitly switch back while recipients simply see their
          // own (usually empty) device-local list.
          try {
            await initializeCorpusRepository();
          } catch (error) {
            reportPersistenceUnavailable(error);
          }
          try {
            const shared = await decodeShareFragment(window.location.href);
            if (shared) {
              const { importGraphExportData } = await import('./persistence/exportImport');
              await importGraphExportData(shared, 'shared');
              useUiStore
                .getState()
                .pushToast('Opened a shared graph — document contents remain on the owner’s device.', 'info');
              return;
            }
          } catch (error) {
            useCorpusStore.getState().setEphemeral('Invalid shared graph', 'shared');
            useUiStore
              .getState()
              .pushToast(error instanceof Error ? error.message : 'This shared graph link is invalid.');
            return;
          }
        }
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
        console.warn('session restore failed', error);
      }
    })();
  }, []);

  // Loading and saving the transcript both hinge on which workspace is active
  // at the moment they run, which a committed effect scope can't track through
  // a switch — chatHistorySync derives it from the stores instead.
  useEffect(() => {
    initChatHistorySync();
  }, []);

  // Auto-frame: while a fresh corpus is forming, re-fit the camera on every
  // layout settle so the nebula is always in view; stop after the settle that
  // follows 'ready' so the user owns the camera from then on.
  const needsFrame = useRef(true);
  useEffect(() => {
    if (!hasNodes) {
      needsFrame.current = true; // next corpus gets framed again
      clearIngestBirthSteer(); // fresh corpus: an old steer must not block its first fit
      return;
    }
    return onLayoutSettled(() => {
      if (!needsFrame.current) return;
      const ready = useGraphStore.getState().phase === 'ready';
      // Live first-ingest framing is owned by CameraRig (slow ease-out).
      // Incremental add never sets that flag; session restore still fit-alls
      // here. A ready-state settle completes the initial framing either way —
      // leaving needsFrame set would make the NEXT incremental add's settle
      // fitAll and steal the user's camera.
      if (isIngestFraming()) {
        if (ready) needsFrame.current = false;
        return;
      }
      // A mid-ingest orbit/pan cancels the follow AND this handler's fitAll:
      // the no-steal guarantee means once the user takes the camera during a
      // corpus's formation, nothing auto-fits that corpus behind them.
      if (wasIngestBirthSteered()) {
        needsFrame.current = false;
        return;
      }
      useUiStore.getState().sendCamera('fitAll');
      if (ready) needsFrame.current = false;
    });
  }, [hasNodes]);

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
          x: ((ndcX + 1) / 2) * window.innerWidth,
          y: ((1 - ndcY) / 2) * window.innerHeight,
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
      <Suspense fallback={<div className="scene-loading" role="status" aria-label="Loading interactive graph" />}>
        <NebulaCanvas />
      </Suspense>
      <Suspense fallback={null}><DropZone /></Suspense>
      {!hasNodes && phase === 'idle' && (
        <Suspense fallback={null}><EmptyState /></Suspense>
      )}
      {phase === 'ready' && (
        <Suspense fallback={null}><Toolbar /></Suspense>
      )}
      {/* The full toolbar waits for 'ready', but the 2D/3D switch must stay
          reachable while the corpus is still forming — switching modes is
          also the escape hatch when the 3D ingest animation struggles. */}
      {hasNodes && phase !== 'ready' && (
        <Suspense fallback={null}><IngestDimsToggle /></Suspense>
      )}
      {phase === 'ready' && (
        <Suspense fallback={null}><GraphNavigator /></Suspense>
      )}
      {phase === 'ready' && (
        <Suspense fallback={null}><FilterBar /></Suspense>
      )}
      <Suspense fallback={null}><ProgressStrip /></Suspense>
      {insightsOpen && (
        <Suspense fallback={null}><InsightsPanel /></Suspense>
      )}
      <InsightsDigest />
      {pathMode && (
        <Suspense fallback={null}><PathPanel /></Suspense>
      )}
      {selectedId && (
        <Suspense fallback={null}><SidePanel /></Suspense>
      )}
      {phase === 'ready' && (
        <Suspense fallback={null}><Minimap /></Suspense>
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
      {phase === 'ready' && <ChatLauncher />}
      {phase === 'ready' && chatOpen && (
        <Suspense fallback={null}><ChatPanel /></Suspense>
      )}
      {helpOpen && (
        <Suspense fallback={null}><HelpPopover /></Suspense>
      )}
      <Suspense fallback={null}><FirstRunGuide /></Suspense>
      <ToastHost />
      {RetrievalBenchmarkPanel && new URLSearchParams(window.location.search).get('eval') === 'retrieval' && (
        <Suspense fallback={null}><RetrievalBenchmarkPanel /></Suspense>
      )}
    </div>
  );
}

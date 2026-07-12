import { lazy, Suspense, useEffect, useRef } from 'react';
import NebulaCanvas from './scene/NebulaCanvas';
import DropZone from './ingest/DropZone';
import EmptyState from './ui/EmptyState';
import ProgressStrip from './ui/ProgressStrip';
import Toolbar from './ui/Toolbar';
import InsightsPanel from './ui/InsightsPanel';
import PathPanel from './ui/PathPanel';
import SidePanel from './ui/SidePanel';
import SnapshotDrawer from './ui/SnapshotDrawer';
import Tooltip from './ui/Tooltip';
import SearchOverlay from './ui/SearchOverlay';
import ShowMePanel from './ui/ShowMePanel';
import FilterBar from './ui/FilterBar';
import Minimap from './ui/Minimap';
import SettingsPanel from './ui/SettingsPanel';
import ChatPanel from './ui/ChatPanel';
import ToastHost from './ui/ToastHost';
import FirstRunGuide from './ui/FirstRunGuide';
import { useGraphStore } from './store/graphStore';
import { useUiStore } from './store/uiStore';
import { useChatStore } from './store/chatStore';
import { onLayoutSettled } from './layout/layoutBridge';
import { positionBuffer } from './scene/positionBuffer';
import { panInput } from './scene/panInput';
import { initPersistence, restoreSession } from './persistence/session';
import { loadChatHistory, saveChatHistory } from './persistence/chatHistory';
import './styles.css';

const RetrievalBenchmarkPanel = import.meta.env.DEV
  ? lazy(() => import('./dev/RetrievalBenchmarkPanel'))
  : null;

function isTypingTarget(t: EventTarget | null): boolean {
  return (
    t instanceof HTMLInputElement ||
    t instanceof HTMLTextAreaElement ||
    (t instanceof HTMLElement && t.isContentEditable)
  );
}

export default function App() {
  const hasNodes = useGraphStore((s) => s.nodes.length > 0);
  const phase = useGraphStore((s) => s.phase);
  const corpusHash = useGraphStore((s) => s.corpusHash);

  // Session restore + persistence hooks, once. Fresh starts stay empty until
  // the user adds files or explicitly loads the demo corpus from EmptyState.
  useEffect(() => {
    initPersistence();
    restoreSession().catch((err) => console.warn('session restore failed', err));
  }, []);

  useEffect(() => {
    if (!corpusHash || phase !== 'ready') return;
    let cancelled = false;
    loadChatHistory(corpusHash).then((messages) => {
      if (!cancelled) useChatStore.getState().replaceMessages(messages);
    }).catch((error) => console.warn('chat history restore failed', error));
    return () => { cancelled = true; };
  }, [corpusHash, phase]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    return useChatStore.subscribe((state) => {
      if (!corpusHash || state.isStreaming) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => saveChatHistory(corpusHash, state.messages)
        .catch((error) => console.warn('chat history save failed', error)), 350);
    });
  }, [corpusHash]);

  // Auto-frame: while a fresh corpus is forming, re-fit the camera on every
  // layout settle so the nebula is always in view; stop after the settle that
  // follows 'ready' so the user owns the camera from then on.
  const needsFrame = useRef(true);
  useEffect(() => {
    if (!hasNodes) {
      needsFrame.current = true; // next corpus gets framed again
      return;
    }
    return onLayoutSettled(() => {
      if (!needsFrame.current) return;
      useUiStore.getState().sendCamera('fitAll');
      if (useGraphStore.getState().phase === 'ready') needsFrame.current = false;
    });
  }, [hasNodes]);

  // Dev-only introspection for automated verification (position spread etc.).
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as Record<string, unknown>).__nebula = () => {
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
        const nextSearchOpen = !ui.searchOpen;
        ui.setSearchOpen(nextSearchOpen);
        if (nextSearchOpen) {
          ui.setShowMeOpen(false);
          ui.setSearchResults(null);
        }
        return;
      }
      if (isTypingTarget(e.target)) return;
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
        } else if (ui.showMeOpen) {
          ui.setShowMeOpen(false);
          ui.setSearchResults(null);
        } else if (ui.pathMode) {
          ui.setPathMode(false);
          ui.setSearchResults(null);
        } else if (ui.settingsOpen) {
          ui.setSettingsOpen(false);
        } else if (ui.snapshotsOpen) {
          ui.setSnapshotsOpen(false);
        } else if (useChatStore.getState().isOpen) {
          useChatStore.getState().setIsOpen(false);
        } else if (ui.insightsOpen) {
          ui.setInsightsOpen(false);
          ui.setSearchResults(null); // drop any section highlight with it
        } else if (ui.selectedId) {
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
      <NebulaCanvas />
      <DropZone />
      {!hasNodes && phase === 'idle' && <EmptyState />}
      <Toolbar />
      <FilterBar />
      <ProgressStrip />
      <InsightsPanel />
      <PathPanel />
      <SidePanel />
      <Minimap />
      <Tooltip />
      <SearchOverlay />
      <ShowMePanel />
      <SettingsPanel />
      <SnapshotDrawer />
      <ChatPanel />
      <FirstRunGuide />
      <ToastHost />
      {RetrievalBenchmarkPanel && new URLSearchParams(window.location.search).get('eval') === 'retrieval' && (
        <Suspense fallback={null}><RetrievalBenchmarkPanel /></Suspense>
      )}
    </div>
  );
}

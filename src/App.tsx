import { useEffect, useRef } from 'react';
import NebulaCanvas from './scene/NebulaCanvas';
import DropZone from './ingest/DropZone';
import EmptyState from './ui/EmptyState';
import BrandMark from './ui/BrandMark';
import ProgressStrip from './ui/ProgressStrip';
import Toolbar from './ui/Toolbar';
import InsightsPanel from './ui/InsightsPanel';
import PathPanel from './ui/PathPanel';
import SidePanel from './ui/SidePanel';
import SnapshotDrawer from './ui/SnapshotDrawer';
import Tooltip from './ui/Tooltip';
import EdgePopover from './ui/EdgePopover';
import SearchOverlay from './ui/SearchOverlay';
import FilterBar from './ui/FilterBar';
import Minimap from './ui/Minimap';
import SettingsPanel from './ui/SettingsPanel';
import ChatPanel from './ui/ChatPanel';
import ToastHost from './ui/ToastHost';
import { useGraphStore } from './store/graphStore';
import { useUiStore } from './store/uiStore';
import { useChatStore } from './store/chatStore';
import { onLayoutSettled } from './layout/layoutBridge';
import { positionBuffer } from './scene/positionBuffer';
import { panInput } from './scene/panInput';
import { loadDemoCorpus } from './pipeline/coordinator';
import { initPersistence, restoreSession } from './persistence/session';
import './styles.css';

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

  // Session restore + persistence hooks, once.
  // If no session exists (first visit), auto-load the demo corpus.
  useEffect(() => {
    initPersistence();
    restoreSession()
      .then(() => {
        if (useGraphStore.getState().nodes.length === 0) {
          loadDemoCorpus().catch((err) =>
            console.warn('auto-load demo corpus failed', err),
          );
        }
      })
      .catch((err) => console.warn('session restore failed', err));
  }, []);

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
      let minPair = Infinity;
      for (let i = 0; i < count; i++) {
        const x = array[i * 3];
        const y = array[i * 3 + 1];
        const z = array[i * 3 + 2];
        const r = Math.hypot(x, y, z);
        meanR += r;
        if (r > maxR) maxR = r;
        for (let j = i + 1; j < count; j++) {
          const d = Math.hypot(
            x - array[j * 3],
            y - array[j * 3 + 1],
            z - array[j * 3 + 2],
          );
          if (d < minPair) minPair = d;
        }
      }
      if (count > 0) meanR /= count;
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
        ui.setSearchOpen(!ui.searchOpen);
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
        } else if (ui.selectedEdgeId) {
          ui.setSelectedEdge(null);
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
      <BrandMark />
      <Toolbar />
      <FilterBar />
      <ProgressStrip />
      <InsightsPanel />
      <PathPanel />
      <SidePanel />
      <Minimap />
      <Tooltip />
      <EdgePopover />
      <SearchOverlay />
      <SettingsPanel />
      <SnapshotDrawer />
      <ChatPanel />
      <ToastHost />
    </div>
  );
}

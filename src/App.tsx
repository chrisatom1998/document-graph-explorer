import { useEffect } from 'react';
import NebulaCanvas from './scene/NebulaCanvas';
import DropZone from './ingest/DropZone';
import EmptyState from './ui/EmptyState';
import ProgressStrip from './ui/ProgressStrip';
import Toolbar from './ui/Toolbar';
import SidePanel from './ui/SidePanel';
import Tooltip from './ui/Tooltip';
import EdgePopover from './ui/EdgePopover';
import SearchOverlay from './ui/SearchOverlay';
import FilterBar from './ui/FilterBar';
import SettingsPanel from './ui/SettingsPanel';
import { useGraphStore } from './store/graphStore';
import { useUiStore } from './store/uiStore';
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
  useEffect(() => {
    initPersistence();
    restoreSession().catch((err) => console.warn('session restore failed', err));
  }, []);

  // Global keyboard: owned HERE and nowhere else.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ui = useUiStore.getState();
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        ui.setSearchOpen(!ui.searchOpen);
        return;
      }
      if (isTypingTarget(e.target)) return;
      if (e.key === 'Escape') {
        if (ui.searchOpen) {
          ui.setSearchOpen(false);
          ui.setSearchResults(null);
        } else if (ui.settingsOpen) {
          ui.setSettingsOpen(false);
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
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="app-root">
      <NebulaCanvas />
      <DropZone />
      {!hasNodes && phase === 'idle' && <EmptyState />}
      <Toolbar />
      <FilterBar />
      <ProgressStrip />
      <SidePanel />
      <Tooltip />
      <EdgePopover />
      <SearchOverlay />
      <SettingsPanel />
    </div>
  );
}

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';
import { layoutSetDims } from '../layout/layoutBridge';
import { openFilePicker } from '../ingest/DropZone';
import { exportGraphJSON, exportScenePNG, importGraphJSONFile } from '../persistence/exportImport';

/* ---------------------------------------------------------------------- */
/* Inline icon set — no icon library per project rules. Each is a plain   */
/* 18x18 stroke-based SVG so they inherit currentColor from .btn-icon.    */
/* ---------------------------------------------------------------------- */

function IconSearch() {
  return (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6">
      <circle cx="8" cy="8" r="5.25" />
      <line x1="12.1" y1="12.1" x2="16" y2="16" strokeLinecap="round" />
    </svg>
  );
}

function IconFit() {
  return (
    <svg
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2 6V3a1 1 0 0 1 1-1h3" />
      <path d="M16 6V3a1 1 0 0 0-1-1h-3" />
      <path d="M2 12v3a1 1 0 0 0 1 1h3" />
      <path d="M16 12v3a1 1 0 0 1-1 1h-3" />
      <rect x="6" y="6" width="6" height="6" rx="1" />
    </svg>
  );
}

function IconCube({ twoD }: { twoD: boolean }) {
  if (twoD) {
    return (
      <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6">
        <rect x="3" y="3" width="12" height="12" rx="1.5" />
      </svg>
    );
  }
  return (
    <svg
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    >
      <path d="M9 2 L15.5 5.6 V12.4 L9 16 L2.5 12.4 V5.6 Z" />
      <path d="M9 2 V9 M9 9 L15.5 5.6 M9 9 L2.5 5.6 M9 9 V16" strokeOpacity="0.55" />
    </svg>
  );
}

function IconOctahedron() {
  return (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
      <path d="M9 1.5 L15.5 9 L9 16.5 L2.5 9 Z" />
      <path d="M2.5 9 L15.5 9" strokeOpacity="0.55" />
    </svg>
  );
}

function IconCollapse() {
  return (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      {/* Multiple small circles collapsing into one large circle */}
      <circle cx="9" cy="9" r="5.5" />
      <circle cx="5" cy="5" r="1.2" fill="currentColor" opacity="0.5" />
      <circle cx="13" cy="5" r="1.2" fill="currentColor" opacity="0.5" />
      <circle cx="9" cy="13" r="1.2" fill="currentColor" opacity="0.5" />
      <circle cx="9" cy="9" r="2" fill="currentColor" opacity="0.8" />
    </svg>
  );
}

/** Trigger icon for the "View ▾" popover — a simple eye glyph. */
function IconView() {
  return (
    <svg
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M1.5 9S4.4 3.6 9 3.6 16.5 9 16.5 9 13.6 14.4 9 14.4 1.5 9 1.5 9Z" />
      <circle cx="9" cy="9" r="2.4" />
    </svg>
  );
}

/** Trigger icon for the "Data ▾" popover — a stacked-disk database glyph. */
function IconData() {
  return (
    <svg
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <ellipse cx="9" cy="4.3" rx="6" ry="2.3" />
      <path d="M3 4.3v9.4c0 1.27 2.69 2.3 6 2.3s6-1.03 6-2.3V4.3" />
      <path d="M3 9c0 1.27 2.69 2.3 6 2.3s6-1.03 6-2.3" />
    </svg>
  );
}

function IconDownload() {
  return (
    <svg
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9 2.5V11.5" />
      <path d="M5 8 L9 12 L13 8" />
      <path d="M3 15.5H15" />
    </svg>
  );
}

function IconUpload() {
  return (
    <svg
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9 11.5V2.5" />
      <path d="M5 6 L9 2 L13 6" />
      <path d="M3 15.5H15" />
    </svg>
  );
}

function IconCamera() {
  return (
    <svg
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
    >
      <path d="M2.5 6 h2.2 L6 4.2h6l1.3 1.8h2.2v8.3a.7.7 0 0 1-.7.7H3.2a.7.7 0 0 1-.7-.7Z" />
      <circle cx="9" cy="10" r="2.8" />
    </svg>
  );
}

function IconGear() {
  return (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="9" cy="9" r="2.4" />
      <path
        d="M9 2.6v1.5M9 13.9v1.5M15.4 9h-1.5M4.1 9H2.6M13.3 4.7l-1.1 1.1M5.8 12.2l-1.1 1.1M13.3 13.3l-1.1-1.1M5.8 5.8 4.7 4.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconPath() {
  return (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <circle cx="4" cy="14" r="2.2" />
      <circle cx="14" cy="4" r="2.2" />
      <path d="M5.6 12.4 L8.5 9.5 M9.5 8.5 L12.4 5.6" strokeDasharray="0.1 2.6" />
    </svg>
  );
}

function IconBulb() {
  return (
    <svg
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9 2.2a4.6 4.6 0 0 0-2.7 8.3c.6.5 1 1.1 1 1.8v.5h3.4v-.5c0-.7.4-1.3 1-1.8A4.6 4.6 0 0 0 9 2.2Z" />
      <path d="M7.4 14.8h3.2M8.1 16.5h1.8" />
    </svg>
  );
}

function IconHistory() {
  return (
    <svg
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2.5 9a6.5 6.5 0 1 1 1.2 3.8" />
      <polyline points="2 5.5 2.5 9 6 8.5" />
      <polyline points="9 5.5 9 9.5 12 11" />
    </svg>
  );
}

function IconGrip() {
  return (
    <svg viewBox="0 0 18 18" fill="currentColor" stroke="none">
      <circle cx="6.5" cy="4" r="1.3" />
      <circle cx="11.5" cy="4" r="1.3" />
      <circle cx="6.5" cy="9" r="1.3" />
      <circle cx="11.5" cy="9" r="1.3" />
      <circle cx="6.5" cy="14" r="1.3" />
      <circle cx="11.5" cy="14" r="1.3" />
    </svg>
  );
}

function IconPlus() {
  return (
    <svg
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    >
      <path d="M9 3.2V14.8" />
      <path d="M3.2 9H14.8" />
    </svg>
  );
}

/* Dragged toolbar position, persisted across reloads. */
const TOOLBAR_POS_KEY = 'knowledge-nebula-toolbar-pos';

function loadToolbarPos(): { x: number; y: number } | null {
  try {
    const raw = localStorage.getItem(TOOLBAR_POS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { x?: unknown; y?: unknown };
    if (typeof parsed.x !== 'number' || typeof parsed.y !== 'number') return null;
    return { x: parsed.x, y: parsed.y };
  } catch {
    return null;
  }
}

function saveToolbarPos(pos: { x: number; y: number }): void {
  try {
    localStorage.setItem(TOOLBAR_POS_KEY, JSON.stringify(pos));
  } catch {
    /* private mode / quota exceeded — position simply won't persist */
  }
}

/** Pin the toolbar at (x, y), clamped ≥8px inside the viewport. */
function placeToolbar(el: HTMLElement, x: number, y: number): { x: number; y: number } {
  const rect = el.getBoundingClientRect();
  const cx = Math.min(Math.max(x, 8), window.innerWidth - rect.width - 8);
  const cy = Math.min(Math.max(y, 8), window.innerHeight - rect.height - 8);
  el.style.top = `${cy}px`;
  el.style.left = `${cx}px`;
  el.style.right = 'auto';
  el.style.marginInline = '0';
  return { x: cx, y: cy };
}

type MenuKey = 'view' | 'data';

export default function Toolbar() {
  const hasNodes = useGraphStore((s) => s.nodes.length > 0);
  const dims = useUiStore((s) => s.dims);
  const topicNodesEnabled = useUiStore((s) => s.topicNodesEnabled);
  const clusterCollapsed = useUiStore((s) => s.clusterCollapsed);
  const setSearchOpen = useUiStore((s) => s.setSearchOpen);
  const searchOpen = useUiStore((s) => s.searchOpen);
  const settingsOpen = useUiStore((s) => s.settingsOpen);
  const snapshotsOpen = useUiStore((s) => s.snapshotsOpen);
  const setDims = useUiStore((s) => s.setDims);
  const setTopicNodes = useUiStore((s) => s.setTopicNodes);
  const setClusterCollapsed = useUiStore((s) => s.setClusterCollapsed);
  const insightsOpen = useUiStore((s) => s.insightsOpen);
  const setInsightsOpen = useUiStore((s) => s.setInsightsOpen);
  const pathMode = useUiStore((s) => s.pathMode);
  const setPathMode = useUiStore((s) => s.setPathMode);
  const setSearchResults = useUiStore((s) => s.setSearchResults);
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);
  const setSnapshotsOpen = useUiStore((s) => s.setSnapshotsOpen);
  const sendCamera = useUiStore((s) => s.sendCamera);

  // Which popover menu (if any) is open. Only one at a time.
  const [openMenu, setOpenMenu] = useState<MenuKey | null>(null);
  const viewMenuWrapRef = useRef<HTMLDivElement | null>(null);
  const dataMenuWrapRef = useRef<HTMLDivElement | null>(null);

  const importInputRef = useRef<HTMLInputElement | null>(null);

  // Drag-to-move. The position is written straight to the element (not React
  // state): it changes on every pointer move and nothing else reads it. Until
  // the first drag the CSS default (top-center) applies; afterwards the
  // toolbar stays wherever the user left it, persisted via localStorage.
  const rootRef = useRef<HTMLDivElement | null>(null);
  const dragOffset = useRef<{ dx: number; dy: number } | null>(null);
  const lastPos = useRef<{ x: number; y: number } | null>(null);

  // Restore the saved position once the toolbar mounts (it only renders when
  // the graph has nodes). Re-clamps, so a spot saved on a larger window still
  // lands on-screen.
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el || !hasNodes) return;
    const saved = loadToolbarPos();
    if (saved) lastPos.current = placeToolbar(el, saved.x, saved.y);
  }, [hasNodes]);

  // Close whichever popover is open on outside click or Escape. Scoped to a
  // plain document listener that only ever touches local `openMenu` state —
  // it never reaches into App.tsx's global Escape cascade (search/path
  // mode/settings/etc). The keydown listener is registered in the capture
  // phase so it runs — and stops — before App's window-level bubble handler,
  // meaning dismissing a toolbar menu with Escape doesn't also trigger the
  // app's "nothing else is open, so fit the camera" fallback.
  useEffect(() => {
    if (!openMenu) return;
    const wrapRef = openMenu === 'view' ? viewMenuWrapRef : dataMenuWrapRef;
    const handlePointerDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpenMenu(null);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [openMenu]);

  // A floating dropdown must not coexist with a modal overlay: if one opens
  // (e.g. Cmd+K search while the View menu is up), close the menu so its
  // capture-phase Escape handler can't swallow the modal's own Escape.
  useEffect(() => {
    if (searchOpen || settingsOpen || snapshotsOpen) setOpenMenu(null);
  }, [searchOpen, settingsOpen, snapshotsOpen]);

  if (!hasNodes) return null;

  const toggleMenu = (key: MenuKey) => {
    setOpenMenu((cur) => (cur === key ? null : key));
  };

  const handleGripPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragOffset.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handleGripPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragOffset.current;
    const el = rootRef.current;
    if (!drag || !el) return;
    lastPos.current = placeToolbar(el, e.clientX - drag.dx, e.clientY - drag.dy);
  };

  const handleGripPointerUp = () => {
    if (dragOffset.current && lastPos.current) saveToolbarPos(lastPos.current);
    dragOffset.current = null;
  };

  const handleToggleDims = () => {
    const next = dims === 3 ? 2 : 3;
    setDims(next);
    layoutSetDims(next);
  };

  const handleImportChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file later
    if (!file) return;
    importGraphJSONFile(file).catch((err) => {
      console.warn('import failed', err);
      useUiStore
        .getState()
        .pushToast(err instanceof Error ? err.message : 'Import failed — unknown error.');
    });
  };

  return (
    <div ref={rootRef} className="toolbar glass-panel">
      <div
        className="toolbar__grip"
        title="Move toolbar"
        onPointerDown={handleGripPointerDown}
        onPointerMove={handleGripPointerMove}
        onPointerUp={handleGripPointerUp}
        onPointerCancel={handleGripPointerUp}
      >
        <IconGrip />
      </div>

      <button
        type="button"
        className="btn-icon"
        title="Search (⌘K)"
        onClick={() => setSearchOpen(true)}
      >
        <IconSearch />
      </button>

      <button
        type="button"
        className="btn-icon"
        title="Fit view"
        onClick={() => sendCamera('fitAll')}
      >
        <IconFit />
      </button>

      {/* View ▾ — 2D/3D, topic nodes, cluster collapse */}
      <div className="toolbar__menu-wrap" ref={viewMenuWrapRef}>
        <button
          type="button"
          // Lit when the menu is open OR any view mode is active, so the
          // collapsed toolbar still signals "something is on" at a glance.
          className={`btn-icon${
            openMenu === 'view' || dims === 2 || topicNodesEnabled || clusterCollapsed
              ? ' is-active'
              : ''
          }`}
          title="View options"
          aria-haspopup="true"
          aria-expanded={openMenu === 'view'}
          onClick={(e) => {
            e.stopPropagation();
            toggleMenu('view');
          }}
        >
          <IconView />
        </button>
        {openMenu === 'view' && (
          <div className="toolbar__menu glass-panel">
            <button
              type="button"
              className={`toolbar__menu-item${dims === 2 ? ' is-active' : ''}`}
              title={dims === 3 ? 'Switch to 2D' : 'Switch to 3D'}
              aria-pressed={dims === 2}
              onClick={handleToggleDims}
            >
              <IconCube twoD={dims === 2} />
              <span>2D view</span>
            </button>
            <button
              type="button"
              className={`toolbar__menu-item${topicNodesEnabled ? ' is-active' : ''}`}
              title={topicNodesEnabled ? 'Hide topic nodes' : 'Show topic nodes'}
              aria-pressed={topicNodesEnabled}
              onClick={() => setTopicNodes(!topicNodesEnabled)}
            >
              <IconOctahedron />
              <span>Topic nodes</span>
            </button>
            <button
              type="button"
              className={`toolbar__menu-item${clusterCollapsed ? ' is-active' : ''}`}
              title={clusterCollapsed ? 'Expand clusters' : 'Collapse to super-nodes'}
              aria-pressed={clusterCollapsed}
              onClick={() => setClusterCollapsed(!clusterCollapsed)}
            >
              <IconCollapse />
              <span>Collapse clusters</span>
            </button>
          </div>
        )}
      </div>

      <button
        type="button"
        className={`btn-icon${pathMode ? ' is-active' : ''}`}
        title={pathMode ? 'Exit path mode' : 'How are these connected? (pick two nodes)'}
        onClick={() => {
          // Both directions clear the shared highlight channel: exiting drops
          // the path highlight, entering drops any search/insights highlight
          // so the first endpoint pick doesn't silently clobber it later.
          setSearchResults(null);
          setPathMode(!pathMode);
        }}
      >
        <IconPath />
      </button>

      <button
        type="button"
        className={`btn-icon${insightsOpen ? ' is-active' : ''}`}
        title="Corpus insights"
        onClick={() => setInsightsOpen(!insightsOpen)}
      >
        <IconBulb />
      </button>

      <div className="toolbar__divider" />

      {/* Snapshots drawer — also hosts saving the current graph */}
      <button
        type="button"
        className="btn-icon"
        title="Saved snapshots"
        onClick={() => setSnapshotsOpen(true)}
      >
        <IconHistory />
      </button>

      {/* Data ▾ — export JSON/PNG, import JSON */}
      <div className="toolbar__menu-wrap" ref={dataMenuWrapRef}>
        <button
          type="button"
          className={`btn-icon${openMenu === 'data' ? ' is-active' : ''}`}
          title="Data options"
          aria-haspopup="true"
          aria-expanded={openMenu === 'data'}
          onClick={(e) => {
            e.stopPropagation();
            toggleMenu('data');
          }}
        >
          <IconData />
        </button>
        {openMenu === 'data' && (
          <div className="toolbar__menu glass-panel">
            <button
              type="button"
              className="toolbar__menu-item"
              title="Export JSON"
              onClick={() => {
                setOpenMenu(null); // one-shot action — dismiss the menu
                exportGraphJSON().catch((err) => {
                  console.warn('export JSON failed', err);
                  useUiStore.getState().pushToast("Couldn't export the graph as JSON.");
                });
              }}
            >
              <IconDownload />
              <span>Export JSON</span>
            </button>
            <button
              type="button"
              className="toolbar__menu-item"
              title="Import JSON"
              onClick={() => {
                setOpenMenu(null);
                importInputRef.current?.click();
              }}
            >
              <IconUpload />
              <span>Import JSON</span>
            </button>
            <input
              ref={importInputRef}
              type="file"
              accept="application/json,.json"
              className="toolbar__hidden-input"
              aria-label="Import graph JSON"
              onChange={handleImportChange}
            />
            <button
              type="button"
              className="toolbar__menu-item"
              title="Export PNG"
              onClick={() => {
                setOpenMenu(null);
                exportScenePNG();
              }}
            >
              <IconCamera />
              <span>Export PNG</span>
            </button>
          </div>
        )}
      </div>

      <div className="toolbar__divider" />

      <button
        type="button"
        className="btn-icon"
        title="Settings"
        onClick={() => setSettingsOpen(true)}
      >
        <IconGear />
      </button>

      <button
        type="button"
        className="btn-icon"
        title="Add files"
        onClick={() => {
          openFilePicker();
        }}
      >
        <IconPlus />
      </button>
    </div>
  );
}

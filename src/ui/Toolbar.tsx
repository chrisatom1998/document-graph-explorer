import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';
import { layoutSetDims } from '../layout/layoutBridge';
import { openFilePicker } from '../ingest/DropZone';
import ExportImportMenu from './ExportImportMenu';

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

function IconShowMe() {
  return (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.3 9S4.9 4 9 4s6.7 5 6.7 5-2.6 5-6.7 5-6.7-5-6.7-5Z" />
      <circle cx="9" cy="9" r="2" />
      <path d="M9 1.8v1.1M9 15.1v1.1M16.2 9h-1.1M2.9 9H1.8" opacity="0.65" />
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

/**
 * Settings gear — a classic 8-knob cog. The center hole circle is defined
 * at (12,12), the exact center of the 24x24 viewBox, so it's always
 * perfectly centered regardless of render size.
 */
function IconGear() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
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
      <ellipse cx="9" cy="4.2" rx="5.5" ry="2.2" />
      <path d="M3.5 4.2v4.8c0 1.2 2.5 2.2 5.5 2.2s5.5-1 5.5-2.2V4.2" />
      <path d="M3.5 9v4.8c0 1.2 2.5 2.2 5.5 2.2s5.5-1 5.5-2.2V9" />
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
  const setSearchOpen = useUiStore((s) => s.setSearchOpen);
  const showMeOpen = useUiStore((s) => s.showMeOpen);
  const setShowMeOpen = useUiStore((s) => s.setShowMeOpen);
  const searchOpen = useUiStore((s) => s.searchOpen);
  const settingsOpen = useUiStore((s) => s.settingsOpen);
  const snapshotsOpen = useUiStore((s) => s.snapshotsOpen);
  const setDims = useUiStore((s) => s.setDims);
  const setTopicNodes = useUiStore((s) => s.setTopicNodes);
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
  const [dataDialogOpen, setDataDialogOpen] = useState(false);
  const viewMenuWrapRef = useRef<HTMLDivElement | null>(null);
  const dataMenuWrapRef = useRef<HTMLDivElement | null>(null);

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

  // A pinned toolbar must survive the window shrinking mid-session, not just
  // at mount — re-clamp on resize (default centered layout needs no clamp).
  useEffect(() => {
    const onResize = () => {
      const el = rootRef.current;
      const pos = lastPos.current;
      if (!el || !pos) return;
      lastPos.current = placeToolbar(el, pos.x, pos.y);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Close whichever popover is open on outside click or Escape. Scoped to a
  // plain document listener that only ever touches local `openMenu` state —
  // it never reaches into App.tsx's global Escape cascade (search/path
  // mode/settings/etc). The keydown listener is registered in the capture
  // phase so it runs — and stops — before App's window-level bubble handler,
  // meaning dismissing a toolbar menu with Escape doesn't also trigger the
  // app's "nothing else is open, so fit the camera" fallback.
  useEffect(() => {
    if (!openMenu || dataDialogOpen) return;
    const handlePointerDown = (e: PointerEvent) => {
      const activeRef = openMenu === 'view' ? viewMenuWrapRef : dataMenuWrapRef;
      if (activeRef.current && !activeRef.current.contains(e.target as Node)) {
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
  }, [dataDialogOpen, openMenu]);

  // A floating dropdown must not coexist with a modal overlay: if one opens
  // (e.g. Cmd+K search while the View menu is up), close the menu so its
  // capture-phase Escape handler can't swallow the modal's own Escape.
  useEffect(() => {
    if (searchOpen || showMeOpen || settingsOpen || snapshotsOpen) setOpenMenu(null);
  }, [searchOpen, showMeOpen, settingsOpen, snapshotsOpen]);

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
        onClick={() => {
          setShowMeOpen(false);
          setSearchResults(null);
          setSearchOpen(true);
        }}
      >
        <IconSearch />
      </button>

      <button
        type="button"
        className={`btn-icon${showMeOpen ? ' is-active' : ''}`}
        title="Show me a topic"
        onClick={() => {
          const nextShowMeOpen = !showMeOpen;
          setSearchOpen(false);
          setShowMeOpen(nextShowMeOpen);
          if (!nextShowMeOpen) setSearchResults(null);
        }}
      >
        <IconShowMe />
      </button>

      <button
        type="button"
        className="btn-icon"
        title="Fit view"
        onClick={() => sendCamera('fitAll')}
      >
        <IconFit />
      </button>

      {/* View ▾ — 2D/3D and topic nodes */}
      <div className="toolbar__menu-wrap" ref={viewMenuWrapRef}>
        <button
          type="button"
          // Lit when the menu is open OR any view mode is active, so the
          // collapsed toolbar still signals "something is on" at a glance.
          className={`btn-icon${
            openMenu === 'view' || dims === 2 || topicNodesEnabled
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
          <ExportImportMenu
            onClose={() => setOpenMenu(null)}
            onDialogOpenChange={setDataDialogOpen}
          />
        )}
      </div>

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

import {
  useCallback,
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
import { saveCurrentSnapshot } from '../persistence/session';

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

function IconSave() {
  return (
    <svg
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4.5 2.5h7.5l3.5 3.5v8.5a1 1 0 0 1-1 1h-10a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1z" />
      <rect x="6" y="2.5" width="5" height="4" rx="0.5" />
      <rect x="5.5" y="10" width="7" height="4" rx="0.5" />
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

/** Default snapshot name: "Snapshot — Jul 2, 2026 5:50 AM" */
function defaultSnapshotName(): string {
  const d = new Date();
  return `Snapshot — ${d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })} ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
}

export default function Toolbar() {
  const hasNodes = useGraphStore((s) => s.nodes.length > 0);
  const phase = useGraphStore((s) => s.phase);
  const dims = useUiStore((s) => s.dims);
  const topicNodesEnabled = useUiStore((s) => s.topicNodesEnabled);
  const clusterCollapsed = useUiStore((s) => s.clusterCollapsed);
  const setSearchOpen = useUiStore((s) => s.setSearchOpen);
  const setDims = useUiStore((s) => s.setDims);
  const setTopicNodes = useUiStore((s) => s.setTopicNodes);
  const setClusterCollapsed = useUiStore((s) => s.setClusterCollapsed);
  const insightsOpen = useUiStore((s) => s.insightsOpen);
  const setInsightsOpen = useUiStore((s) => s.setInsightsOpen);
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);
  const setSnapshotsOpen = useUiStore((s) => s.setSnapshotsOpen);
  const sendCamera = useUiStore((s) => s.sendCamera);

  // Save snapshot state
  const [savePromptOpen, setSavePromptOpen] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saveFlash, setSaveFlash] = useState(false);
  const [saving, setSaving] = useState(false);
  const saveInputRef = useRef<HTMLInputElement | null>(null);

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

  const openSavePrompt = useCallback(() => {
    setSaveName(defaultSnapshotName());
    setSavePromptOpen(true);
    // Focus the input after it renders
    requestAnimationFrame(() => saveInputRef.current?.select());
  }, []);

  const handleSave = useCallback(async () => {
    const name = saveName.trim() || defaultSnapshotName();
    setSaving(true);
    try {
      const id = await saveCurrentSnapshot(name);
      if (id !== undefined) {
        setSaveFlash(true);
        setTimeout(() => setSaveFlash(false), 1200);
      } else {
        useUiStore.getState().pushToast("Couldn't save the snapshot — storage is unavailable.");
      }
    } catch (err) {
      console.warn('[knowledge-nebula] snapshot save failed', err);
      useUiStore.getState().pushToast("Couldn't save the snapshot.");
    } finally {
      setSaving(false);
      setSavePromptOpen(false);
    }
  }, [saveName]);

  if (!hasNodes) return null;

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

      <button
        type="button"
        className="btn-icon"
        title={dims === 3 ? 'Switch to 2D' : 'Switch to 3D'}
        onClick={handleToggleDims}
      >
        <IconCube twoD={dims === 2} />
      </button>

      <button
        type="button"
        className={`btn-icon${topicNodesEnabled ? ' is-active' : ''}`}
        title={topicNodesEnabled ? 'Hide topic nodes' : 'Show topic nodes'}
        onClick={() => setTopicNodes(!topicNodesEnabled)}
      >
        <IconOctahedron />
      </button>

      <button
        type="button"
        className={`btn-icon${clusterCollapsed ? ' is-active' : ''}`}
        title={clusterCollapsed ? 'Expand clusters' : 'Collapse to super-nodes'}
        onClick={() => setClusterCollapsed(!clusterCollapsed)}
      >
        <IconCollapse />
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

      {/* Save snapshot */}
      <div className="toolbar__save-wrap">
        <button
          type="button"
          className={`btn-icon${saveFlash ? ' save-flash' : ''}`}
          title="Save snapshot"
          disabled={phase !== 'ready' || saving}
          onClick={() => {
            if (savePromptOpen) {
              setSavePromptOpen(false);
            } else {
              openSavePrompt();
            }
          }}
        >
          <IconSave />
        </button>
        {savePromptOpen && (
          <div className="save-prompt glass-panel">
            <input
              ref={saveInputRef}
              className="save-prompt__input"
              type="text"
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSave();
                if (e.key === 'Escape') setSavePromptOpen(false);
              }}
              placeholder="Snapshot name"
              autoComplete="off"
            />
            <button
              type="button"
              className="save-prompt__btn"
              disabled={saving}
              onClick={handleSave}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        )}
      </div>

      {/* Snapshots drawer */}
      <button
        type="button"
        className="btn-icon"
        title="Saved snapshots"
        onClick={() => setSnapshotsOpen(true)}
      >
        <IconHistory />
      </button>

      <div className="toolbar__divider" />

      <button
        type="button"
        className="btn-icon"
        title="Export JSON"
        onClick={() => {
          exportGraphJSON().catch((err) => {
            console.warn('export JSON failed', err);
            useUiStore.getState().pushToast("Couldn't export the graph as JSON.");
          });
        }}
      >
        <IconDownload />
      </button>

      <button
        type="button"
        className="btn-icon"
        title="Import JSON"
        onClick={() => importInputRef.current?.click()}
      >
        <IconUpload />
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
        className="btn-icon"
        title="Export PNG"
        onClick={() => exportScenePNG()}
      >
        <IconCamera />
      </button>

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

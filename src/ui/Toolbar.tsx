import {
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';
import { useCollabStore } from '../collab/store';
import { layoutSetDims } from '../layout/layoutBridge';
import { openFilePicker } from '../ingest/DropZone';
// Imported eagerly so the activation-gated picker opens synchronously with
// the click; folderPicker demand-loads the heavy scanner itself.
import { openFolderPicker } from '../ingest/folderPicker';
import { useFocusTrap } from './useFocusTrap';

import {
  IconAnalyze,
  IconBulb,
  IconCollab,
  IconCube,
  IconData,
  IconFit,
  IconFolderPlus,
  IconGear,
  IconGrip,
  IconHelp,
  IconHistory,
  IconOctahedron,
  IconPath,
  IconPlus,
  IconSearch,
  IconView,
} from './icons';

const ExportImportMenu = lazy(() => import('./ExportImportMenu'));
const CorpusSwitcher = lazy(() => import('./CorpusSwitcher'));
const SavedViewsSection = lazy(() => import('./SavedViewsSection'));

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

type MenuKey = 'view' | 'analyze' | 'data' | 'add' | 'collab';

export default function Toolbar() {
  const hasNodes = useGraphStore((s) => s.nodes.length > 0);
  const dims = useUiStore((s) => s.dims);
  const topicNodesEnabled = useUiStore((s) => s.topicNodesEnabled);
  const setSearchOpen = useUiStore((s) => s.setSearchOpen);
  const searchOpen = useUiStore((s) => s.searchOpen);
  const settingsOpen = useUiStore((s) => s.settingsOpen);
  const snapshotsOpen = useUiStore((s) => s.snapshotsOpen);
  const helpOpen = useUiStore((s) => s.helpOpen);
  const setDims = useUiStore((s) => s.setDims);
  const collabSession = useCollabStore((s) => s.session);
  const collabInvite = useCollabStore((s) => s.invite);
  const collabPeers = useCollabStore((s) => s.peers);
  const remotePeerCount = Object.keys(collabPeers).length;
  const followMode = useCollabStore((s) => s.followMode);
  const setFollowMode = useCollabStore((s) => s.setFollowMode);
  const shareNotes = useCollabStore((s) => s.shareNotes);
  const setShareNotes = useCollabStore((s) => s.setShareNotes);
  const startSession = useCollabStore((s) => s.startSession);
  const joinInvite = useCollabStore((s) => s.joinInvite);
  const leaveSession = useCollabStore((s) => s.leaveSession);
  const setTopicNodes = useUiStore((s) => s.setTopicNodes);
  const insightsOpen = useUiStore((s) => s.insightsOpen);
  const setInsightsOpen = useUiStore((s) => s.setInsightsOpen);
  const pathMode = useUiStore((s) => s.pathMode);
  const setPathMode = useUiStore((s) => s.setPathMode);
  const setSearchResults = useUiStore((s) => s.setSearchResults);
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);
  const setSnapshotsOpen = useUiStore((s) => s.setSnapshotsOpen);
  const setHelpOpen = useUiStore((s) => s.setHelpOpen);
  const clusterCollapsed = useUiStore((s) => s.clusterCollapsed);
  const setClusterCollapsed = useUiStore((s) => s.setClusterCollapsed);
  const sendCamera = useUiStore((s) => s.sendCamera);

  // Which popover menu (if any) is open. Only one at a time.
  const [openMenu, setOpenMenu] = useState<MenuKey | null>(null);
  const [dataDialogOpen, setDataDialogOpen] = useState(false);
  const [joinDialogOpen, setJoinDialogOpen] = useState(false);
  const [joinInviteValue, setJoinInviteValue] = useState('');
  const [joining, setJoining] = useState(false);
  const joinDialogRef = useRef<HTMLDivElement | null>(null);
  const joinGenerationRef = useRef(0);
  useFocusTrap(joinDialogRef, joinDialogOpen);

  const viewMenuWrapRef = useRef<HTMLDivElement | null>(null);
  const analyzeMenuWrapRef = useRef<HTMLDivElement | null>(null);
  const dataMenuWrapRef = useRef<HTMLDivElement | null>(null);
  const collabMenuWrapRef = useRef<HTMLDivElement | null>(null);
  const addMenuWrapRef = useRef<HTMLDivElement | null>(null);

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
    if (!openMenu || dataDialogOpen || joinDialogOpen) return;
    const handlePointerDown = (e: PointerEvent) => {
      const wrap =
        openMenu === 'view'
          ? viewMenuWrapRef.current
          : openMenu === 'analyze'
            ? analyzeMenuWrapRef.current
            : openMenu === 'add'
              ? addMenuWrapRef.current
              : openMenu === 'collab'
                ? collabMenuWrapRef.current
                : dataMenuWrapRef.current;
      if (wrap && !wrap.contains(e.target as Node)) {
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
  }, [dataDialogOpen, joinDialogOpen, openMenu]);

  // A floating dropdown must not coexist with a modal overlay: if one opens
  // (e.g. Cmd+K search while the View menu is up), close the menu so its
  // capture-phase Escape handler can't swallow the modal's own Escape.
  useEffect(() => {
    if (searchOpen || settingsOpen || snapshotsOpen || helpOpen) {
      setOpenMenu(null);
      // Invalidate any in-flight join so force-close cannot leave `joining`
      // stuck (Cancel/Join disabled) or apply a session after dismiss.
      joinGenerationRef.current += 1;
      setJoinDialogOpen(false);
      setJoinInviteValue('');
      setJoining(false);
    }
  }, [searchOpen, settingsOpen, snapshotsOpen, helpOpen]);

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

  const handleCollabHost = async () => {
    try {
      const invite = await startSession();
      setOpenMenu(null);
      if (invite) {
        useUiStore.getState().pushToast('Collaboration session ready. Copy the invite and share it with a peer.', 'info');
      }
    } catch (error) {
      useUiStore.getState().pushToast(error instanceof Error ? error.message : 'Collaboration is unavailable in this build.', 'error');
    }
  };

  const handleCollabJoin = () => {
    setOpenMenu(null);
    setJoinInviteValue('');
    setJoinDialogOpen(true);
  };

  const cancelCollabJoin = () => {
    if (joining) return;
    setJoinDialogOpen(false);
    setJoinInviteValue('');
  };

  const submitCollabJoin = async () => {
    const raw = joinInviteValue.trim();
    if (!raw || joining) return;
    const generation = joinGenerationRef.current;
    setJoining(true);
    try {
      const invite = await joinInvite(raw);
      if (generation !== joinGenerationRef.current) {
        if (invite) leaveSession();
        return;
      }
      if (invite) {
        setJoinDialogOpen(false);
        setJoinInviteValue('');
        useUiStore.getState().pushToast('Joined a collaboration session.', 'info');
        return;
      }
      useUiStore.getState().pushToast('This collaboration invite is invalid.', 'error');
    } catch (error) {
      if (generation !== joinGenerationRef.current) return;
      useUiStore.getState().pushToast(error instanceof Error ? error.message : 'Collaboration is unavailable in this build.', 'error');
    } finally {
      if (generation === joinGenerationRef.current) {
        setJoining(false);
      }
    }
  };

  const handleCopyInvite = async () => {
    if (!collabInvite) return;
    try {
      await navigator.clipboard.writeText(collabInvite);
      useUiStore.getState().pushToast('Collaboration invite copied to the clipboard.', 'info');
    } catch {
      useUiStore.getState().pushToast('Clipboard access is unavailable in this browser.', 'error');
    }
  };

  return (
    <>
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

      <Suspense fallback={null}><CorpusSwitcher /></Suspense>

      <div className="toolbar__divider" />

      <button
        type="button"
        className="btn-icon"
        title="Search (⌘K)"
        aria-label="Search documents"
        onClick={() => {
          setSearchResults(null);
          setSearchOpen(true);
        }}
      >
        <IconSearch />
      </button>

      <button
        type="button"
        className="btn-icon"
        title="Fit view"
        aria-label="Fit the whole graph in view"
        onClick={() => sendCamera('fitAll')}
      >
        <IconFit />
      </button>

      <div className="toolbar__menu-wrap" ref={viewMenuWrapRef}>
        <button
          type="button"
          className={`btn-icon${
            openMenu === 'view' || dims === 2 || topicNodesEnabled || clusterCollapsed
              ? ' is-active'
              : ''
          }`}
          title="View options"
          aria-label="View options"
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
              title={clusterCollapsed ? 'Show document nodes' : 'Collapse clusters'}
              aria-pressed={clusterCollapsed}
              onClick={() => setClusterCollapsed(!clusterCollapsed)}
            >
              <IconOctahedron />
              <span>Collapse clusters</span>
            </button>

            <Suspense fallback={null}>
              <SavedViewsSection onApplied={() => setOpenMenu(null)} />
            </Suspense>

            <div role="separator" className="toolbar__menu-sep" />
            <button
              type="button"
              className="toolbar__menu-item"
              title="Help and graph legend"
              onClick={() => {
                setOpenMenu(null);
                setHelpOpen(true);
              }}
            >
              <IconHelp />
              <span>Help & legend</span>
            </button>
          </div>
        )}
      </div>

      <div className="toolbar__menu-wrap" ref={analyzeMenuWrapRef}>
        <button
          type="button"
          className={`btn-icon${
            openMenu === 'analyze' || pathMode || insightsOpen || snapshotsOpen ? ' is-active' : ''
          }`}
          title="Analyze the corpus"
          aria-label="Analyze"
          aria-haspopup="true"
          aria-expanded={openMenu === 'analyze'}
          onClick={(e) => {
            e.stopPropagation();
            toggleMenu('analyze');
          }}
        >
          <IconAnalyze />
        </button>
        {openMenu === 'analyze' && (
          <div className="toolbar__menu glass-panel">
            <button
              type="button"
              className={`toolbar__menu-item${pathMode ? ' is-active' : ''}`}
              title={pathMode ? 'Exit path mode' : 'How are these connected? (pick two nodes)'}
              aria-pressed={pathMode}
              onClick={() => {
                setSearchResults(null);
                setPathMode(!pathMode);
                setOpenMenu(null);
              }}
            >
              <IconPath />
              <span>How are these connected?</span>
            </button>
            <button
              type="button"
              className={`toolbar__menu-item${insightsOpen ? ' is-active' : ''}`}
              title="Corpus insights"
              aria-pressed={insightsOpen}
              onClick={() => {
                setInsightsOpen(!insightsOpen);
                setOpenMenu(null);
              }}
            >
              <IconBulb />
              <span>Corpus insights</span>
            </button>
            <button
              type="button"
              className="toolbar__menu-item"
              title="Saved snapshots"
              onClick={() => {
                setSnapshotsOpen(true);
                setOpenMenu(null);
              }}
            >
              <IconHistory />
              <span>Snapshots</span>
            </button>
          </div>
        )}
      </div>

      <div className="toolbar__menu-wrap" ref={dataMenuWrapRef}>
        <button
          type="button"
          className={`btn-icon${openMenu === 'data' ? ' is-active' : ''}`}
          title="Data options"
          aria-label="Data options"
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
          <Suspense fallback={null}>
            <ExportImportMenu
              onClose={() => setOpenMenu(null)}
              onDialogOpenChange={setDataDialogOpen}
            />
          </Suspense>
        )}
      </div>

      <div className="toolbar__menu-wrap" ref={collabMenuWrapRef}>
        <button
          type="button"
          className={`btn-icon${openMenu === 'collab' || collabSession ? ' is-active' : ''}`}
          title={collabSession ? `Collaboration active (${collabSession.roomId})` : 'Collaboration'}
          aria-label="Collaboration"
          aria-haspopup="true"
          aria-expanded={openMenu === 'collab'}
          onClick={(e) => {
            e.stopPropagation();
            toggleMenu('collab');
          }}
        >
          <IconCollab />
        </button>
        {openMenu === 'collab' && (
          <div className="toolbar__menu glass-panel">
            {!collabSession ? (
              <>
                <button type="button" className="toolbar__menu-item" onClick={handleCollabHost}>
                  <IconCollab />
                  <span>Start session</span>
                </button>
                <button type="button" className="toolbar__menu-item" onClick={handleCollabJoin}>
                  <IconCollab />
                  <span>Join invite</span>
                </button>
              </>
            ) : (
              <>
                <button type="button" className="toolbar__menu-item" onClick={handleCopyInvite}>
                  <IconCollab />
                  <span>Copy invite</span>
                </button>
                <button
                  type="button"
                  className="toolbar__menu-item"
                  onClick={() => {
                    leaveSession();
                    setOpenMenu(null);
                    useUiStore.getState().pushToast('Collaboration session closed.', 'info');
                  }}
                >
                  <IconCollab />
                  <span>Leave session</span>
                </button>
                <button
                  type="button"
                  className={`toolbar__menu-item${followMode ? ' is-active' : ''}`}
                  title={followMode ? 'Release local control and resume editing the graph' : 'Follow the presenter and mirror their view'}
                  aria-pressed={followMode}
                  onClick={() => {
                    setFollowMode(!followMode);
                    setOpenMenu(null);
                  }}
                >
                  <IconCollab />
                  <span>{followMode ? 'Stop following' : 'Follow presenter'}</span>
                </button>
              </>
            )}
            <div role="separator" className="toolbar__menu-sep" />
            <button
              type="button"
              className={`toolbar__menu-item${shareNotes ? ' is-active' : ''}`}
              title={
                shareNotes
                  ? 'Stop syncing notes and tags with the room'
                  : 'Keep notes and tags on this device (default)'
              }
              aria-pressed={shareNotes}
              onClick={() => setShareNotes(!shareNotes)}
            >
              <IconCollab />
              <span>{shareNotes ? 'Sharing notes & tags' : 'Notes & tags stay local'}</span>
            </button>
            {collabSession && (
              <div style={{ padding: '2px 10px 6px', fontSize: 12, opacity: 0.8 }}>
                {remotePeerCount <= 0
                  ? 'Just you — waiting for peers'
                  : remotePeerCount === 1
                    ? 'You + 1 other'
                    : `You + ${remotePeerCount} others`}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="toolbar__divider" />

      <button
        type="button"
        className="btn-icon"
        title="Settings"
        aria-label="Settings"
        onClick={() => setSettingsOpen(true)}
      >
        <IconGear />
      </button>

      <div className="toolbar__menu-wrap" ref={addMenuWrapRef}>
        <button
          type="button"
          className={`btn-icon${openMenu === 'add' ? ' is-active' : ''}`}
          title="Add documents"
          aria-label="Add documents"
          data-ingest-add=""
          aria-haspopup="true"
          aria-expanded={openMenu === 'add'}
          onClick={(e) => {
            e.stopPropagation();
            toggleMenu('add');
          }}
        >
          <IconPlus />
        </button>
        {openMenu === 'add' && (
          <div className="toolbar__menu glass-panel">
            <button
              type="button"
              className="toolbar__menu-item"
              title="Add files"
              onClick={() => {
                setOpenMenu(null);
                openFilePicker();
              }}
            >
              <IconPlus />
              <span>Add files</span>
            </button>
            <button
              type="button"
              className="toolbar__menu-item"
              title="Add a folder — every relevant file inside it is added, subfolders included"
              onClick={() => {
                setOpenMenu(null);
                openFolderPicker();
              }}
            >
              <IconFolderPlus />
              <span>Add folder</span>
            </button>
          </div>
        )}
      </div>
    </div>
    {joinDialogOpen &&
      createPortal(
        <div className="settings-backdrop" onClick={cancelCollabJoin}>
          <div
            ref={joinDialogRef}
            className="glass-panel confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="collab-join-title"
            tabIndex={-1}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.stopPropagation();
                cancelCollabJoin();
              }
            }}
          >
            <h2 id="collab-join-title" className="confirm-dialog__title">
              Join a collaboration session
            </h2>
            <p className="confirm-dialog__text">
              Paste a collaboration invite link or fragment.
            </p>
            <label className="sr-only" htmlFor="collab-join-input">
              Collaboration invite
            </label>
            <input
              id="collab-join-input"
              className="settings-input confirm-dialog__input"
              type="text"
              value={joinInviteValue}
              onChange={(event) => setJoinInviteValue(event.target.value)}
              placeholder="#collab=…"
              autoComplete="off"
              spellCheck={false}
              disabled={joining}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void submitCollabJoin();
              }}
            />
            <div className="confirm-dialog__row">
              <button
                type="button"
                className="snapshot-btn"
                disabled={joining}
                onClick={cancelCollabJoin}
              >
                Cancel
              </button>
              <button
                type="button"
                className="snapshot-btn snapshot-btn--load"
                disabled={joining || !joinInviteValue.trim()}
                onClick={() => void submitCollabJoin()}
              >
                {joining ? 'Joining…' : 'Join'}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

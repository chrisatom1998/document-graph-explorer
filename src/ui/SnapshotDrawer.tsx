/**
 * Snapshot drawer: save the current graph as a named snapshot, and lists
 * saved snapshots with load/delete actions.
 * Reuses the settings-backdrop / glass-panel pattern from SettingsPanel.
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  deleteSnapshot,
  listSnapshots,
  type SnapshotSummary,
} from '../persistence/cache';
import { restoreSnapshotById, saveCurrentSnapshot } from '../persistence/session';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';
import { useFocusTrap } from './useFocusTrap';

const panelStyle: CSSProperties = {
  width: 'min(480px, 92vw)',
  maxHeight: '82vh',
  overflowY: 'auto',
  padding: '20px 22px',
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
};
const headerRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
};
const titleStyle: CSSProperties = {
  margin: 0,
  fontSize: 17,
  fontWeight: 600,
  letterSpacing: 0.3,
};
const closeBtnStyle: CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: 'inherit',
  cursor: 'pointer',
  fontSize: 16,
  lineHeight: 1,
  padding: 4,
  opacity: 0.7,
};

function formatDate(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
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

export default function SnapshotDrawer() {
  const open = useUiStore((s) => s.snapshotsOpen);
  const setOpen = useUiStore((s) => s.setSnapshotsOpen);
  const phase = useGraphStore((s) => s.phase);
  const [snapshots, setSnapshots] = useState<SnapshotSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionId, setActionId] = useState<number | null>(null); // snapshot being acted on

  // Save current graph
  const [saveName, setSaveName] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveFlash, setSaveFlash] = useState(false);
  const saveInputRef = useRef<HTMLInputElement | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, open);

  const refresh = useCallback(() => {
    // listSnapshots() catches internally and always resolves (never rejects)
    // — fire-and-forget from this synchronous callback.
    void listSnapshots().then(setSnapshots);
  }, []);

  useEffect(() => {
    if (open) {
      refresh();
      setSaveName(defaultSnapshotName());
      // Pre-select the default name so the user can immediately type over it.
      requestAnimationFrame(() => saveInputRef.current?.select());
    }
  }, [open, refresh]);

  const handleSave = useCallback(async () => {
    const name = saveName.trim() || defaultSnapshotName();
    setSaving(true);
    try {
      const id = await saveCurrentSnapshot(name);
      if (id !== undefined) {
        setSaveFlash(true);
        setTimeout(() => setSaveFlash(false), 1200);
        setSaveName(defaultSnapshotName());
        refresh();
      } else {
        useUiStore.getState().pushToast("Couldn't save the snapshot — storage is unavailable.");
      }
    } catch (err) {
      console.warn('[knowledge-nebula] snapshot save failed', err);
      useUiStore.getState().pushToast("Couldn't save the snapshot.");
    } finally {
      setSaving(false);
    }
  }, [saveName, refresh]);

  if (!open) return null;

  const handleLoad = async (id: number) => {
    setActionId(id);
    setLoading(true);
    const ok = await restoreSnapshotById(id);
    setLoading(false);
    setActionId(null);
    if (ok) setOpen(false);
    else useUiStore.getState().pushToast("Couldn't load that snapshot.");
  };

  const handleDelete = async (id: number) => {
    setActionId(id);
    const ok = await deleteSnapshot(id);
    setActionId(null);
    if (!ok) useUiStore.getState().pushToast("Couldn't delete that snapshot.");
    refresh();
  };

  const saveDisabled = phase !== 'ready' || saving;

  return (
    <div className="settings-backdrop" onClick={() => setOpen(false)}>
      <div
        ref={dialogRef}
        className="snapshot-drawer glass-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Snapshots"
        style={panelStyle}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={headerRowStyle}>
          <h2 style={titleStyle}>Saved Snapshots</h2>
          <button
            type="button"
            style={closeBtnStyle}
            onClick={() => setOpen(false)}
            aria-label="Close snapshots"
            title="Close snapshots"
          >
            ✕
          </button>
        </div>

        <div className="snapshot-save-row">
          <input
            ref={saveInputRef}
            className="save-prompt__input"
            type="text"
            title="Name this snapshot"
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            onKeyDown={(e) => {
              // handleSave catches its own errors (toasts on failure) and
              // never rejects — fire-and-forget from this key handler.
              if (e.key === 'Enter' && !saveDisabled) void handleSave();
            }}
            placeholder="Snapshot name"
            autoComplete="off"
          />
          <button
            type="button"
            className={`save-prompt__btn${saveFlash ? ' save-flash' : ''}`}
            title="Save the current graph as a named snapshot"
            disabled={saveDisabled}
            onClick={handleSave}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>

        {snapshots.length === 0 ? (
          <div className="snapshot-empty">
            <p className="snapshot-empty__text">No snapshots yet</p>
            <p className="snapshot-empty__hint">
              Use the save row above to create a snapshot of your current graph.
            </p>
          </div>
        ) : (
          <ul className="snapshot-list">
            {snapshots.map((snap) => (
              <li key={snap.id} className="snapshot-item">
                <div className="snapshot-item__info">
                  <span className="snapshot-item__name">{snap.name}</span>
                  <span className="snapshot-item__meta">
                    {formatDate(snap.savedAt)} · {snap.nodeCount} node
                    {snap.nodeCount !== 1 ? 's' : ''}
                  </span>
                </div>
                <div className="snapshot-item__actions">
                  <button
                    type="button"
                    className="snapshot-btn snapshot-btn--load"
                    disabled={loading && actionId === snap.id}
                    onClick={() => handleLoad(snap.id)}
                    title="Load this snapshot"
                  >
                    {loading && actionId === snap.id ? 'Loading…' : 'Load'}
                  </button>
                  <button
                    type="button"
                    className="snapshot-btn snapshot-btn--delete"
                    disabled={actionId === snap.id}
                    onClick={() => handleDelete(snap.id)}
                    title="Delete this snapshot"
                  >
                    ✕
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * Snapshot drawer: lists saved snapshots with load/delete actions.
 * Reuses the settings-backdrop / glass-panel pattern from SettingsPanel.
 */

import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import {
  deleteSnapshot,
  listSnapshots,
  type SnapshotSummary,
} from '../persistence/cache';
import { restoreSnapshotById } from '../persistence/session';
import { useUiStore } from '../store/uiStore';

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

export default function SnapshotDrawer() {
  const open = useUiStore((s) => s.snapshotsOpen);
  const setOpen = useUiStore((s) => s.setSnapshotsOpen);
  const [snapshots, setSnapshots] = useState<SnapshotSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionId, setActionId] = useState<number | null>(null); // snapshot being acted on

  const refresh = useCallback(() => {
    listSnapshots().then(setSnapshots);
  }, []);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

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

  return (
    <div className="settings-backdrop" onClick={() => setOpen(false)}>
      <div
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
          >
            ✕
          </button>
        </div>

        {snapshots.length === 0 ? (
          <div className="snapshot-empty">
            <p className="snapshot-empty__text">No snapshots yet</p>
            <p className="snapshot-empty__hint">
              Use the save button in the toolbar to create a snapshot of your current graph.
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

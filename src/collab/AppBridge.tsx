import { useEffect, useRef, useState, type CSSProperties, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { useUiStore } from '../store/uiStore';
import { useFocusTrap } from '../ui/useFocusTrap';
import {
  COLLAB_JOIN_CANCEL,
  COLLAB_JOIN_CONFIRM,
  COLLAB_JOIN_TITLE,
  collabJoinDisclosure,
  hashLooksLikeCollabInvite,
} from './joinConsent';
import { useCollabStore } from './store';

const confirmPanelStyle: CSSProperties = {
  width: 'min(420px, 92vw)',
  padding: '20px 22px',
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
};
const confirmTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: 17,
  fontWeight: 600,
};
const confirmTextStyle: CSSProperties = {
  margin: 0,
  fontSize: 13,
  lineHeight: 1.55,
  opacity: 0.78,
};
const confirmRowStyle: CSSProperties = {
  display: 'flex',
  gap: 8,
  justifyContent: 'flex-end',
};

function stripCollabHash(): void {
  window.history.replaceState(
    window.history.state,
    '',
    `${window.location.pathname}${window.location.search}`,
  );
}

export default function CollabAppBridge(): ReactElement | null {
  const selectedId = useUiStore((s) => s.selectedId);
  const dims = useUiStore((s) => s.dims);
  const filter = useUiStore((s) => s.filter);
  const topicNodesEnabled = useUiStore((s) => s.topicNodesEnabled);
  const clusterCollapsed = useUiStore((s) => s.clusterCollapsed);
  const followMode = useCollabStore((s) => s.followMode);
  const lastRemoteView = useCollabStore((s) => s.lastRemoteView);
  const shareNotes = useCollabStore((s) => s.shareNotes);
  const [pendingInvite, setPendingInvite] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, pendingInvite !== null);

  useEffect(() => {
    useCollabStore.getState().setLocalPresence({ selectedId: selectedId ?? null });
  }, [selectedId]);

  useEffect(() => {
    const { session, followMode: active, syncSharedView } = useCollabStore.getState();
    if (!session || active) return;
    syncSharedView();
  }, [selectedId, dims, filter, topicNodesEnabled, clusterCollapsed]);

  useEffect(() => {
    if (!followMode || !lastRemoteView) return;
    const remoteFilter = lastRemoteView.filter;
    const changed =
      (lastRemoteView.dims !== undefined && dims !== lastRemoteView.dims) ||
      (lastRemoteView.selectedId !== undefined && selectedId !== lastRemoteView.selectedId) ||
      (lastRemoteView.topicNodesEnabled !== undefined &&
        topicNodesEnabled !== lastRemoteView.topicNodesEnabled) ||
      (lastRemoteView.clusterCollapsed !== undefined &&
        clusterCollapsed !== lastRemoteView.clusterCollapsed) ||
      (remoteFilter !== undefined && JSON.stringify(filter) !== JSON.stringify(remoteFilter));
    if (changed) {
      useCollabStore.getState().setFollowMode(false);
    }
  }, [clusterCollapsed, dims, filter, followMode, lastRemoteView, selectedId, topicNodesEnabled]);

  useEffect(() => {
    if (!hashLooksLikeCollabInvite(window.location.hash)) return;
    // Consent-before-join: keep the hash and do not connect until the user
    // confirms. Cancel leaves the hash in place.
    setPendingInvite(window.location.hash);
  }, []);

  const confirmJoin = async (): Promise<void> => {
    if (!pendingInvite || joining) return;
    setJoining(true);
    try {
      const joined = await useCollabStore.getState().joinInvite(pendingInvite);
      if (!joined) {
        console.warn('Collaboration invite rejected');
        return;
      }
      stripCollabHash();
      setPendingInvite(null);
    } catch (error: unknown) {
      console.warn('Collaboration invite rejected', error);
    } finally {
      setJoining(false);
    }
  };

  const cancelJoin = (): void => {
    if (joining) return;
    setPendingInvite(null);
  };

  return (
    <>
      {pendingInvite &&
        createPortal(
          <div className="settings-backdrop" onClick={cancelJoin}>
            <div
              ref={dialogRef}
              className="glass-panel"
              role="dialog"
              aria-modal="true"
              aria-label={COLLAB_JOIN_TITLE}
              style={confirmPanelStyle}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                if (event.key === 'Escape') cancelJoin();
              }}
            >
              <h2 style={confirmTitleStyle}>{COLLAB_JOIN_TITLE}</h2>
              <p style={confirmTextStyle}>{collabJoinDisclosure(shareNotes)}</p>
              <div style={confirmRowStyle}>
                <button
                  type="button"
                  className="snapshot-btn"
                  disabled={joining}
                  onClick={cancelJoin}
                >
                  {COLLAB_JOIN_CANCEL}
                </button>
                <button
                  type="button"
                  className="snapshot-btn snapshot-btn--load"
                  disabled={joining}
                  onClick={() => void confirmJoin()}
                >
                  {joining ? 'Joining…' : COLLAB_JOIN_CONFIRM}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

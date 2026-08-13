import { useEffect } from 'react';
import { useUiStore } from '../store/uiStore';
import { useCollabStore } from './store';

export default function CollabAppBridge(): null {
  const selectedId = useUiStore((s) => s.selectedId);
  const dims = useUiStore((s) => s.dims);
  const filter = useUiStore((s) => s.filter);
  const topicNodesEnabled = useUiStore((s) => s.topicNodesEnabled);
  const clusterCollapsed = useUiStore((s) => s.clusterCollapsed);
  const followMode = useCollabStore((s) => s.followMode);
  const lastRemoteView = useCollabStore((s) => s.lastRemoteView);

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
    if (!window.location.hash.startsWith('#collab=')) return;
    const invite = window.location.hash;
    const join = useCollabStore.getState().joinInvite(invite);
    window.history.replaceState(
      window.history.state,
      '',
      `${window.location.pathname}${window.location.search}`,
    );
    void join.catch((error: unknown) => {
      console.warn('Collaboration invite rejected', error);
    });
  }, []);

  return null;
}

import { useMemo, useState } from 'react';
import { useGraphStore } from '../../store/graphStore';
import { useUiStore } from '../../store/uiStore';
import { usePlayerStore, loadDemo } from './player';
import { neighborsOf } from './library';

/** Library, focus clip and its neighbours: the state every music design renders from. */
export function useLibrary() {
  const nodes = useGraphStore(s => s.nodes);
  const nodeIndex = useGraphStore(s => s.nodeIndex);
  const edges = useGraphStore(s => s.edges);
  const phase = useGraphStore(s => s.phase);
  const selectedId = useUiStore(s => s.selectedId);
  const playingId = usePlayerStore(s => s.currentId);
  const docs = useMemo(() => nodes.filter(n => n.kind === 'document'), [nodes]);
  const audio = useMemo(() => docs.filter(n => n.fileType === 'audio'), [docs]);
  const selected = selectedId !== null ? nodes[nodeIndex[selectedId]] : undefined;
  const playing = playingId !== null ? nodes[nodeIndex[playingId]] : undefined;
  // With nothing picked yet, the first sample stands in as the featured one.
  const focus = selected ?? playing ?? audio[0] ?? docs[0];
  const neighbors = useMemo(() => (focus ? neighborsOf(focus.id, nodes, nodeIndex, edges) : []), [focus, nodes, nodeIndex, edges]);
  return {
    docs, audio, selected, playing, focus, neighbors, phase, edges,
    empty: docs.length === 0 && phase === 'idle',
    ready: phase === 'ready',
  };
}

/** Welcome actions with a shared busy flag so a second click cannot queue another demo. */
export function useDemoLoader() {
  const [busy, setBusy] = useState<'audio' | 'docs' | null>(null);
  const start = (kind: 'audio' | 'docs') => {
    if (busy) return;
    loadDemo(kind, on => setBusy(on ? kind : null));
  };
  return { busy, start };
}

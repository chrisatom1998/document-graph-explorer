import { useEffect, useMemo } from 'react';
import { useGraphStore } from '../store/graphStore';
import { layoutReheat, layoutSetLinks } from '../layout/layoutBridge';
import { buildTitleEdges } from './titleLinks';

/** Upgrade open/saved collections and keep renamed titles in sync without audio inference. */
export default function TitleRelationships() {
  const nodes = useGraphStore(state => state.nodes);
  const edges = useGraphStore(state => state.edges);
  const phase = useGraphStore(state => state.phase);
  const titles = useMemo(() => buildTitleEdges(nodes), [nodes]);
  useEffect(() => {
    if (phase !== 'ready') return;
    const previous = edges.filter(edge => edge.kind === 'title' && !edge.authored);
    if (JSON.stringify(previous) === JSON.stringify(titles)) return;
    const next = [...edges.filter(edge => edge.kind !== 'title' || edge.authored), ...titles];
    useGraphStore.getState().setEdges(next);
    layoutSetLinks(next.map(({ source, target, weight }) => ({ source, target, weight })));
    // The normal settled-layout persistence path saves the refreshed graph.
    layoutReheat(0.3);
  }, [edges, phase, titles]);
  return null;
}

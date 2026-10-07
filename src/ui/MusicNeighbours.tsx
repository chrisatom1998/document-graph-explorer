import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { DocNode, Edge } from '../model/types';
import { EDGE_KIND_HEX } from '../scene/palette';
import { camelotCode } from '../audio/mixSuggestions';
import { focusNode } from './focusNode';
import { musicNeighbours, sharedTitlePrefix, stripTitlePrefix, shortKey, shownTempoKey, type NeighbourReason } from './musicDisplay';
import './MusicNeighbours.css';

const COLLAPSED = 5;
const chipColor = (kind: NeighbourReason['kind']) => kind === 'clash' ? 'var(--warning)' : EDGE_KIND_HEX[kind];

/** One list of the tracks to play next to this one: mixable tracks first (compatible key, tempo within beatmatching
 * range, then sound), then other tracks the graph links to it, each with its tempo, key and every reason. */
export default function MusicNeighbours({ node, nodes, nodeIndex, edges }: { node: DocNode; nodes: DocNode[]; nodeIndex: Record<string, number>; edges: Edge[] }) {
  const [showAll, setShowAll] = useState(false);
  useEffect(() => setShowAll(false), [node.id]);
  const rows = useMemo(() => musicNeighbours(node, edges, nodes, nodeIndex), [node, edges, nodes, nodeIndex]);
  const prefix = useMemo(() => sharedTitlePrefix(nodes.filter((n) => n.fileType === 'audio').map((n) => n.title)), [nodes]);
  const shown = showAll ? rows : rows.slice(0, COLLAPSED);
  const mixable = rows.filter((r) => r.mixable).length;
  return <section className="music-neighbours" aria-label="Mix with">
    <h3>Mix with{rows.length > 0 && <small>{mixable} compatible{rows.length > mixable ? ` · ${rows.length - mixable} more linked` : ''}</small>}</h3>
    {rows.length === 0 ? <p className="music-neighbours__empty">{shownTempoKey(node).bpm !== undefined || shownTempoKey(node).key ? 'No tracks in this library are in a compatible key and tempo yet.' : 'Tempo and key are not known for this track yet.'}</p> : <ol>
      {shown.map(({ id, node: other, reasons, mixable: fits }, index) => {
        const { bpm, key } = shownTempoKey(other);
        const title = stripTitlePrefix(other.title, prefix);
        return <li key={id} className={fits ? undefined : 'is-linked-only'}>
          {!fits && (index === 0 || shown[index - 1].mixable) && <p className="music-neighbours__divider">Linked, but key or tempo may not mix</p>}
          <button type="button" className="music-neighbours__title" title={other.title} onClick={() => focusNode(id)}>{title}</button>
          <span className="music-neighbours__meta">
            <span>{bpm !== undefined ? `${bpm} BPM` : '— BPM'}</span>
            {key ? <span>{shortKey(key)} <span className="camelot">{camelotCode(key)}</span></span> : <span>— key</span>}
          </span>
          <ul className="music-neighbours__reasons" aria-label={`Why ${other.title} is listed`}>
            {reasons.map((r) => <li key={`${r.kind}:${r.text}`} title={r.detail || undefined} style={{ '--reason-kind': chipColor(r.kind) } as CSSProperties}>{r.text}</li>)}
          </ul>
        </li>;
      })}
    </ol>}
    {rows.length > COLLAPSED && <button type="button" className="music-neighbours__more" onClick={() => setShowAll((v) => !v)}>
      {showAll ? `Show top ${COLLAPSED}` : `Show all ${rows.length} tracks`}
    </button>}
  </section>;
}

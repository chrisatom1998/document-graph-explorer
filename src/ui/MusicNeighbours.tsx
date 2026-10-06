import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { DocNode, Edge } from '../model/types';
import { EDGE_KIND_HEX } from '../scene/palette';
import { focusNode } from './focusNode';
import { camelotCode, musicNeighbours, sharedTitlePrefix, shortKey, shownTempoKey } from './musicDisplay';
import './MusicNeighbours.css';

const COLLAPSED = 5;

/** The tracks linked to this one, one row each, with tempo, key and every reason they are linked. */
export default function MusicNeighbours({ node, nodes, nodeIndex, edges }: { node: DocNode; nodes: DocNode[]; nodeIndex: Record<string, number>; edges: Edge[] }) {
  const [showAll, setShowAll] = useState(false);
  useEffect(() => setShowAll(false), [node.id]);
  const rows = useMemo(() => musicNeighbours(node, edges, nodes, nodeIndex), [node, edges, nodes, nodeIndex]);
  const prefix = useMemo(() => sharedTitlePrefix(nodes.filter((n) => n.fileType === 'audio').map((n) => n.title)), [nodes]);
  const shown = showAll ? rows : rows.slice(0, COLLAPSED);
  return <section className="music-neighbours" aria-label="Closest tracks">
    <h3>Closest tracks{rows.length > 0 && <small>{rows.length}</small>}</h3>
    {rows.length === 0 ? <p className="music-neighbours__empty">No linked tracks yet.</p> : <ol>
      {shown.map(({ id, node: other, reasons }) => {
        const { bpm, key } = shownTempoKey(other);
        const title = prefix && other.title.startsWith(prefix) ? other.title.slice(prefix.length) : other.title;
        return <li key={id}>
          <button type="button" className="music-neighbours__title" title={other.title} onClick={() => focusNode(id)}>{title}</button>
          <span className="music-neighbours__meta">
            <span>{bpm !== undefined ? `${bpm} BPM` : '— BPM'}</span>
            {key ? <span>{shortKey(key)} <span className="camelot">{camelotCode(key)}</span></span> : <span>— key</span>}
          </span>
          <ul className="music-neighbours__reasons" aria-label={`Why ${other.title} is linked`}>
            {reasons.map((r) => <li key={r.kind} title={r.detail} style={{ '--reason-kind': EDGE_KIND_HEX[r.kind] } as CSSProperties}>{r.text}</li>)}
          </ul>
        </li>;
      })}
    </ol>}
    {rows.length > COLLAPSED && <button type="button" className="music-neighbours__more" onClick={() => setShowAll((v) => !v)}>
      {showAll ? `Show top ${COLLAPSED}` : `Show all ${rows.length} tracks`}
    </button>}
  </section>;
}

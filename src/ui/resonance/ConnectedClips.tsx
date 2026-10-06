import { useEffect, useMemo, useState } from 'react';
import type { DocNode, Edge } from '../../model/types';
import { useGraphStore } from '../../store/graphStore';
import { useUiStore } from '../../store/uiStore';
import { EDGE_KIND_LABEL, hexFor } from '../../scene/palette';
import { keyName } from '../../audio/musicTypes';
import { focusNode } from '../focusNode';
import { ClipPlayer, ClipThumb, displayName, formatClock, useClipAudio } from './ClipWave';

const ACCENT = '#c8f55a';

interface Neighbor { node: DocNode; edges: Edge[]; strength: number }

/** Neighbors of `id` ordered by their strongest shared edge. */
function neighborsOf(id: string, nodes: DocNode[], nodeIndex: Record<string, number>, edges: Edge[]): Neighbor[] {
  const byId = new Map<string, Neighbor>();
  for (const edge of edges) {
    const other = edge.source === id ? edge.target : edge.target === id ? edge.source : null;
    if (!other) continue;
    const node = nodes[nodeIndex[other]];
    if (!node || node.kind !== 'document') continue;
    const entry = byId.get(other) ?? { node, edges: [], strength: 0 };
    entry.edges.push(edge);
    entry.strength = Math.max(entry.strength, edge.weight);
    byId.set(other, entry);
  }
  return [...byId.values()].sort((a, b) => b.strength - a.strength || a.node.title.localeCompare(b.node.title));
}

/** Row label and value for one shared edge: tempo/key show the measured value, everything else its strength. */
function characteristic(edge: Edge, a: DocNode, b: DocNode): { label: string; value: string; fill: number } {
  const label = EDGE_KIND_LABEL[edge.kind];
  const pct = Math.round(edge.weight * 100);
  if (edge.kind === 'tempo') {
    const bpm = a.audio?.tempo?.bpm ?? b.audio?.tempo?.bpm;
    return { label: 'Tempo match', value: bpm ? `${Math.round(bpm)} BPM` : `${pct}%`, fill: edge.weight };
  }
  if (edge.kind === 'key') {
    const key = a.audio?.key ?? b.audio?.key;
    return { label: 'Key match', value: key ? keyName(key) : `${pct}%`, fill: edge.weight };
  }
  const titled = label.charAt(0).toUpperCase() + label.slice(1);
  return { label: edge.kind === 'similar' ? 'Sounds alike' : titled, value: `${pct}%`, fill: edge.weight };
}

function ClipCard({ node, accent, active }: { node: DocNode; accent: string; active?: boolean }) {
  const { url, peaks } = useClipAudio(node);
  const { name, file } = displayName(node);
  const meta = node.fileType === 'audio'
    ? [formatClock(node.audio?.durationSeconds), node.audio?.tempo ? `${Math.round(node.audio.tempo.bpm)} BPM` : null, file.split('.').pop()?.toUpperCase()]
    : [node.fileType.toUpperCase(), `${node.wordCount.toLocaleString()} words`];
  return (
    <article className="rs-clip">
      <button type="button" className="rs-clip__head" onClick={() => focusNode(node.id)} title="Frame in graph">
        <ClipThumb node={node} peaks={peaks} active={active} />
        <span className="rs-clip__titles">
          <strong>{name}</strong>
          <span>{file}</span>
          <small>{meta.filter(Boolean).join(' • ')}</small>
        </span>
      </button>
      {node.fileType === 'audio' && <ClipPlayer node={node} url={url} peaks={peaks} color={accent} />}
    </article>
  );
}

/** Right-hand inspector: the selected clip, one connected clip at a time, and what they share. */
export default function ConnectedClips({ onOpenDetails }: { onOpenDetails: () => void }) {
  const nodes = useGraphStore(s => s.nodes);
  const nodeIndex = useGraphStore(s => s.nodeIndex);
  const edges = useGraphStore(s => s.edges);
  const selectedId = useUiStore(s => s.selectedId);
  const selected = selectedId !== null ? nodes[nodeIndex[selectedId]] : undefined;
  const neighbors = useMemo(() => (selected ? neighborsOf(selected.id, nodes, nodeIndex, edges) : []), [selected, nodes, nodeIndex, edges]);
  const [index, setIndex] = useState(0);
  useEffect(() => { setIndex(0); }, [selectedId]);
  const current = neighbors[Math.min(index, Math.max(0, neighbors.length - 1))];

  if (!selected) {
    return (
      <aside className="rs-inspector rs-inspector--empty" aria-label="Connected clips">
        <div>
          <span className="rs-inspector__mark" aria-hidden="true">◎</span>
          <h2>Pick a clip</h2>
          <p>Click a node in the graph to hear it and see what it shares with its neighbours.</p>
        </div>
      </aside>
    );
  }

  const audio = selected.fileType === 'audio';
  const rows = current ? current.edges.map(e => characteristic(e, selected, current.node)).sort((a, b) => b.fill - a.fill) : [];
  const evidence = current ? [...new Set(current.edges.flatMap(e => e.evidence))].slice(0, 3) : [];

  return (
    <aside className="rs-inspector" aria-label={audio ? 'Connected clips' : 'Connected documents'}>
      <header className="rs-inspector__bar">
        <span className="rs-pill">{audio ? 'Connected clips' : 'Connected documents'}</span>
        <span className="rs-inspector__count">{neighbors.length ? `${index + 1} of ${neighbors.length}` : 'No connections'}</span>
        <span className="rs-inspector__nav">
          <button type="button" aria-label="Previous connection" disabled={index <= 0} onClick={() => setIndex(i => Math.max(0, i - 1))}>‹</button>
          <button type="button" aria-label="Next connection" disabled={index >= neighbors.length - 1} onClick={() => setIndex(i => Math.min(neighbors.length - 1, i + 1))}>›</button>
        </span>
      </header>

      <ClipCard node={selected} accent="#a89bff" />

      {current && (
        <>
          <div className="rs-related">
            <span className="rs-related__dot" />
            <span className="rs-related__line" />
            <span className="rs-related__label"><i /> Related</span>
            <span className="rs-related__line" />
            <button type="button" className="rs-related__more" aria-label="Open full details" title="Open full details" onClick={onOpenDetails}>⋮</button>
          </div>
          <ClipCard node={current.node} accent={ACCENT} active />

          <section className="rs-shared" aria-label="Shared characteristics">
            <h3>Shared characteristics</h3>
            <ul>
              {rows.map((row, i) => (
                <li key={`${row.label}-${i}`}>
                  <span className="rs-shared__icon" style={{ color: hexFor(current.node.cluster) }} aria-hidden="true">♪</span>
                  <span className="rs-shared__label">{row.label}</span>
                  <span className="rs-shared__value">{row.value}</span>
                  <span className="rs-shared__bar"><i style={{ width: `${Math.round(row.fill * 100)}%`, background: i % 2 ? '#a89bff' : ACCENT }} /></span>
                </li>
              ))}
            </ul>
            {evidence.length > 0 && (
              <p className="rs-shared__note">
                <span aria-hidden="true">⫶</span>
                {evidence.join(' ')}
              </p>
            )}
          </section>
        </>
      )}
      {!current && <p className="rs-inspector__none">This {audio ? 'clip' : 'document'} has no connections yet. Lower the similarity filters or import more {audio ? 'clips' : 'files'}.</p>}
      <button type="button" className="rs-inspector__details" onClick={onOpenDetails}>Full details</button>
    </aside>
  );
}

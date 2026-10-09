import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import type { DocNode, Edge } from '../../model/types';
import { useGraphStore } from '../../store/graphStore';
import { useUiStore } from '../../store/uiStore';
import { EDGE_KIND_LABEL } from '../../scene/palette';
import { keyName } from '../../audio/musicTypes';
import { resolveTempoKey } from '../../audio/resolvedTempoKey';
import { briefEvidence } from './briefEvidence';
import { ClipPlayer, ClipThumb, formatClock, useClipAudio } from './ClipWave';

const ACCENT = '#c8f55a';
const SidePanel = lazy(() => import('../SidePanel'));

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

const strength = (w: number) => (w >= 0.75 ? 'Strong' : w >= 0.5 ? 'Medium' : 'Weak');
/** Tempo and key as the detail panel shows them: a value in the file/folder name wins over the audio estimate. */
function tempoOf(n: DocNode): number | null {
  return (n.fileType === 'audio' ? resolveTempoKey(n).tempo?.bpm : n.audio?.tempo?.bpm) ?? null;
}
function keyOf(n: DocNode): string | null {
  return n.fileType === 'audio' ? resolveTempoKey(n).keyLabel ?? null : n.audio?.key ? keyName(n.audio.key) : null;
}
const bpmText = (n: DocNode) => { const t = tempoOf(n); return t === null ? '?' : `${Math.round(t)}`; };

/** One "why they're connected" row: what is shared, the measured values where they exist, and how strongly. */
function reason(edge: Edge, a: DocNode, b: DocNode): { label: string; detail: string; fill: number; note: string; full: string } {
  const extra = { note: briefEvidence(edge), full: edge.evidence.join(' ') };
  const pct = `${Math.round(edge.weight * 100)}%`;
  // Measured values only when both clips have them; a link from file names alone falls back to its strength.
  if (edge.kind === 'tempo') {
    const ta = bpmText(a), tb = bpmText(b);
    const detail = ta === '?' || tb === '?' ? pct : ta === tb ? `both ${ta} BPM` : `${ta} vs ${tb} BPM`;
    return { label: 'Similar tempo', detail, fill: edge.weight, ...extra };
  }
  if (edge.kind === 'key') {
    const ka = keyOf(a), kb = keyOf(b);
    const detail = !ka || !kb ? pct : ka === kb ? `both ${ka}` : `${ka} vs ${kb}`;
    return { label: 'Compatible key', detail, fill: edge.weight, ...extra };
  }
  const labels: Partial<Record<Edge['kind'], string>> = {
    similar: 'Sounds alike', instrument: 'Same instruments', sound: 'Similar sound character', title: 'Similar names',
    semantic: 'Similar meaning', keyword: 'Shared keywords', entity: 'Shared names', reference: 'Linked', topic: 'Shared topic',
  };
  const label = labels[edge.kind] ?? EDGE_KIND_LABEL[edge.kind];
  return { label, detail: pct, fill: edge.weight, ...extra };
}

function ClipCard({ node, accent, active, action, player = true }: { node: DocNode; accent: string; active?: boolean; action?: { label: string; run: () => void }; player?: boolean }) {
  const { url, peaks } = useClipAudio(node);
  const file = node.path?.split('/').pop() ?? node.title;
  const meta = node.fileType === 'audio'
    ? [formatClock(node.audio?.durationSeconds), tempoOf(node) !== null ? `${bpmText(node)} BPM` : null, keyOf(node)]
    : [node.fileType.toUpperCase(), `${node.wordCount.toLocaleString()} words`];
  return (
    <article className="rs-clip">
      <div className="rs-clip__head">
        <ClipThumb node={node} peaks={peaks} active={active} size={52} />
        <span className="rs-clip__titles">
          <strong title={file}>{node.title}</strong>
          <small>{meta.filter(Boolean).join(' · ')}</small>
        </span>
        {action && <button type="button" className="rs-clip__action" onClick={action.run}>{action.label}</button>}
      </div>
      {player && node.fileType === 'audio' && <ClipPlayer node={node} url={url} peaks={peaks} color={accent} />}
    </article>
  );
}

/** Right-hand inspector: the selected clip, one connected clip at a time, and why they are connected. */
export default function ConnectedClips({ detailsOpen, onToggleDetails }: { detailsOpen: boolean; onToggleDetails: () => void }) {
  const nodes = useGraphStore(s => s.nodes);
  const nodeIndex = useGraphStore(s => s.nodeIndex);
  const edges = useGraphStore(s => s.edges);
  const hasAudio = useGraphStore(s => s.nodes.some(n => n.fileType === 'audio'));
  const selectedId = useUiStore(s => s.selectedId);
  const selected = selectedId !== null ? nodes[nodeIndex[selectedId]] : undefined;
  const neighbors = useMemo(() => (selected ? neighborsOf(selected.id, nodes, nodeIndex, edges) : []), [selected, nodes, nodeIndex, edges]);
  const [index, setIndex] = useState(0);
  const detailsButton = useRef<HTMLButtonElement>(null);
  // Bring the expanded panel into view: pin its toggle to the top of the
  // inspector (the lazily loaded panel itself may not exist yet).
  useEffect(() => {
    if (!detailsOpen) return;
    const id = requestAnimationFrame(() => detailsButton.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    return () => cancelAnimationFrame(id);
  }, [detailsOpen, selectedId]);
  useEffect(() => { setIndex(0); }, [selectedId]);
  const current = neighbors[Math.min(index, Math.max(0, neighbors.length - 1))];

  if (!selected) {
    // Worded for what the library holds: a PDF corpus is not asked to "hear" a clip.
    return (
      <aside className="rs-inspector rs-inspector--empty" aria-label={hasAudio ? 'Connected clips' : 'Connected documents'}>
        <div>
          <span className="rs-inspector__mark" aria-hidden="true">◎</span>
          <h2>{hasAudio ? 'Pick a clip' : 'Pick a document'}</h2>
          <p>{hasAudio ? 'Click a node in the graph to hear it and see which clips sound like it.' : 'Click a node in the graph to read it and see what it connects to.'}</p>
        </div>
      </aside>
    );
  }

  const audio = selected.fileType === 'audio';
  const noun = audio ? 'clip' : 'document';
  const rows = current ? current.edges.map(e => reason(e, selected, current.node)).sort((a, b) => b.fill - a.fill) : [];
  const select = (id: string) => { const ui = useUiStore.getState(); ui.setSelected(id); ui.sendCamera('frameNode', [id]); };

  return (
    <aside className="rs-inspector" aria-label={audio ? 'Connected clips' : 'Connected documents'}>
      <section className="rs-block" aria-label={`Selected ${noun}`}>
        <p className="rs-eyebrow">Selected {noun}</p>
        {/* Full details brings its own player for the selected clip; a second one here would play the clip twice. */}
        <ClipCard node={selected} accent="#a89bff" player={!detailsOpen} action={{ label: 'Find', run: () => useUiStore.getState().sendCamera('frameNode', [selected.id]) }} />
      </section>

      <section className="rs-block" aria-label={`Connected ${noun}s`}>
        <div className="rs-block__head">
          <p className="rs-eyebrow">{neighbors.length ? `Connected ${noun} ${index + 1} of ${neighbors.length}` : `Connected ${noun}s`}</p>
          {neighbors.length > 1 && (
            <span className="rs-inspector__nav">
              <button type="button" aria-label={`Previous connected ${noun}`} disabled={index <= 0} onClick={() => setIndex(i => Math.max(0, i - 1))}>‹</button>
              <button type="button" aria-label={`Next connected ${noun}`} disabled={index >= neighbors.length - 1} onClick={() => setIndex(i => Math.min(neighbors.length - 1, i + 1))}>›</button>
            </span>
          )}
        </div>
        {current
          ? <ClipCard node={current.node} accent={ACCENT} active action={{ label: 'Select', run: () => select(current.node.id) }} />
          : <p className="rs-inspector__none">No connected {noun}s yet. Clear the filters on the left or import more {audio ? 'clips' : 'files'}.</p>}
      </section>

      {current && (
        <section className="rs-shared" aria-label="Why they're connected">
          <h3>Why they’re connected</h3>
          <ul>
            {rows.map((row, i) => (
              <li key={`${row.label}-${i}`} title={row.full}>
                <span className="rs-shared__label">{row.label}</span>
                <span className="rs-shared__value">{row.detail}</span>
                <span className="rs-shared__bar" aria-hidden="true"><i style={{ width: `${Math.round(row.fill * 100)}%` }} /></span>
                <span className="rs-shared__strength">{strength(row.fill)}</span>
                {row.note && <span className="rs-shared__note">{row.note}</span>}
              </li>
            ))}
          </ul>
          <p className="rs-shared__foot">Strength shows how much the evidence agrees, not a probability. Hover a row for the full reasoning.</p>
        </section>
      )}

      <button type="button" ref={detailsButton} className="rs-inspector__details" aria-expanded={detailsOpen} aria-controls="rs-details" onClick={onToggleDetails}>
        <span className="rs-inspector__details-text">{detailsOpen ? 'Hide full details' : 'Full details'} <strong>· {selected.title}</strong></span>
        <span aria-hidden="true">{detailsOpen ? '⌃' : '⌄'}</span>
      </button>
      {detailsOpen && (
        <div id="rs-details" className="rs-details">
          <Suspense fallback={<p className="rs-inspector__none">Loading details…</p>}><SidePanel inline onClose={onToggleDetails} /></Suspense>
        </div>
      )}
    </aside>
  );
}

import { useMemo, useState } from 'react';
import type { EdgeKind, FileType } from '../../model/types';
import { useGraphStore } from '../../store/graphStore';
import { DEFAULT_FILTER, useUiStore } from '../../store/uiStore';
import { isFilterActive } from '../../scene/emphasis';
import { keyName } from '../../audio/musicTypes';
import { styleTags } from '../../audio/styleTags';
import { openFilePicker } from '../../ingest/DropZone';
import { openFolderPicker } from '../../ingest/folderPicker';

const SIMILARITY: { kind: EdgeKind; label: string }[] = [
  { kind: 'instrument', label: 'Instruments' },
  { kind: 'sound', label: 'Sound properties' },
  { kind: 'similar', label: 'Sounds alike' },
  { kind: 'tempo', label: 'Tempo' },
  { kind: 'key', label: 'Key' },
  { kind: 'title', label: 'Shared title' },
  { kind: 'semantic', label: 'Similar meaning' },
  { kind: 'keyword', label: 'Keywords' },
  { kind: 'entity', label: 'Entities' },
  { kind: 'reference', label: 'Links' },
];

const TYPE_LABEL: Partial<Record<FileType, string>> = { audio: 'Audio', pdf: 'PDF', md: 'Markdown', txt: 'Text', html: 'HTML', docx: 'Word', pptx: 'Slides', xlsx: 'Sheets', code: 'Code' };

/** Left column: import, project count and the Resonance filter stack. */
export default function ResonanceFilters() {
  const nodes = useGraphStore(s => s.nodes);
  const edges = useGraphStore(s => s.edges);
  const filter = useUiStore(s => s.filter);
  const setFilter = useUiStore(s => s.setFilter);
  const [similarityOpen, setSimilarityOpen] = useState(true);

  const docs = useMemo(() => nodes.filter(n => n.kind === 'document'), [nodes]);
  const audio = docs.some(n => n.fileType === 'audio');
  const kindsPresent = useMemo(() => new Set(edges.map(e => e.kind)), [edges]);
  const similarity = SIMILARITY.filter(s => kindsPresent.has(s.kind));
  const bpms = useMemo(() => docs.flatMap(n => (n.audio?.tempo ? [Math.round(n.audio.tempo.bpm)] : [])), [docs]);
  const bpmMin = bpms.length ? Math.min(...bpms) : 60;
  const bpmMax = bpms.length ? Math.max(...bpms) : 180;
  const keys = useMemo(() => [...new Set(docs.flatMap(n => (n.audio?.key ? [keyName(n.audio.key)] : [])))].sort(), [docs]);
  const styles = useMemo(() => [...new Set(docs.flatMap(n => styleTags(n.audio)))].sort(), [docs]);
  const types = useMemo(() => [...new Set(docs.map(n => n.fileType))], [docs]);

  const checked = (kind: EdgeKind) => filter.edgeKinds !== null && filter.edgeKinds.includes(kind);
  const toggleKind = (kind: EdgeKind) => {
    const current = filter.edgeKinds ?? [];
    const next = current.includes(kind) ? current.filter(k => k !== kind) : [...current, kind];
    setFilter({ edgeKinds: next.length ? next : null });
  };
  const range = filter.bpmRange ?? [bpmMin, bpmMax];
  const setRange = (lo: number, hi: number) => {
    const next: [number, number] = [Math.min(lo, hi), Math.max(lo, hi)];
    setFilter({ bpmRange: next[0] <= bpmMin && next[1] >= bpmMax ? null : next });
  };

  return (
    <aside className="rs-sidebar" aria-label="Filters">
      <button type="button" className="rs-import" onClick={openFilePicker}>
        <span className="rs-import__plus" aria-hidden="true">+</span>
        <span><strong>{audio || docs.length === 0 ? 'Import clips' : 'Import files'}</strong><small>Audio files, drag and drop, or browse</small></span>
      </button>
      <button type="button" className="rs-import rs-import--secondary" onClick={openFolderPicker}>
        <span className="rs-import__plus" aria-hidden="true">♫</span>
        <span><strong>Import sounds</strong><small>Pick a whole folder of samples</small></span>
      </button>
      <p className="rs-count">{docs.length} {audio || docs.length === 0 ? 'clips' : 'files'} in project</p>

      <div className="rs-filters-head">
        <h2>Filters</h2>
        <button type="button" disabled={!isFilterActive(filter)} onClick={() => setFilter(DEFAULT_FILTER)}>Clear all</button>
      </div>

      <section className="rs-group">
        <button type="button" className="rs-group__head" aria-expanded={similarityOpen} onClick={() => setSimilarityOpen(v => !v)}>
          Similarity type <span aria-hidden="true">{similarityOpen ? '⌃' : '⌄'}</span>
        </button>
        {similarityOpen && (
          <ul className="rs-checks">
            {(similarity.length ? similarity : SIMILARITY.slice(0, 5)).map(({ kind, label }) => (
              <li key={kind}>
                <label>
                  <input type="checkbox" checked={checked(kind)} onChange={() => toggleKind(kind)} disabled={!kindsPresent.has(kind)} />
                  <span className="rs-check" aria-hidden="true" />
                  {label}
                </label>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rs-group rs-group--rule">
        <h3>Tempo (BPM)</h3>
        <div className="rs-range" style={{ '--lo': `${((range[0] - bpmMin) / Math.max(1, bpmMax - bpmMin)) * 100}%`, '--hi': `${((range[1] - bpmMin) / Math.max(1, bpmMax - bpmMin)) * 100}%` } as React.CSSProperties}>
          <span className="rs-range__track" aria-hidden="true"><i /></span>
          <input type="range" min={bpmMin} max={bpmMax} value={range[0]} aria-label="Minimum tempo" disabled={!bpms.length} onChange={e => setRange(Number(e.target.value), range[1])} />
          <input type="range" min={bpmMin} max={bpmMax} value={range[1]} aria-label="Maximum tempo" disabled={!bpms.length} onChange={e => setRange(range[0], Number(e.target.value))} />
        </div>
        <div className="rs-range__ends"><span>{range[0]}</span><span>{range[1]}</span></div>
      </section>

      <section className="rs-group">
        <h3>Key</h3>
        <select className="rs-select" aria-label="Key" value={filter.musicKey ?? ''} disabled={!keys.length} onChange={e => setFilter({ musicKey: e.target.value || null })}>
          <option value="">Any key</option>
          {keys.map(k => <option key={k} value={k}>{k}</option>)}
        </select>
      </section>

      <section className="rs-group">
        <h3>Genre / Style</h3>
        <select className="rs-select" aria-label="Genre or style" value={filter.style ?? ''} disabled={!styles.length} onChange={e => setFilter({ style: e.target.value || null })}>
          <option value="">Any style</option>
          {styles.map(s => <option key={s} value={s}>{s.replaceAll('_', ' ')}</option>)}
        </select>
      </section>

      <section className="rs-group">
        <h3>File type</h3>
        <select className="rs-select" aria-label="File type" value={filter.fileTypes?.[0] ?? ''} disabled={types.length < 2} onChange={e => setFilter({ fileTypes: e.target.value ? [e.target.value as FileType] : null })}>
          <option value="">Any type</option>
          {types.map(t => <option key={t} value={t}>{TYPE_LABEL[t] ?? t}</option>)}
        </select>
      </section>
    </aside>
  );
}

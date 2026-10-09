import { useEffect, useMemo, useState } from 'react';
import type { EdgeKind, FileType } from '../../model/types';
import { useGraphStore } from '../../store/graphStore';
import { DEFAULT_FILTER, useUiStore } from '../../store/uiStore';
import { isFilterActive } from '../../scene/emphasis';
import { matchesKeyName, resolveTempoKey } from '../../audio/resolvedTempoKey';
import { styleTags } from '../../audio/styleTags';
import { nodeSoundTags } from '../../audio/soundFilterTags';
import { soundLabelText } from '../../audio/djTags';
import { openFilePicker } from '../../ingest/DropZone';
import { openFolderPicker } from '../../ingest/folderPicker';
import { lazy, Suspense } from 'react';

// The classic panel still owns cluster, connection-count, edge-weight and
// recency filtering, which the Resonance facets above do not cover.
const FilterBar = lazy(() => import('../FilterBar'));
import { IconFolderPlus, IconFunnel } from '../icons';

const COLLAPSED_KEY = 'resonance-sidebar-collapsed';
function loadCollapsed(): boolean {
  try { return localStorage.getItem(COLLAPSED_KEY) === '1'; } catch { return false; }
}

const SIMILARITY: { kind: EdgeKind; label: string }[] = [
  { kind: 'instrument', label: 'Instruments' },
  { kind: 'sound', label: 'Sound properties' },
  { kind: 'similar', label: 'Sounds alike' },
  { kind: 'tempo', label: 'Tempo' },
  { kind: 'key', label: 'Key' },
  { kind: 'version', label: 'Versions' },
  { kind: 'genre', label: 'Same genre' },
  { kind: 'title', label: 'Shared title' },
  { kind: 'semantic', label: 'Similar meaning' },
  { kind: 'keyword', label: 'Keywords' },
  { kind: 'entity', label: 'Names and places' },
  { kind: 'reference', label: 'Links' },
];

/** Sounds listed before "Show all". */
const SOUNDS_SHOWN = 8;

const TYPE_LABEL: Partial<Record<FileType, string>> = { audio: 'Audio', pdf: 'PDF', md: 'Markdown', txt: 'Text', html: 'HTML', docx: 'Word', pptx: 'Slides', xlsx: 'Sheets', code: 'Code' };

/** Left column: import, project count and the Resonance filter stack. */
export default function ResonanceFilters() {
  const nodes = useGraphStore(s => s.nodes);
  const edges = useGraphStore(s => s.edges);
  const filter = useUiStore(s => s.filter);
  const setFilter = useUiStore(s => s.setFilter);
  const [similarityOpen, setSimilarityOpen] = useState(true);
  const [allSounds, setAllSounds] = useState(false);
  const [collapsed, setCollapsed] = useState(loadCollapsed);
  // Narrow screens show only an action row; this opens the full filter list over the graph.
  const [narrowOpen, setNarrowOpen] = useState(false);
  useEffect(() => {
    try { localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0'); } catch { /* The choice just won't persist. */ }
    // The column width lives on .app-root so fixed overlays outside the grid follow it too.
    document.querySelector('.app-root')?.classList.toggle('rs-side-collapsed', collapsed);
    return () => document.querySelector('.app-root')?.classList.remove('rs-side-collapsed');
  }, [collapsed]);

  const docs = useMemo(() => nodes.filter(n => n.kind === 'document'), [nodes]);
  const audioCount = docs.filter(n => n.fileType === 'audio').length;
  const audio = audioCount > 0;
  // A saved filter, or removing the last clip, can leave an audio facet active
  // in a document-only library. Always leave its value and a way to clear it visible.
  const audioFilterActive = filter.bpmRange !== null || filter.musicKey !== null
    || filter.style !== null || !!filter.sounds?.length;
  const kindsPresent = useMemo(() => new Set(edges.map(e => e.kind)), [edges]);
  const similarity = SIMILARITY.filter(s => kindsPresent.has(s.kind));
  const tempoKeys = useMemo(() => docs.filter(n => n.fileType === 'audio').map(resolveTempoKey), [docs]);
  const bpms = useMemo(() => tempoKeys.flatMap(({ tempo }) => tempo ? [Math.round(tempo.bpm)] : []), [tempoKeys]);
  const bpmMin = bpms.length ? Math.min(...bpms) : 60;
  const bpmMax = bpms.length ? Math.max(...bpms) : 180;
  const keys = useMemo(() => [...new Set(tempoKeys.flatMap(({ keyLabel }) => keyLabel ? [keyLabel] : []))].sort(), [tempoKeys]);
  const selectedKey = filter.musicKey;
  const keyValue = selectedKey === null ? '' : keys.find(label => label === selectedKey)
    ?? tempoKeys.find(({ key }) => matchesKeyName(key, selectedKey))?.keyLabel ?? selectedKey;
  const styles = useMemo(() => [...new Set(docs.flatMap(n => styleTags(n.audio)))].sort(), [docs]);
  // File types present, most common first; a type kept by a saved view but absent from the corpus still lists so it can be unticked.
  const typeCounts = useMemo(() => {
    const counts = new Map<FileType, number>();
    for (const n of docs) counts.set(n.fileType, (counts.get(n.fileType) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1]);
  }, [docs]);
  const pickedTypes = filter.fileTypes ?? [];
  const typeRows = [...typeCounts, ...pickedTypes.filter(t => !typeCounts.some(([ft]) => ft === t)).map(t => [t, 0] as [FileType, number])];
  const toggleType = (type: FileType) => {
    const next = pickedTypes.includes(type) ? pickedTypes.filter(t => t !== type) : [...pickedTypes, type];
    setFilter({ fileTypes: next.length ? next : null });
  };
  // Every label shown in a clip's Sounds row, most common first.
  const soundCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const n of docs) for (const tag of nodeSoundTags(n)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [docs]);
  const pickedSounds = filter.sounds ?? [];
  // Picked sounds stay visible even outside the short list, or at zero clips after a
  // rejection or removal, so they can always be unticked.
  const soundRows = [...soundCounts, ...pickedSounds.filter(tag => !soundCounts.some(([t]) => t === tag)).map(tag => [tag, 0] as [string, number])];
  const listedSounds = allSounds ? soundRows : soundRows.filter(([tag], i) => i < SOUNDS_SHOWN || pickedSounds.includes(tag));
  const toggleSound = (tag: string) => {
    const next = pickedSounds.includes(tag) ? pickedSounds.filter(t => t !== tag) : [...pickedSounds, tag];
    setFilter({ sounds: next.length ? next : null });
  };

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
    <aside className={`rs-sidebar${collapsed ? ' is-collapsed' : ''}${narrowOpen ? ' is-narrow-open' : ''}`} aria-label="Filters">
      <button type="button" className="rs-narrow-filters" aria-expanded={narrowOpen} onClick={() => setNarrowOpen(v => !v)}>
        <IconFunnel /><span>{narrowOpen ? 'Done' : 'Filters'}</span>{isFilterActive(filter) && <i aria-label="filters on" />}
      </button>
      <button type="button" className="rs-collapse" aria-expanded={!collapsed} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={() => setCollapsed(v => !v)}>
        <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.5" y="2.5" width="13" height="11" rx="2" /><path d="M6 2.5v11" /><path d={collapsed ? 'M9 6.5l1.8 1.5L9 9.5' : 'M11 6.5L9.2 8l1.8 1.5'} /></svg>
      </button>
      <button type="button" className="rs-import" onClick={openFilePicker} title={collapsed ? 'Import' : undefined}>
        <span className="rs-import__plus" aria-hidden="true">+</span>
        <span><strong>Import</strong><small>{audio || docs.length === 0 ? 'Clips, folders, or drag and drop' : 'Files, folders, or drag and drop'}</small></span>
      </button>
      <button type="button" className="rs-import rs-import--secondary rs-import--folder" onClick={openFolderPicker} title={collapsed ? 'Import a folder' : undefined}>
        <span className="rs-import__plus rs-import__icon" aria-hidden="true"><IconFolderPlus /></span>
        <span><strong>Import a folder</strong></span>
      </button>
      {collapsed && (
        <button type="button" className="rs-rail-filters" aria-label={`Show filters${isFilterActive(filter) ? ' (filters on)' : ''}`} title="Filters" onClick={() => setCollapsed(false)}>
          <IconFunnel />{isFilterActive(filter) && <i aria-hidden="true" />}
        </button>
      )}
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

      {(audio || audioFilterActive) && <>
      {audioFilterActive && <button type="button" className="rs-show-more" onClick={() => setFilter({ bpmRange: null, musicKey: null, style: null, sounds: null })}>Clear audio filters</button>}
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
        <select className="rs-select" aria-label="Key" value={keyValue} disabled={!keys.length && selectedKey === null} onChange={e => setFilter({ musicKey: e.target.value || null })}>
          <option value="">Any key</option>
          {keyValue && !keys.includes(keyValue) && <option value={keyValue}>{keyValue} (saved filter)</option>}
          {keys.map(k => <option key={k} value={k}>{k}</option>)}
        </select>
      </section>

      <section className="rs-group">
        <h3>Genre</h3>
        <select className="rs-select" aria-label="Genre" value={filter.style ?? ''} disabled={!styles.length && filter.style === null} onChange={e => setFilter({ style: e.target.value || null })}>
          <option value="">Any genre</option>
          {filter.style && !styles.includes(filter.style) && <option value={filter.style}>{filter.style.replaceAll('_', ' ')} (saved filter)</option>}
          {styles.map(s => <option key={s} value={s}>{s.replaceAll('_', ' ')}</option>)}
        </select>
      </section>

      <section className="rs-group" aria-label="Sounds">
        <h3 title="Show clips with any of the picked sounds. Includes maybe and possible tags.">Sounds{pickedSounds.length > 1 ? ' (any of)' : ''}</h3>
        {soundRows.length ? (
          <ul className="rs-checks">
            {listedSounds.map(([tag, count]) => (
              <li key={tag}>
                <label>
                  <input type="checkbox" checked={pickedSounds.includes(tag)} onChange={() => toggleSound(tag)} />
                  <span className="rs-check" aria-hidden="true" />
                  {soundLabelText(tag)} <span className="rs-checks__count">{count}</span>
                </label>
              </li>
            ))}
          </ul>
        ) : <p className="rs-empty">No sounds identified yet</p>}
        {soundCounts.length > SOUNDS_SHOWN && (
          <button type="button" className="rs-show-more" aria-expanded={allSounds} onClick={() => setAllSounds(v => !v)}>
            {allSounds ? 'Show fewer' : `Show all ${soundCounts.length}`}
          </button>
        )}
      </section>
      </>}

      <section className="rs-group" aria-label="File type">
        <h3 title="Show files of any of the ticked types. Leave all off to show every type.">File type{pickedTypes.length > 1 ? ' (any of)' : ''}</h3>
        <ul className="rs-checks">
          {typeRows.map(([type, count]) => (
            <li key={type}>
              <label>
                <input type="checkbox" checked={pickedTypes.includes(type)} disabled={typeRows.length < 2 && !pickedTypes.includes(type)} onChange={() => toggleType(type)} />
                <span className="rs-check" aria-hidden="true" />
                {TYPE_LABEL[type] ?? type} <span className="rs-checks__count">{count}</span>
              </label>
            </li>
          ))}
        </ul>
      </section>
      <details className="rs-advanced">
        <summary>Advanced filters</summary>
        <Suspense fallback={null}><FilterBar embedded /></Suspense>
      </details>
    </aside>
  );
}

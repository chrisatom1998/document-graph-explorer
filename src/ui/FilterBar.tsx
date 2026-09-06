import { useEffect, useMemo, useRef, useState } from 'react';
import { useGraphStore } from '../store/graphStore';
import { hexFor } from '../scene/palette';
import type { EdgeKind, FileType } from '../model/types';
import { DEFAULT_FILTER, useUiStore } from '../store/uiStore';
import { isFilterActive, nodesMatchingFilter } from '../scene/emphasis';
import SnapshotDiffBanner from './SnapshotDiffBanner';
import { IconFunnel } from './icons';

const EDGE_KIND_ORDER: { kind: EdgeKind; label: string }[] = [
  { kind: 'reference', label: 'links' },
  { kind: 'semantic', label: 'similar' },
  { kind: 'keyword', label: 'keywords' },
  { kind: 'entity', label: 'entities' },
];

const RECENCY_OPTIONS: { days: number | null; label: string }[] = [
  { days: null, label: 'any time' },
  { days: 30, label: '30d' },
  { days: 90, label: '90d' },
  { days: 365, label: '1y' },
];

const FILE_TYPE_ORDER: FileType[] = [
  'md',
  'txt',
  'pdf',
  'html',
  'docx',
  'pptx',
  'xlsx',
  'json',
  'yaml',
  'csv',
  'code',
  'other',
];

/**
 * Collapsible panel below the toolbar for file-type / cluster / min-degree /
 * min-edge-weight filtering. Owns its own collapsed state — uiStore has no
 * filterOpen field by design, so this never needs to touch shared stores
 * beyond `filter` itself.
 */
export default function FilterBar() {
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const clusterNames = useGraphStore((s) => s.clusterNames);
  const localClusterNames = useGraphStore((s) => s.localClusterNames);
  const filter = useUiStore((s) => s.filter);
  const setFilter = useUiStore((s) => s.setFilter);

  const [collapsed, setCollapsed] = useState(true);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (collapsed) return;
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setCollapsed(true);
    };
    window.addEventListener('pointerdown', closeOutside);
    return () => window.removeEventListener('pointerdown', closeOutside);
  }, [collapsed]);
  const matchingCount = useMemo(() => {
    const matching = nodesMatchingFilter(nodes, edges, filter);
    return nodes.filter((node) => node.kind === 'document' && (!matching || matching.has(node.id))).length;
  }, [nodes, edges, filter]);

  const fileTypeCounts = useMemo(() => {
    const counts: Partial<Record<FileType, number>> = {};
    for (const n of nodes) {
      if (n.kind !== 'document') continue;
      counts[n.fileType] = (counts[n.fileType] ?? 0) + 1;
    }
    return counts;
  }, [nodes]);

  const clusterCounts = useMemo(() => {
    const counts = new Map<number, number>();
    for (const n of nodes) {
      if (n.kind !== 'document' || n.cluster < 0) continue;
      counts.set(n.cluster, (counts.get(n.cluster) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => a[0] - b[0]);
  }, [nodes]);

  if (nodes.length === 0) return null;

  const activeFileTypes = filter.fileTypes ?? [];
  const activeClusters = filter.clusters ?? [];

  const toggleFileType = (ft: FileType) => {
    const next = activeFileTypes.includes(ft)
      ? activeFileTypes.filter((x) => x !== ft)
      : [...activeFileTypes, ft];
    setFilter({ fileTypes: next.length > 0 ? next : null });
  };

  const toggleCluster = (c: number) => {
    const next = activeClusters.includes(c)
      ? activeClusters.filter((x) => x !== c)
      : [...activeClusters, c];
    setFilter({ clusters: next.length > 0 ? next : null });
  };

  const toggleKind = (kind: EdgeKind) => {
    const active = filter.edgeKinds ?? [];
    const next = active.includes(kind) ? active.filter((k) => k !== kind) : [...active, kind];
    setFilter({ edgeKinds: next.length > 0 ? next : null });
  };

  const hasActiveFilter = isFilterActive(filter);
  const advancedActive =
    filter.minDegree > 0 ||
    filter.minEdgeWeight > 0 ||
    filter.edgeKinds !== null ||
    filter.modifiedWithinDays !== null;
  const showAdvanced = advancedOpen || advancedActive;

  const clearAll = () => {
    setFilter({ ...DEFAULT_FILTER });
    setAdvancedOpen(false);
  };

  return (
    <>
      <SnapshotDiffBanner />
    <div className="filter-bar-layer" ref={rootRef} onKeyDown={(event) => {
      if (event.key === 'Escape' && !collapsed) {
        event.preventDefault();
        event.stopPropagation();
        setCollapsed(true);
        toggleRef.current?.focus();
      }
    }}>
      <div className="filter-bar__toggle-wrap">
        <button
          ref={toggleRef}
          type="button"
          className={`btn-icon filter-bar__toggle glass-panel${!collapsed || hasActiveFilter ? ' is-active' : ''}`}
          title={collapsed ? 'Show filters' : 'Hide filters'}
          aria-label={collapsed ? 'Show graph filters' : 'Hide graph filters'}
          aria-expanded={!collapsed}
          aria-controls="graph-filter-panel"
          aria-describedby={hasActiveFilter ? 'graph-filter-status' : undefined}
          onClick={() => setCollapsed((v) => !v)}
        >
          <IconFunnel />
          <span>Filters{hasActiveFilter ? ' · On' : ''}</span>
        </button>
      </div>

      {!collapsed && (
        <div className="filter-bar glass-panel" id="graph-filter-panel">
          <div className="filter-bar__heading">
            <strong>Refine your graph</strong>
            <span id="graph-filter-status" role="status">{matchingCount} {matchingCount === 1 ? 'document matches' : 'documents match'}</span>
          </div>
          {matchingCount === 0 && <p className="filter-bar__empty">No documents match. Clear filters or broaden your selection.</p>}
          <div className="filter-bar__group">
            <span className="filter-bar__group-label">Type</span>
            {FILE_TYPE_ORDER.filter((ft) => (fileTypeCounts[ft] ?? 0) > 0).map((ft) => (
              <button
                key={ft}
                type="button"
                className={`chip chip-selectable${
                  activeFileTypes.includes(ft) ? ' is-active' : ''
                }`}
                aria-pressed={activeFileTypes.includes(ft)}
                title={`Toggle ${ft} files on or off`}
                onClick={() => toggleFileType(ft)}
              >
                {ft} · {fileTypeCounts[ft]}
              </button>
            ))}
          </div>

          {clusterCounts.length > 0 && (
            <div className="filter-bar__group">
              <span className="filter-bar__group-label">Cluster</span>
              {clusterCounts.map(([c, count]) => (
                <button
                  key={c}
                  type="button"
                  className={`chip chip-selectable${
                    activeClusters.includes(c) ? ' is-active' : ''
                  }`}
                  aria-pressed={activeClusters.includes(c)}
                  title={`Toggle cluster: ${clusterNames[c] ?? localClusterNames[c] ?? `C${c}`}`}
                  onClick={() => toggleCluster(c)}
                >
                  <span
                    className="chip-dot"
                    style={{ background: hexFor(c) }}
                    aria-hidden="true"
                  />
                  {clusterNames[c] ?? localClusterNames[c] ?? `C${c}`} · {count}
                </button>
              ))}
            </div>
          )}

          {!showAdvanced && (
            <button
              type="button"
              className="filter-bar__more"
              title="Connection count, link strength, kind, and recency"
              aria-expanded={false}
              onClick={() => setAdvancedOpen(true)}
            >
              More filters
            </button>
          )}

          {showAdvanced && (
            <>
          <div className="filter-bar__group">
            <span
              className="filter-bar__group-label"
              title="Only show documents with at least this many connections to other documents. Slide right to focus on the most interconnected nodes."
            >
              Connections ≥
            </span>
            <div className="filter-bar__degree">
              <input
                type="range"
                min={0}
                max={10}
                step={1}
                value={filter.minDegree}
                aria-label="Minimum document connections"
                title={`Showing nodes with ${filter.minDegree}+ connections`}
                onChange={(e) => setFilter({ minDegree: Number(e.target.value) })}
              />
              <span className="filter-bar__degree-value">{filter.minDegree}</span>
            </div>
          </div>

          <div className="filter-bar__group">
            <span
              className="filter-bar__group-label"
              title="Hide weak links between documents. Slide right to only keep the strongest, most meaningful connections — helps declutter dense graphs."
            >
              Link Strength ≥
            </span>
            <div className="filter-bar__degree">
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={filter.minEdgeWeight}
                aria-label="Minimum link strength"
                title={`Hiding links weaker than ${Math.round(filter.minEdgeWeight * 100)}%`}
                onChange={(e) => setFilter({ minEdgeWeight: Number(e.target.value) })}
              />
              <span className="filter-bar__degree-value">{Math.round(filter.minEdgeWeight * 100)}%</span>
            </div>
          </div>

          <div className="filter-bar__group">
            <span className="filter-bar__group-label" title="Keep only connections of these kinds. Leave all off to show every kind.">
              Links
            </span>
            {EDGE_KIND_ORDER.map(({ kind, label }) => (
              <button
                key={kind}
                type="button"
                className={`chip chip-selectable${
                  (filter.edgeKinds ?? []).includes(kind) ? ' is-active' : ''
                }`}
                aria-pressed={(filter.edgeKinds ?? []).includes(kind)}
                title={`Toggle ${label} connections`}
                onClick={() => toggleKind(kind)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="filter-bar__group">
            <span className="filter-bar__group-label" title="Keep documents modified within this window. Files without a known date hide when a window is set.">
              Modified
            </span>
            {RECENCY_OPTIONS.map(({ days, label }) => (
              <button
                key={label}
                type="button"
                className={`chip chip-selectable${
                  (filter.modifiedWithinDays ?? null) === days ? ' is-active' : ''
                }`}
                aria-pressed={(filter.modifiedWithinDays ?? null) === days}
                title={days === null ? 'Show documents of any age' : `Show documents modified in the last ${label}`}
                onClick={() => setFilter({ modifiedWithinDays: days })}
              >
                {label}
              </button>
            ))}
          </div>
            {!advancedActive && (
              <button
                type="button"
                className="filter-bar__more"
                title="Hide connection, strength, kind, and recency filters"
                aria-expanded={true}
                onClick={() => setAdvancedOpen(false)}
              >
                Fewer filters
              </button>
            )}
            </>
          )}

          {hasActiveFilter && (
            <button
              type="button"
              className="filter-bar__clear"
              title="Reset all filters (file types, clusters, connection kinds, recency, and strength minimums)"
              onClick={clearAll}
            >
              Clear filters
            </button>
          )}
        </div>
      )}
      {collapsed && hasActiveFilter && (
        <div className="filter-bar__active-summary glass-panel">
          <span id="graph-filter-status" role="status">{matchingCount} {matchingCount === 1 ? 'document matches' : 'documents match'}</span>
          <button type="button" className="filter-bar__clear" onClick={clearAll}>Clear filters</button>
        </div>
      )}
    </div>
    </>
  );
}

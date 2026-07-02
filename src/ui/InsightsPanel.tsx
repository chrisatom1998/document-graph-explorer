/**
 * Corpus insights drawer (left side): orphaned docs, possible duplicates,
 * bridge documents. Each row focuses the node; each section has a highlight
 * toggle that feeds the ids into the scene's existing search-emphasis dimming
 * (uiStore.searchResults), so "show me these in the graph" costs nothing new.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  BRIDGE_MAX_PIVOTS,
  BRIDGE_MIN_SCORE,
  BRIDGE_TOP_N,
  DUP_SIM_THRESHOLD,
} from '../config';
import { computeBridges, computeOrphans } from '../graph/insights';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';

type SectionKey = 'orphans' | 'duplicates' | 'bridges';

export default function InsightsPanel() {
  const open = useUiStore((s) => s.insightsOpen);
  const setInsightsOpen = useUiStore((s) => s.setInsightsOpen);
  const setSelected = useUiStore((s) => s.setSelected);
  const setSearchResults = useUiStore((s) => s.setSearchResults);
  const sendCamera = useUiStore((s) => s.sendCamera);

  const nodes = useGraphStore((s) => s.nodes);
  const nodeIndex = useGraphStore((s) => s.nodeIndex);
  const edges = useGraphStore((s) => s.edges);
  const duplicatePairs = useGraphStore((s) => s.duplicatePairs);
  const phase = useGraphStore((s) => s.phase);

  const [highlighted, setHighlighted] = useState<SectionKey | null>(null);

  // The Escape ladder (App.tsx) can close the drawer from outside — it clears
  // the scene highlight itself, so just drop the stale section marker here.
  useEffect(() => {
    if (!open) setHighlighted(null);
  }, [open]);

  const insights = useMemo(() => {
    if (!open) return null; // betweenness is the only non-trivial cost — skip while closed
    return {
      orphans: computeOrphans(nodes, edges),
      duplicates: duplicatePairs,
      bridges: computeBridges(nodes, edges, {
        topN: BRIDGE_TOP_N,
        minScore: BRIDGE_MIN_SCORE,
        maxPivots: BRIDGE_MAX_PIVOTS,
      }),
    };
  }, [open, nodes, edges, duplicatePairs]);

  if (!open || !insights) return null;

  const titleOf = (id: string): string => nodes[nodeIndex[id]]?.title ?? id;

  const focusNode = (id: string): void => {
    setSelected(id);
    sendCamera('frameNode', [id]);
  };

  const toggleHighlight = (section: SectionKey, ids: string[]): void => {
    if (highlighted === section) {
      setHighlighted(null);
      setSearchResults(null);
    } else {
      setHighlighted(section);
      setSearchResults(ids);
    }
  };

  const close = (): void => {
    if (highlighted) setSearchResults(null);
    setHighlighted(null);
    setInsightsOpen(false);
  };

  const dupIds = [...new Set(insights.duplicates.flatMap((d) => [d.a, d.b]))];

  const section = (
    key: SectionKey,
    label: string,
    count: number,
    ids: string[],
    body: ReactNode,
  ) => (
    <div className="insights__section">
      <div className="insights__section-head">
        <p className="side-panel__section-label">
          {label} ({count})
        </p>
        {count > 0 && (
          <button
            type="button"
            className={`insights__highlight-btn${highlighted === key ? ' is-active' : ''}`}
            onClick={() => toggleHighlight(key, ids)}
          >
            {highlighted === key ? 'Clear' : 'Highlight'}
          </button>
        )}
      </div>
      {body}
    </div>
  );

  return (
    <div className="insights-layer">
      <div className="insights glass-panel">
        <div className="side-panel__header insights__header">
          <h2 className="side-panel__title">Corpus insights</h2>
          <button
            type="button"
            className="icon-btn-close"
            title="Close insights"
            aria-label="Close insights"
            onClick={close}
          >
            ✕
          </button>
        </div>
        <div className="insights__scroll">
          {phase !== 'ready' && (
            <p className="insights__hint">Still processing — results may be partial.</p>
          )}

          {section(
            'orphans',
            'Orphaned documents',
            insights.orphans.length,
            insights.orphans,
            insights.orphans.length === 0 ? (
              <p className="side-panel__summary is-fallback">
                None — every document is connected to something.
              </p>
            ) : (
              <>
                <p className="insights__hint">
                  Nothing references these and nothing resembles them — likely stale
                  or out-of-scope docs.
                </p>
                {insights.orphans.map((id) => (
                  <button
                    key={id}
                    type="button"
                    className="insights__row"
                    onClick={() => focusNode(id)}
                  >
                    {titleOf(id)}
                  </button>
                ))}
              </>
            ),
          )}

          <hr className="hairline" />

          {section(
            'duplicates',
            'Possible duplicates',
            insights.duplicates.length,
            dupIds,
            insights.duplicates.length === 0 ? (
              <p className="side-panel__summary is-fallback">No near-duplicate pairs found.</p>
            ) : (
              <>
                <p className="insights__hint">
                  Pairs with ≥{Math.round(DUP_SIM_THRESHOLD * 100)}% semantic similarity —
                  these might be the same doc.
                </p>
                {insights.duplicates.map((d) => (
                  <div className="insights__pair" key={`${d.a}|${d.b}`}>
                    <button type="button" className="insights__row" onClick={() => focusNode(d.a)}>
                      {titleOf(d.a)}
                    </button>
                    <span className="insights__pair-sim">
                      ≈ {(d.sim * 100).toFixed(1)}%
                    </span>
                    <button type="button" className="insights__row" onClick={() => focusNode(d.b)}>
                      {titleOf(d.b)}
                    </button>
                  </div>
                ))}
              </>
            ),
          )}

          <hr className="hairline" />

          {section(
            'bridges',
            'Bridge documents',
            insights.bridges.length,
            insights.bridges.map((b) => b.id),
            insights.bridges.length === 0 ? (
              <p className="side-panel__summary is-fallback">
                No strong bridges — the corpus has no single connector doc.
              </p>
            ) : (
              <>
                <p className="insights__hint">
                  Shortest paths between clusters run through these — either the most
                  important docs in the corpus, or the most confused.
                </p>
                {insights.bridges.map((b) => (
                  <div className="insights__bridge" key={b.id}>
                    <button type="button" className="insights__row" onClick={() => focusNode(b.id)}>
                      {titleOf(b.id)}
                    </button>
                    <div className="connection-row__weight-track">
                      <div
                        className="connection-row__weight-fill"
                        style={{ width: `${Math.round(Math.min(1, b.score * 2) * 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </>
            ),
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Corpus insights drawer (left side): orphaned docs, possible duplicates,
 * bridge documents, hub documents, cluster stats, stale documents. Each row
 * focuses the node (or frames the cluster); each section has a highlight
 * toggle that feeds the ids into the scene's existing search-emphasis
 * dimming (uiStore.searchResults), so "show me these in the graph" costs
 * nothing new.
 *
 * Cheap scans (orphans/duplicates/stale) stay synchronous; the heavy
 * analytics (betweenness bridges, hub ranking, cluster stats) run in the
 * dedicated insights worker so opening the panel never blocks the main
 * thread — those sections show "Analyzing…" until the worker answers.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { DUP_SIM_THRESHOLD, STALE_DOC_DAYS } from '../config';
import { computeOrphans, computeStaleDocs } from '../graph/insights';
import { requestInsights, type InsightsResult } from '../pipeline/insightsClient';
import { hexFor } from '../scene/palette';
import { annotationKey, useAnnotationStore } from '../store/annotationStore';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';
import { timeAgo } from '../util/relativeTime';
import { focusNode } from './focusNode';
import IngestReportSection from './IngestReportSection';

type SectionKey =
  | 'pinned'
  | 'orphans'
  | 'duplicates'
  | 'bridges'
  | 'hubs'
  | 'clusters'
  | 'stale';

const STALE_MONTHS = Math.round(STALE_DOC_DAYS / 30);

export default function InsightsPanel() {
  const open = useUiStore((s) => s.insightsOpen);
  const setInsightsOpen = useUiStore((s) => s.setInsightsOpen);
  const setSearchResults = useUiStore((s) => s.setSearchResults);
  const sendCamera = useUiStore((s) => s.sendCamera);
  const highlightOwner = useUiStore((s) => s.highlightOwner);

  const nodes = useGraphStore((s) => s.nodes);
  const nodeIndex = useGraphStore((s) => s.nodeIndex);
  const edges = useGraphStore((s) => s.edges);
  const duplicatePairs = useGraphStore((s) => s.duplicatePairs);
  const clusterNames = useGraphStore((s) => s.clusterNames);
  const localClusterNames = useGraphStore((s) => s.localClusterNames);
  const phase = useGraphStore((s) => s.phase);
  const annotations = useAnnotationStore((s) => s.annotations);

  const [highlighted, setHighlighted] = useState<SectionKey | null>(null);
  const [analysis, setAnalysis] = useState<InsightsResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const requestSeq = useRef(0);

  // The Escape ladder (App.tsx) can close the drawer from outside — it clears
  // the scene highlight itself, so just drop the stale section marker here.
  useEffect(() => {
    if (!open) setHighlighted(null);
  }, [open]);

  // If search or path mode takes over the shared highlight, our "Clear" button
  // would otherwise keep claiming a highlight we no longer own — drop it.
  useEffect(() => {
    if (highlightOwner !== 'insights') setHighlighted(null);
  }, [highlightOwner]);

  // Cheap synchronous scans only — O(nodes + edges) each. The expensive
  // analytics live in the worker request below.
  const insights = useMemo(() => {
    if (!open) return null; // skip all scanning while closed
    return {
      pinned: nodes.filter(
        (n) => n.kind === 'document' && annotations[annotationKey(n)]?.pinned,
      ),
      orphans: computeOrphans(nodes, edges),
      duplicates: duplicatePairs,
      stale: computeStaleDocs(nodes, Date.now(), STALE_DOC_DAYS),
    };
  }, [open, nodes, edges, duplicatePairs, annotations]);

  // Bridges / hubs / cluster stats arrive async from the insights worker.
  // Store churn while open (patchNodes/setEdges always produce new arrays)
  // re-requests; the requestSeq counter drops responses that a newer request
  // has already superseded (the SearchOverlay stale-guard idiom).
  useEffect(() => {
    if (!open) return;
    const seq = ++requestSeq.current;
    setAnalyzing(true);
    requestInsights(nodes, edges)
      .then((result) => {
        if (seq !== requestSeq.current) return; // stale response
        setAnalysis(result);
        setAnalyzing(false);
      })
      .catch((err: unknown) => {
        console.warn('insights analysis failed', err);
        if (seq !== requestSeq.current) return;
        setAnalysis(null);
        setAnalyzing(false);
      });
  }, [open, nodes, edges]);

  // Cluster membership for the Clusters section's frame/highlight actions —
  // a single cheap pass, main-thread-safe.
  const clusterMembers = useMemo(() => {
    if (!open) return new Map<number, string[]>();
    const members = new Map<number, string[]>();
    for (const n of nodes) {
      if (n.kind !== 'document' || n.cluster < 0) continue;
      const list = members.get(n.cluster);
      if (list) list.push(n.id);
      else members.set(n.cluster, [n.id]);
    }
    return members;
  }, [open, nodes]);

  if (!open || !insights) return null;

  const titleOf = (id: string): string => nodes[nodeIndex[id]]?.title ?? id;

  const toggleHighlight = (section: SectionKey, ids: string[]): void => {
    if (highlighted === section) {
      setHighlighted(null);
      setSearchResults(null);
    } else {
      setHighlighted(section);
      setSearchResults(ids, 'insights');
    }
  };

  const close = (): void => {
    if (highlighted) setSearchResults(null);
    setHighlighted(null);
    setInsightsOpen(false);
  };

  const dupIds = [...new Set(insights.duplicates.flatMap((d) => [d.a, d.b]))];

  // Worker-computed sections: keep showing the last result while a refresh
  // is in flight; only the very first computation gets the pending row.
  const pendingAnalysis = analysis === null && analyzing;
  const bridges = analysis?.bridges ?? [];
  const hubs = analysis?.hubs ?? [];
  const clusterStats = analysis?.clusterStats ?? [];
  const analyzingRow = <p className="insights__hint">Analyzing…</p>;

  const clusterName = (c: number): string =>
    clusterNames[c] ?? localClusterNames[c] ?? `Cluster ${c}`;

  // A pending section shows "(…)" and no highlight button — the ids aren't
  // known yet, so a highlight toggle would be a lie.
  const section = (
    key: SectionKey,
    label: string,
    count: number | null,
    ids: string[],
    body: ReactNode,
  ) => (
    <div className="insights__section">
      <div className="insights__section-head">
        <p className="side-panel__section-label">
          {label} ({count ?? '…'})
        </p>
        {count !== null && count > 0 && (
          <button
            type="button"
            className={`insights__highlight-btn${highlighted === key ? ' is-active' : ''}`}
            title={highlighted === key ? 'Clear this highlight from the graph' : 'Dim everything except these documents in the graph'}
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
      <div className="insights glass-panel" role="dialog" aria-label="Corpus insights">
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

          <IngestReportSection />

          {insights.pinned.length > 0 && (
            <>
              {section(
                'pinned',
                'Pinned documents',
                insights.pinned.length,
                insights.pinned.map((n) => n.id),
                <>
                  <p className="insights__hint">
                    Documents you starred from the side panel's Notes &amp; Tags.
                  </p>
                  {insights.pinned.map((n) => (
                    <button
                      key={n.id}
                      type="button"
                      className="insights__row"
                      title={`${n.title} — click to focus in the graph`}
                      onClick={() => focusNode(n.id)}
                    >
                      ★ {n.title}
                    </button>
                  ))}
                </>,
              )}
              <hr className="hairline" />
            </>
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
                    title={`${titleOf(id)} — click to focus in the graph`}
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
                    <button type="button" className="insights__row" title={`${titleOf(d.a)} — click to focus in the graph`} onClick={() => focusNode(d.a)}>
                      {titleOf(d.a)}
                    </button>
                    <span className="insights__pair-sim">
                      ≈ {(d.sim * 100).toFixed(1)}%
                    </span>
                    <button type="button" className="insights__row" title={`${titleOf(d.b)} — click to focus in the graph`} onClick={() => focusNode(d.b)}>
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
            pendingAnalysis ? null : bridges.length,
            bridges.map((b) => b.id),
            pendingAnalysis ? (
              analyzingRow
            ) : bridges.length === 0 ? (
              <p className="side-panel__summary is-fallback">
                No strong bridges — the corpus has no single connector doc.
              </p>
            ) : (
              <>
                <p className="insights__hint">
                  Shortest paths between clusters run through these — either the most
                  important docs in the corpus, or the most confused.
                </p>
                {bridges.map((b) => (
                  <div className="insights__bridge" key={b.id}>
                    <button type="button" className="insights__row" title={`${titleOf(b.id)} — click to focus in the graph`} onClick={() => focusNode(b.id)}>
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

          <hr className="hairline" />

          {section(
            'hubs',
            'Hub documents',
            pendingAnalysis ? null : hubs.length,
            hubs.map((h) => h.id),
            pendingAnalysis ? (
              analyzingRow
            ) : hubs.length === 0 ? (
              <p className="side-panel__summary is-fallback">
                No hubs yet — no document has direct connections.
              </p>
            ) : (
              <>
                <p className="insights__hint">
                  The most-connected documents by direct doc-to-doc links (topic
                  groupings don't count) — the corpus's reference points.
                </p>
                {hubs.map((h) => (
                  <button
                    key={h.id}
                    type="button"
                    className="insights__row"
                    title={`${titleOf(h.id)} — click to focus in the graph`}
                    onClick={() => focusNode(h.id)}
                  >
                    {titleOf(h.id)}
                    <span className="insights__pair-sim">
                      {h.docDegree} {h.docDegree === 1 ? 'connection' : 'connections'}
                    </span>
                  </button>
                ))}
              </>
            ),
          )}

          <hr className="hairline" />

          {section(
            'clusters',
            'Clusters',
            pendingAnalysis ? null : clusterStats.length,
            clusterStats.flatMap((c) => clusterMembers.get(c.cluster) ?? []),
            pendingAnalysis ? (
              analyzingRow
            ) : clusterStats.length === 0 ? (
              <p className="side-panel__summary is-fallback">
                No clusters yet — communities appear once documents connect.
              </p>
            ) : (
              <>
                <p className="insights__hint">
                  Detected communities: size, internal links, and the keywords
                  that set each one apart.
                </p>
                {clusterStats.map((c) => (
                  <button
                    key={c.cluster}
                    type="button"
                    className="insights__row"
                    title={`${clusterName(c.cluster)} — click to frame its documents in the graph`}
                    onClick={() => {
                      const members = clusterMembers.get(c.cluster);
                      if (members && members.length > 0) sendCamera('frameSet', members);
                    }}
                  >
                    <span
                      className="insights__dot"
                      style={{ background: hexFor(c.cluster) }}
                      aria-hidden="true"
                    />
                    {clusterName(c.cluster)}
                    <span className="insights__cluster-meta">
                      {c.docCount} {c.docCount === 1 ? 'doc' : 'docs'} · {c.internalEdges}{' '}
                      internal {c.internalEdges === 1 ? 'link' : 'links'}
                      {c.internalEdges > 0 && ` · avg weight ${(c.avgWeight * 100).toFixed(0)}%`}
                      {c.topKeywords.length > 0 && ` · ${c.topKeywords.join(', ')}`}
                    </span>
                  </button>
                ))}
              </>
            ),
          )}

          <hr className="hairline" />

          {section(
            'stale',
            'Stale documents',
            insights.stale.length,
            insights.stale.map((d) => d.id),
            insights.stale.length === 0 ? (
              <p className="side-panel__summary is-fallback">
                None — everything has been touched recently.
              </p>
            ) : (
              <>
                <p className="insights__hint">
                  Not modified in over {STALE_MONTHS} months — candidates for
                  review or archive.
                </p>
                {insights.stale.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    className="insights__row"
                    title={`${titleOf(d.id)} — click to focus in the graph`}
                    onClick={() => focusNode(d.id)}
                  >
                    {titleOf(d.id)}
                    <span className="insights__pair-sim">{timeAgo(d.lastModified)}</span>
                  </button>
                ))}
              </>
            ),
          )}
        </div>
      </div>
    </div>
  );
}

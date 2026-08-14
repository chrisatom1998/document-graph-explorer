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
import { nearestOrphanNeighbors } from '../graph/orphanNeighbors';
import { requestInsights, type InsightsResult } from '../pipeline/insightsClient';
import { hexFor } from '../scene/palette';
import {
  annotationKey,
  ensureAnnotationsLoaded,
  useAnnotationStore,
} from '../store/annotationStore';
import { useCorpusStore } from '../store/corpusStore';
import { useGraphStore } from '../store/graphStore';
import { docVectorStore } from '../store/runtimeStores';
import { useUiStore } from '../store/uiStore';
import { timeAgo } from '../util/relativeTime';
import { addTagToDocuments, documentsAlreadyTagged, DUPLICATE_TAG } from './insightActions';
import { focusNode } from './focusNode';
import IngestReportSection from './IngestReportSection';
import CloseButton from './CloseButton';

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
  const insightsFocus = useUiStore((s) => s.insightsFocus);
  const corpusId = useCorpusStore((s) => s.activeCorpusId);
  const corpusMode = useCorpusStore((s) => s.mode);
  const annotationScope = useAnnotationStore((s) => s.scope);
  const canTag = corpusMode === 'local' && Boolean(corpusId) && annotationScope === corpusId;

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
  const [analysisFailed, setAnalysisFailed] = useState(false);
  const requestSeq = useRef(0);

  useEffect(() => {
    if (!open || corpusMode !== 'local' || !corpusId) return;
    void ensureAnnotationsLoaded(corpusId);
  }, [open, corpusMode, corpusId]);

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
  // re-requests; the client coalesces to the latest request, and the
  // requestSeq counter drops responses that a newer request has already
  // superseded (the SearchOverlay stale-guard idiom).
  useEffect(() => {
    if (!open) return;
    const seq = ++requestSeq.current;
    setAnalyzing(true);
    requestInsights(nodes, edges)
      .then((result) => {
        if (seq !== requestSeq.current) return; // stale response
        setAnalysis(result);
        setAnalysisFailed(false);
        setAnalyzing(false);
      })
      .catch((err: unknown) => {
        if (seq !== requestSeq.current) return; // superseded by a newer request
        console.warn('insights analysis failed', err);
        // Keep the last good result; flag the failure so an absent result
        // isn't rendered as a successfully computed empty analysis.
        setAnalysisFailed(true);
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

  const orphanNeighbors = useMemo(() => {
    if (!open) return new Map<string, { neighborId: string; sim: number }>();
    const orphans = computeOrphans(nodes, edges);
    if (orphans.length === 0) return new Map();
    const docIds = nodes.filter((n) => n.kind === 'document').map((n) => n.id);
    const hints = nearestOrphanNeighbors(orphans, docVectorStore, docIds);
    return new Map(hints.map((h) => [h.orphanId, { neighborId: h.neighborId, sim: h.sim }]));
  }, [open, nodes, edges]);

  // Jump links (digest card, etc.) open this drawer on a section. Apply the
  // highlight once, then drop the focus so later graph churn doesn't steal
  // a highlight the user already cleared.
  useEffect(() => {
    if (!open || !insightsFocus) return;
    const orphans = computeOrphans(nodes, edges);
    const stale = computeStaleDocs(nodes, Date.now(), STALE_DOC_DAYS);
    const dupIds = [...new Set(duplicatePairs.flatMap((d) => [d.a, d.b]))];
    const clusterIds = [...clusterMembers.values()].flat();
    const ids =
      insightsFocus === 'orphans'
        ? orphans
        : insightsFocus === 'duplicates'
          ? dupIds
          : insightsFocus === 'stale'
            ? stale.map((d) => d.id)
            : clusterIds;
    if (ids.length > 0) {
      setHighlighted(insightsFocus);
      setSearchResults(ids, 'insights');
    }
    const sectionId = insightsFocus;
    useUiStore.getState().setInsightsFocus(null);
    requestAnimationFrame(() => {
      document.getElementById(`insights-section-${sectionId}`)?.scrollIntoView({ block: 'nearest' });
    });
  }, [open, insightsFocus, nodes, edges, duplicatePairs, clusterMembers, setSearchResults]);

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

  const showInGraph = (section: SectionKey, ids: string[]): void => {
    setHighlighted(section);
    setSearchResults(ids, 'insights');
    sendCamera('frameSet', ids);
  };

  const tagDuplicatePair = (a: string, b: string): void => {
    const tagged = addTagToDocuments(nodes, [a, b], DUPLICATE_TAG);
    if (tagged === 0) return;
    useUiStore
      .getState()
      .pushToast(tagged === 2 ? 'Tagged both as duplicate.' : 'Tagged as duplicate.', 'info');
  };

  const close = (): void => {
    if (highlighted) setSearchResults(null);
    setHighlighted(null);
    setInsightsOpen(false);
  };

  const dupIds = [...new Set(insights.duplicates.flatMap((d) => [d.a, d.b]))];

  // Worker-computed sections: keep showing the last result while a refresh
  // is in flight; only the very first computation gets the pending row. A
  // failure with no result to fall back on gets its own row so it can't be
  // mistaken for a corpus with no bridges/hubs/clusters.
  const pendingAnalysis = analysis === null && analyzing;
  const failedAnalysis = analysis === null && !analyzing && analysisFailed;
  const bridges = analysis?.bridges ?? [];
  const hubs = analysis?.hubs ?? [];
  const clusterStats = analysis?.clusterStats ?? [];
  const analyzingRow = <p className="insights__hint">Analyzing…</p>;
  const failedRow = (
    <p className="side-panel__summary is-fallback">
      Analysis didn't complete — close and reopen this panel to retry.
    </p>
  );

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
    <div className="insights__section" id={`insights-section-${key}`}>
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
          <CloseButton
            title="Close insights"
            aria-label="Close insights"
            onClick={close}
          />
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
                  Nothing references these and nothing resembles them strongly enough
                  to form a link — likely stale or out-of-scope docs. Suggested
                  neighbors below the connection threshold still show here.
                </p>
                {insights.orphans.map((id) => {
                  const neighbor = orphanNeighbors.get(id);
                  return (
                    <div className="insights__orphan" key={id}>
                      <button
                        type="button"
                        className="insights__row"
                        title={`${titleOf(id)} — click to focus in the graph`}
                        onClick={() => focusNode(id)}
                      >
                        {titleOf(id)}
                      </button>
                      {neighbor && (
                        <div className="insights__row-actions">
                          <button
                            type="button"
                            className="insights__action"
                            title={`Not connected, but ${(neighbor.sim * 100).toFixed(0)}% similar to ${titleOf(neighbor.neighborId)}`}
                            onClick={() => focusNode(neighbor.neighborId)}
                          >
                            not connected, but {(neighbor.sim * 100).toFixed(0)}% similar to{' '}
                            {titleOf(neighbor.neighborId)}
                          </button>
                          <button
                            type="button"
                            className="insights__action"
                            title="Highlight this document and its closest neighbor in the graph"
                            onClick={() => showInGraph('orphans', [id, neighbor.neighborId])}
                          >
                            Show both
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
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
                {insights.duplicates.map((d) => {
                  const alreadyTagged = documentsAlreadyTagged(nodes, [d.a, d.b], DUPLICATE_TAG);
                  return (
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
                      <div className="insights__row-actions">
                        <button
                          type="button"
                          className="insights__action"
                          title="Highlight both documents and frame them in the graph"
                          onClick={() => showInGraph('duplicates', [d.a, d.b])}
                        >
                          Show both
                        </button>
                        {canTag && (
                          <button
                            type="button"
                            className="insights__action"
                            title={
                              alreadyTagged
                                ? 'Both documents already have the duplicate tag'
                                : 'Add a duplicate tag to both documents'
                            }
                            disabled={alreadyTagged}
                            onClick={() => tagDuplicatePair(d.a, d.b)}
                          >
                            {alreadyTagged ? 'Tagged duplicate' : 'Tag both duplicate'}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </>
            ),
          )}

          <hr className="hairline" />

          {section(
            'bridges',
            'Bridge documents',
            pendingAnalysis || failedAnalysis ? null : bridges.length,
            bridges.map((b) => b.id),
            pendingAnalysis ? (
              analyzingRow
            ) : failedAnalysis ? (
              failedRow
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
            pendingAnalysis || failedAnalysis ? null : hubs.length,
            hubs.map((h) => h.id),
            pendingAnalysis ? (
              analyzingRow
            ) : failedAnalysis ? (
              failedRow
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
            pendingAnalysis || failedAnalysis ? null : clusterStats.length,
            clusterStats.flatMap((c) => clusterMembers.get(c.cluster) ?? []),
            pendingAnalysis ? (
              analyzingRow
            ) : failedAnalysis ? (
              failedRow
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

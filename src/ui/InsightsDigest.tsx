/**
 * One-shot "what we found" card after ingest reaches ready. Lives in the
 * same corner as the Insights drawer so a jump link opens the panel in
 * place — no new toolbar chrome.
 *
 * The pipeline emits an explicit success counter after persistence completes,
 * so cancelled/failed runs cannot masquerade as completed ingests. The
 * subscriber keeps at most one pending digest for a late-mounted card.
 */

import { useEffect, useState } from 'react';
import {
  shouldOfferInsightsDigest,
  summarizeInsights,
  formatInsightsDigest,
  type InsightsDigest as Digest,
} from '../graph/insightsDigest';
import { useGraphStore } from '../store/graphStore';
import { useUiStore, type InsightsFocus } from '../store/uiStore';
import { openInsights } from './openInsights';
import CloseButton from './CloseButton';

let pending: Digest | null = null;
const listeners = new Set<(digest: Digest) => void>();

useGraphStore.subscribe((state, previous) => {
  if (state.successfulIngestCount === previous.successfulIngestCount) return;
  const next = summarizeInsights(state.nodes, state.edges, state.duplicatePairs);
  if (!shouldOfferInsightsDigest(next)) {
    pending = null;
    return;
  }
  if (listeners.size === 0) {
    pending = next;
    return;
  }
  pending = null;
  for (const listener of listeners) listener(next);
});

function subscribeDigest(listener: (digest: Digest) => void): () => void {
  listeners.add(listener);
  if (pending) {
    const digest = pending;
    pending = null;
    listener(digest);
  }
  return () => {
    listeners.delete(listener);
  };
}

/** Test seam: drop a leftover pending card between cases. */
export function _resetInsightsDigestForTests(): void {
  pending = null;
  listeners.clear();
}

export default function InsightsDigest() {
  const phase = useGraphStore((s) => s.phase);
  const hasNodes = useGraphStore((s) => s.nodes.length > 0);
  const insightsOpen = useUiStore((s) => s.insightsOpen);
  const [digest, setDigest] = useState<Digest | null>(null);

  useEffect(() => subscribeDigest(setDigest), []);

  useEffect(() => {
    if (!hasNodes || phase !== 'ready' || insightsOpen) setDigest(null);
  }, [hasNodes, phase, insightsOpen]);

  if (!digest || insightsOpen || phase !== 'ready') return null;

  const jump = (focus: InsightsFocus, ids?: string[]): void => {
    openInsights(focus, ids);
    setDigest(null);
  };

  return (
    <div className="insights-digest-layer">
      <aside className="insights-digest glass-panel" role="status" aria-label="What we found">
        <div className="insights-digest__head">
          <p className="insights-digest__eyebrow">What we found</p>
          <CloseButton
            title="Dismiss findings"
            aria-label="Dismiss findings"
            onClick={() => setDigest(null)}
          />
        </div>
        <p className="insights-digest__summary">{formatInsightsDigest(digest)}</p>
        <div className="insights-digest__jumps">
          {digest.clusterCount > 1 && (
            <button
              type="button"
              className="insights-digest__jump"
              title="Open insights and review detected clusters"
              onClick={() => jump('clusters')}
            >
              {digest.clusterCount} clusters
            </button>
          )}
          {digest.orphanCount > 0 && (
            <button
              type="button"
              className="insights-digest__jump"
              title="Open insights and highlight isolated documents"
              onClick={() => jump('orphans', digest.orphanIds)}
            >
              {digest.orphanCount} {digest.orphanCount === 1 ? 'orphan' : 'orphans'}
            </button>
          )}
          {digest.duplicateCount > 0 && (
            <button
              type="button"
              className="insights-digest__jump"
              title="Open insights and highlight near-duplicate pairs"
              onClick={() => jump('duplicates', digest.duplicateIds)}
            >
              {digest.duplicateCount} near-{digest.duplicateCount === 1 ? 'duplicate' : 'duplicates'}
            </button>
          )}
          {digest.staleCount > 0 && (
            <button
              type="button"
              className="insights-digest__jump"
              title="Open insights and highlight documents not modified in over six months"
              onClick={() => jump('stale', digest.staleIds)}
            >
              {digest.staleCount} stale
            </button>
          )}
          <button
            type="button"
            className="insights-digest__jump insights-digest__jump--primary"
            title="Open the Insights panel"
            onClick={() => {
              openInsights();
              setDigest(null);
            }}
          >
            Review insights
          </button>
        </div>
      </aside>
    </div>
  );
}

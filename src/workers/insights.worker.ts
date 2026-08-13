/**
 * Insights worker — the panel's heavy corpus analytics off the main thread:
 * betweenness-centrality bridges (Brandes is O(pivots · E) — the one insight
 * that visibly janks the UI at corpus scale), hub ranking, and per-cluster
 * stats. Dedicated worker rather than the aggregator: that one is a single
 * serialized instance shared with ingest, and a slow betweenness job there
 * would block the next drop's lexical/semantic passes.
 *
 * Stateless request/response — each message carries the full (slimmed)
 * graph, so a respawned worker needs no warm-up.
 */

import {
  BRIDGE_MAX_PIVOTS,
  BRIDGE_MIN_SCORE,
  BRIDGE_TOP_N,
  HUB_TOP_N,
} from '../config';
import { computeClusterStats } from '../graph/clusterStats';
import { computeBridges, computeHubs } from '../graph/insights';
import type { InsightsRequest, InsightsResponse } from '../model/types';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (ev: MessageEvent<InsightsRequest>) => {
  const req = ev.data;
  try {
    ctx.postMessage({
      requestId: req.requestId,
      type: 'insights:done',
      bridges: computeBridges(req.nodes, req.edges, {
        topN: BRIDGE_TOP_N,
        minScore: BRIDGE_MIN_SCORE,
        maxPivots: BRIDGE_MAX_PIVOTS,
      }),
      hubs: computeHubs(req.nodes, req.edges, HUB_TOP_N),
      clusterStats: computeClusterStats(req.nodes, req.edges),
    } satisfies InsightsResponse);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    ctx.postMessage({
      requestId: req.requestId,
      type: 'error',
      message,
    } satisfies InsightsResponse);
  }
};

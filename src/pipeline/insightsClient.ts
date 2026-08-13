/**
 * RPC client for the insights worker, adapted from the coordinator's
 * aggregator-client pattern: lazy spawn on first request, requestId
 * correlation, and on any crash / undecodable message / timeout the worker
 * is discarded (terminated) so the next post respawns a clean one. The
 * worker is stateless per-request, so a respawn costs nothing but the
 * module load.
 *
 * Unlike the aggregator — whose callers serialize runs, so at most one
 * request is ever in flight — the insights panel fires a request on every
 * store update while open. This client therefore serializes them itself:
 * one request runs at a time, its timeout is armed only while it is
 * actually running (a busy worker can't time out work it hasn't started),
 * and at most one newer request waits behind it. An even newer graph
 * supersedes the waiting one, so obsolete Brandes passes are never computed.
 */

import type { DocNode, Edge, InsightsRequest, InsightsResponse } from '../model/types';

/** The insights worker's successful payload, minus the correlation id. */
export type InsightsResult = Omit<
  Extract<InsightsResponse, { type: 'insights:done' }>,
  'requestId' | 'type'
>;

// Betweenness is the dominant cost and grows with corpus size, so the budget
// scales like the aggregator's: fixed base for worker boot + per-doc term for
// the analysis, capped so a genuinely wedged worker can't pend forever.
const BASE_TIMEOUT_MS = 30_000;
const PER_DOC_TIMEOUT_MS = 30;
const MAX_TIMEOUT_MS = 120_000;

interface PendingRequest {
  request: InsightsRequest;
  resolve: (result: InsightsResult) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

let worker: Worker | null = null;
let nextRequestId = 1;
let inFlight: PendingRequest | null = null;
let queued: PendingRequest | null = null;

/**
 * Reject the running request and drop the worker so the next post respawns
 * a clean one — after a crash or timeout its state can't be trusted. The
 * queued request (if any) never reached the bad worker, so it still runs.
 */
function discardWorker(error: Error): void {
  const failed = inFlight;
  inFlight = null;
  if (failed) {
    if (failed.timer !== null) clearTimeout(failed.timer);
    failed.reject(error);
  }
  worker?.terminate();
  worker = null;
  postNext();
}

/**
 * Post the queued request if the worker is idle. The timeout starts here —
 * at run start, not at enqueue — so it measures the job itself and a slow
 * predecessor can't burn a waiting request's budget.
 */
function postNext(): void {
  if (inFlight || !queued) return;
  const entry = queued;
  queued = null;
  inFlight = entry;
  const timeoutMs = Math.min(
    MAX_TIMEOUT_MS,
    BASE_TIMEOUT_MS + PER_DOC_TIMEOUT_MS * entry.request.nodes.length,
  );
  entry.timer = setTimeout(() => {
    if (inFlight !== entry) return;
    discardWorker(new Error(`insights analysis timed out after ${timeoutMs}ms`));
  }, timeoutMs);
  ensureWorker().postMessage(entry.request);
}

function ensureWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('../workers/insights.worker.ts', import.meta.url), {
    type: 'module',
  });
  worker.onmessage = (ev: MessageEvent<InsightsResponse>) => {
    const msg = ev.data;
    const entry = inFlight;
    if (!entry || entry.request.requestId !== msg.requestId) return;
    inFlight = null;
    if (entry.timer !== null) clearTimeout(entry.timer);
    if (msg.type === 'error') entry.reject(new Error(msg.message));
    else entry.resolve({ bridges: msg.bridges, hubs: msg.hubs, clusterStats: msg.clusterStats });
    postNext();
  };
  worker.onerror = (ev: ErrorEvent) => {
    discardWorker(new Error(ev.message || 'insights worker crashed'));
  };
  worker.onmessageerror = () => {
    discardWorker(new Error('insights worker sent an undecodable message'));
  };
  return worker;
}

/**
 * Compute bridges / hubs / cluster stats off the main thread. Nodes and
 * edges are slimmed to exactly what the pure functions read before they
 * cross the postMessage boundary — titles, summaries, and evidence strings
 * would dominate the structured-clone cost for zero analytical value.
 */
export function requestInsights(nodes: DocNode[], edges: Edge[]): Promise<InsightsResult> {
  const request: InsightsRequest = {
    requestId: nextRequestId++,
    type: 'insights',
    nodes: nodes.map((n) => ({
      id: n.id,
      kind: n.kind,
      cluster: n.cluster,
      keywords: n.keywords,
    })),
    edges: edges.map((e) => ({
      source: e.source,
      target: e.target,
      weight: e.weight,
      kind: e.kind,
    })),
  };
  return new Promise<InsightsResult>((resolve, reject) => {
    // Latest-only coalescing: a newer graph makes the waiting request
    // obsolete, so replace (and reject) it rather than queueing behind it.
    queued?.reject(new Error('insights request superseded by a newer one'));
    queued = { request, resolve, reject, timer: null };
    postNext();
  });
}

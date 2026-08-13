/**
 * RPC client for the insights worker, cloned from the coordinator's
 * aggregator-client pattern: lazy spawn on first request, requestId
 * correlation, and on any crash / undecodable message / timeout the worker
 * is discarded (reject everything in flight, terminate) so the next request
 * respawns a clean one. The worker is stateless per-request, so a respawn
 * costs nothing but the module load.
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

let worker: Worker | null = null;
let nextRequestId = 1;
const pending = new Map<
  number,
  {
    resolve: (result: InsightsResult) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();

/**
 * Reject everything in flight and drop the worker so the next request
 * respawns a clean one — after a crash or timeout its state can't be trusted.
 */
function discardWorker(error: Error): void {
  for (const [id, entry] of [...pending]) {
    pending.delete(id);
    clearTimeout(entry.timer);
    entry.reject(error);
  }
  worker?.terminate();
  worker = null;
}

function ensureWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('../workers/insights.worker.ts', import.meta.url), {
    type: 'module',
  });
  worker.onmessage = (ev: MessageEvent<InsightsResponse>) => {
    const msg = ev.data;
    const entry = pending.get(msg.requestId);
    if (!entry) return;
    pending.delete(msg.requestId);
    clearTimeout(entry.timer);
    if (msg.type === 'error') entry.reject(new Error(msg.message));
    else entry.resolve({ bridges: msg.bridges, hubs: msg.hubs, clusterStats: msg.clusterStats });
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
  const docCount = nodes.length;
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
    const timeoutMs = Math.min(
      MAX_TIMEOUT_MS,
      BASE_TIMEOUT_MS + PER_DOC_TIMEOUT_MS * docCount,
    );
    const timer = setTimeout(() => {
      if (!pending.has(request.requestId)) return;
      discardWorker(new Error(`insights analysis timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    pending.set(request.requestId, { resolve, reject, timer });
    ensureWorker().postMessage(request);
  });
}

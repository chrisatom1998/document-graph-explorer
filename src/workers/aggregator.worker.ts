/**
 * Aggregator worker — corpus-wide passes that need the whole corpus at
 * once: lexical (TF-IDF keywords, keyword edges, reference edges,
 * boilerplate detection) and semantic (mutual-top-k similarity edges +
 * Louvain community clustering). Single dedicated instance owned by the
 * coordinator.
 */

import type { AggRequest } from '../model/types';
import { dispatchAggregatorRequest } from './aggregatorHandlers';

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = (ev: MessageEvent<AggRequest>) => {
  void dispatchAggregatorRequest(ev.data, (msg) => {
    self.postMessage(msg);
  });
};

import { percentile } from './core.mjs';

/** Sum of (cold first request − warm median) per worker kind.
 * Kinds that never repeat on a warm clip are omitted. A positive total is
 * serialized model-load overhead: this host keeps one music worker, so the
 * families do not overlap. Returns null when nothing can be compared. */
export function coldModelLoadExcess(coldRequests, warmRequests) {
  const warmByKind = new Map();
  for (const request of warmRequests) {
    if (request.failed || !Number.isFinite(request.ms)) continue;
    const list = warmByKind.get(request.kind) ?? [];
    list.push(request.ms);
    warmByKind.set(request.kind, list);
  }
  const seen = new Set();
  let excess = 0;
  let kinds = 0;
  for (const request of coldRequests) {
    if (seen.has(request.kind) || request.failed || !Number.isFinite(request.ms)) continue;
    seen.add(request.kind);
    const warm = warmByKind.get(request.kind);
    if (!warm?.length) continue;
    excess += Math.max(0, request.ms - percentile(warm, 0.5));
    kinds++;
  }
  return kinds ? excess : null;
}

/** Wall clock of overlapping preload (`kind: "warm"`) requests, when the app sent any. */
export function preloadWallMs(warmSpans) {
  if (!warmSpans?.length) return null;
  const start = Math.min(...warmSpans.map(span => span.start));
  const end = Math.max(...warmSpans.map(span => span.end));
  return end - start;
}

export function summarizeMethod(method, clips) {
  const cold = clips.find(clip => clip.role === 'cold') ?? null;
  const warm = clips.filter(clip => clip.role === 'warm');
  const tagged = warm.filter(clip => clip.tagged && Number.isFinite(clip.tagMs));
  const times = tagged.map(clip => clip.tagMs);
  const warmRequests = warm.flatMap(clip => clip.requests ?? []);
  const preload = preloadWallMs(cold?.warmSpans);
  const excess = coldModelLoadExcess(cold?.requests ?? [], warmRequests);
  const reliable = Boolean(cold?.tagged) && warm.length > 0 && warm.every(clip => clip.tagged)
    && clips.every(clip => !clip.pageErrors?.length && !clip.failed);
  const mean = times.length ? times.reduce((sum, ms) => sum + ms, 0) / times.length : null;
  return {
    method,
    reliable,
    coldModelLoadMs: preload ?? excess,
    coldModelLoadMethod: preload != null ? 'preload-wall' : excess != null ? 'first-request-excess' : 'unavailable',
    coldTagMs: cold?.tagMs ?? null,
    warmCount: warm.length,
    warmTagged: tagged.length,
    warmMedianMs: percentile(times, 0.5),
    warmP95Ms: percentile(times, 0.95),
    warmClipsPerSecond: mean ? 1000 / mean : null,
    p95Note: tagged.length >= 20 ? null : 'Small sample: observed percentile, not a stable population p95',
  };
}

/** Lowest warm median among methods whose every clip produced a tag and no page error. */
export function fastestReliable(summaries) {
  const ready = summaries.filter(summary => summary.reliable && Number.isFinite(summary.warmMedianMs));
  ready.sort((a, b) => a.warmMedianMs - b.warmMedianMs
    || (b.warmClipsPerSecond ?? 0) - (a.warmClipsPerSecond ?? 0)
    || a.method.localeCompare(b.method));
  return ready[0] ?? null;
}

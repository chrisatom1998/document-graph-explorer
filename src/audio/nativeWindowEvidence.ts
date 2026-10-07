import type { Interval } from './recognition';

/** Separate from the three listenable examples: these scores establish what can survive a partial tagger veto. */
export const NATIVE_WINDOW_EVIDENCE_LIMIT = 128;
export interface NativeScoredWindow extends Interval { score: number }
export interface NativeWindowEvidence {
  windows: NativeScoredWindow[];
  /** False means other scored windows were omitted or an aggregate had no window provenance. */
  complete: boolean;
  /** Full-mix heads retain raw probabilities and their existing aggregation/display rule; other scores use max. */
  aggregation?: { top: number; threshold: number };
}
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
export function appendNativeWindow(evidence: NativeWindowEvidence, window: NativeScoredWindow): void {
  if (evidence.windows.length < NATIVE_WINDOW_EVIDENCE_LIMIT) evidence.windows.push({ ...window });
  else evidence.complete = false;
}
export function sanitizeNativeWindowEvidence(raw: unknown, duration = 86400): NativeWindowEvidence | undefined {
  const e = raw as Partial<NativeWindowEvidence> | undefined;
  if (!e || typeof e.complete !== 'boolean' || !Array.isArray(e.windows) || !e.windows.length) return;
  const windows: NativeScoredWindow[] = [];
  for (const w of e.windows.slice(0, NATIVE_WINDOW_EVIDENCE_LIMIT)) {
    if (!w || !finite(w.start) || !finite(w.end) || w.start < 0 || w.end <= w.start || w.end > duration + 1e-6
      || !finite(w.score) || w.score < 0 || w.score > 1) return;
    windows.push({ start: w.start, end: w.end, score: w.score });
  }
  const out: NativeWindowEvidence = { windows, complete: e.complete && e.windows.length <= NATIVE_WINDOW_EVIDENCE_LIMIT };
  if (e.aggregation !== undefined) {
    if (!e.aggregation || typeof e.aggregation !== 'object' || Array.isArray(e.aggregation)) return;
    const { top, threshold } = e.aggregation;
    if (!finite(top) || !Number.isInteger(top) || top < 1 || top > 50 || !finite(threshold) || threshold <= 0 || threshold >= 1) return;
    out.aggregation = { top, threshold };
  }
  return out;
}
/** A numerical result uses only recorded outside windows. Incomplete legacy evidence can preserve a possible
 * label, but never lends its recording-wide peak to an unheard section. */
export function nativeScoreOutside(evidence: NativeWindowEvidence | undefined, covered: (interval: Interval) => boolean): { score?: number; unknown: boolean } {
  if (!evidence?.windows.length) return { unknown: true };
  const outside = evidence.windows.filter(w => !covered(w)).map(w => w.score);
  if (!outside.length) return { unknown: !evidence.complete };
  let score = Math.max(...outside);
  if (evidence.aggregation) {
    const { top, threshold } = evidence.aggregation;
    // If the bounded record omitted windows, a single high window is not necessarily the top-N mean:
    // unseen weaker windows could still be needed to fill N and lower it.
    if (!evidence.complete && outside.length < top) return { unknown: true };
    const strongest = outside.sort((a, b) => b - a).slice(0, top);
    const mean = strongest.reduce((sum, value) => sum + value, 0) / strongest.length;
    score = mean >= threshold ? Math.round((.5 + .5 * (mean - threshold) / (1 - threshold)) * 1e4) / 1e4 : 0;
  }
  return { score, unknown: !evidence.complete };
}

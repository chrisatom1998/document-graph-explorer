import { INSTRUMENT_PARENTS, isBroadInstrument } from './instrumentLabels';
import type { InstrumentEstimate, MusicAnalysis } from './musicTypes';

export const INSTRUMENT_WINDOW_SECONDS = 10;
export const INSTRUMENT_HOP_SECONDS = 5;

/** Full coverage, including the tail; no padded sliver counted as another observation. */
export function instrumentWindowStarts(duration: number): number[] {
  if (!Number.isFinite(duration) || duration <= 0) return [];
  if (duration <= INSTRUMENT_WINDOW_SECONDS) return [0];
  const last = duration - INSTRUMENT_WINDOW_SECONDS;
  const starts: number[] = [];
  for (let start = 0; start <= last; start += INSTRUMENT_HOP_SECONDS) starts.push(start);
  if (last > starts[starts.length - 1]) starts.push(last);
  return starts;
}

type Evidence = { peak: number; strong: number; possible: number; lastStrong: number; lastPossible: number; segments: NonNullable<InstrumentEstimate['segments']> };
export class InstrumentEvidence {
  private evidence = new Map<string, Evidence>();
  private suggestion: InstrumentEstimate | undefined;
  add(scores: Record<string, number>, start: number, end: number, musicScore = 0): void {
    // A dominant weak candidate is useful to a listener, but is not evidence
    // for automatic links. Require music context and compare all instruments,
    // including families, so an ambiguous ranking does not produce a guess.
    if (musicScore >= 0.5) {
      const ranked = Object.entries(scores).filter(([, score]) => Number.isFinite(score) && score >= 0 && score <= 1).sort((a, b) => b[1] - a[1]);
      const top = ranked[0];
      if (top && !isBroadInstrument(top[0]) && top[1] >= 0.1 && top[1] >= 3 * (ranked[1]?.[1] ?? 0) && top[1] > (this.suggestion?.score ?? 0)) {
        this.suggestion = { label: top[0], score: top[1], status: 'possible', windows: 1, segments: [{ start, end, score: top[1] }] };
      }
    }
    for (const [label, score] of Object.entries(scores)) {
      if (!Number.isFinite(score) || score < 0.35 || score > 1) continue;
      const item = this.evidence.get(label) ?? { peak: 0, strong: 0, possible: 0, lastStrong: -Infinity, lastPossible: -Infinity, segments: [] };
      item.peak = Math.max(item.peak, score);
      if (start - item.lastPossible >= INSTRUMENT_HOP_SECONDS - 0.05) { item.possible++; item.lastPossible = start; }
      if (score >= 0.6 && start - item.lastStrong >= INSTRUMENT_HOP_SECONDS - 0.05) { item.strong++; item.lastStrong = start; }
      // Preserve the strongest listenable examples, bounded even for a long recording.
      item.segments.push({ start, end, score });
      item.segments.sort((a, b) => b.score - a.score || a.start - b.start);
      item.segments.length = Math.min(item.segments.length, 5);
      this.evidence.set(label, item);
    }
  }
  results(): InstrumentEstimate[] {
    const items: InstrumentEstimate[] = [];
    for (const [label, e] of this.evidence) {
      const likely = e.peak >= 0.85 || e.strong >= 2;
      if (!likely && e.peak < 0.55 && e.possible < 2) continue;
      items.push({ label, score: e.peak, status: likely ? 'likely' : 'possible', windows: e.possible, segments: e.segments });
    }
    if (!items.length && this.suggestion) return [this.suggestion];
    // A specific likely instrument supersedes its broad family, not a different instrument.
    const superseded = new Set(items.filter(i => i.status === 'likely').flatMap(i => INSTRUMENT_PARENTS[i.label] ?? []));
    return items.filter(i => !superseded.has(i.label)).sort((a, b) => Number(b.status === 'likely') - Number(a.status === 'likely') || b.score - a.score || a.label.localeCompare(b.label));
  }
}

export function confirmedInstrumentList(analysis: MusicAnalysis): string[] | undefined {
  const reviews=new Map(analysis.soundReviews?.filter(r=>r.dimension==='source').map(r=>[r.labelId,r.decision]));
  const confirmed=[...new Set([...(analysis.confirmedInstruments??[]),...[...reviews].filter(([,decision])=>decision==='confirmed').map(([label])=>label)])]
    .filter(label=>!isBroadInstrument(label)&&(!reviews.has(label)||reviews.get(label)==='confirmed'));
  // Unsure/Reject history is not a human instrument list; only confirmations replace name tags.
  if (analysis.confirmedInstruments === undefined && !confirmed.length) return;
  return confirmed;
}

export function reliableInstruments(analysis: MusicAnalysis): InstrumentEstimate[] {
  const confirmed=confirmedInstrumentList(analysis);
  if (confirmed) return confirmed.map(label=>({label,score:1}));
  if (analysis.recognition) return []; // No independently validated acceptance policy yet.
  if (analysis.version !== 2 || analysis.stage === 'preview') return [];
  return analysis.instruments.filter(i => i.status === 'likely' && i.score >= 0.6 && !isBroadInstrument(i.label));
}

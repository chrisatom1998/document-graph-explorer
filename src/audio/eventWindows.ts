import type { DescriptionScore } from './profileDescriptions';
import type { DjTag } from './djTags';

/** Short windows at the moments a new sound starts in a long recording, scored by the one-shot heads.
 * In a 10 s window a short sound sits under the beat; cut at its start it fills most of the window.
 * Measured on held-out drum-loop mixes at the known start (docs/evaluations/dj-labels-2026-10-04/event-windows.json):
 * vinyl scratch 94% precision / 60% recall, synthesizer 63% / 67%; impact and whoosh did not work, so only
 * the measured labels are kept, always as "maybe" (a real song's starts are found, not known). */
export const EVENT_WINDOW_BEFORE = 0.05;
export const EVENT_WINDOW_AFTER = 2.0;
export const EVENT_WINDOW_LABELS: ReadonlySet<string> = new Set(['vinyl scratch', 'synthesizer']);
/** A song-level tag needs this many separate windows to agree; one window alone is a guess. */
export const EVENT_WINDOW_MIN_HITS = 2;
const RATE = 16000, HOP = 160, FRAME = 320, MIN_GAP = 1.0;

/** At most one window per 15 s of audio, and never more than 24. */
export const eventWindowBudget = (duration: number) => Number.isFinite(duration) && duration > 0 ? Math.min(24, Math.max(1, Math.ceil(duration / 15))) : 0;

/** Onset candidates in one 16 kHz chunk: frames whose log energy jumps above the previous 100 ms.
 * Returns times (seconds, offset by `start`) with strengths; peaks closer than MIN_GAP keep the stronger. */
export function onsetCandidates(samples: Float32Array, start = 0): { time: number; strength: number }[] {
  const frames = Math.floor((samples.length - FRAME) / HOP) + 1;
  if (frames < 12) return [];
  const energy = new Float64Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0; for (let i = f * HOP; i < f * HOP + FRAME; i++) sum += samples[i] * samples[i];
    energy[f] = Math.log10(sum / FRAME + 1e-10);
  }
  // Rise: this frame's log energy over the mean of the previous 100 ms (10 frames).
  const rise = new Float64Array(frames);
  for (let f = 10; f < frames; f++) { let before = 0; for (let k = f - 10; k < f; k++) before += energy[k]; rise[f] = energy[f] - before / 10; }
  const out: { time: number; strength: number }[] = [];
  // A local peak of the rise (x2 energy or more), loud enough to hear (above -50 dB mean square).
  for (let f = 11; f < frames - 1; f++)
    if (rise[f] > 0.3 && energy[f] > -5 && rise[f] >= rise[f - 1] && rise[f] > rise[f + 1]) out.push({ time: start + f * HOP / RATE, strength: rise[f] });
  return out;
}

/** Strongest starts across the whole recording, at least MIN_GAP apart, in time order. Each window must fit. */
export function pickEventStarts(candidates: { time: number; strength: number }[], duration: number, budget = eventWindowBudget(duration)): number[] {
  const chosen: number[] = [];
  for (const c of [...candidates].sort((a, b) => b.strength - a.strength || a.time - b.time)) {
    if (chosen.length >= budget) break;
    if (c.time - EVENT_WINDOW_BEFORE < 0 || c.time + EVENT_WINDOW_AFTER > duration) continue;
    if (chosen.some(t => Math.abs(t - c.time) < MIN_GAP)) continue;
    chosen.push(c.time);
  }
  return chosen.sort((a, b) => a - b);
}

/** Collects the measured one-shot labels per window; a label becomes a maybe tag once enough windows agree. */
export class EventWindowEvidence {
  private hits = new Map<string, { tag: DjTag; segments: { start: number; end: number }[] }>();
  add(scores: DescriptionScore[], start: number, end: number) {
    for (const s of scores) {
      if (s.group !== 'dj-learned' || s.basis !== 'head' || s.decision !== 'include' || !s.learnedGroup || !s.label || !EVENT_WINDOW_LABELS.has(s.label)) continue;
      const key = `${s.learnedGroup}:${s.label}`; const hit = this.hits.get(key);
      if (!hit) this.hits.set(key, { tag: { group: s.learnedGroup as DjTag['group'], label: s.label, score: s.score, model: 'Trained head (maybe)' }, segments: [{ start, end }] });
      else { hit.tag.score = Math.max(hit.tag.score, s.score); hit.segments.push({ start, end }); }
    }
  }
  results(): { tag: DjTag; segments: { start: number; end: number }[] }[] {
    return [...this.hits.values()].filter(h => h.segments.length >= EVENT_WINDOW_MIN_HITS);
  }
}

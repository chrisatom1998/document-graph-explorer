import policyJson from './taggerPolicy.json';
import type { Dimension, Interval } from './recognition';

/** DGE's own all-tags tagger (scripts/audio-model/, docs/evaluations/all-tags-model-2026-10-06): an EfficientAT mn10
 * network fine-tuned on FSD50K, NSynth, MTG-Jamendo, OpenMIC, Freesound and SoundCloud clips. Its ONNX graph holds the
 * whole log-mel front end, so the browser only supplies 10 s of 32 kHz mono audio per window, exactly as the held-out
 * scorer (scripts/audio-model/evaluate.py) did.
 *
 * Only the outputs in taggerPolicy.json are used: tags where its held-out precision and recall beat the app's measured
 * detectors. Within the sampled audio the tagger *decides* the tag on its own; native detections outside its coverage
 * remain available. Its tag shows when the score passes the validation-picked threshold. Every other tag keeps the
 * existing detectors. */
export interface TaggerTag {
  /** Output name in the model's class list (public/tagger-model/model.json). */
  output: string;
  /** Display label and dimension the app shows it under. */
  label: string;
  dimension: Extract<Dimension, 'source' | 'character' | 'effect'>;
  /** Picked on validation artists only (scripts/audio-model/calibrate.py). */
  threshold: number;
  /** Display labels this output replaces within its sampled coverage. */
  decides: string[];
  /** Equivalent display labels stored under another dimension by a native detector. */
  alsoDecides?: { dimension: Extract<Dimension, 'source' | 'character' | 'effect'>; label: string }[];
  /** Held-out precision and recall both reached 0.70 on every complete-label set; otherwise shown as a "maybe" tag. */
  tested: boolean;
  /** Recordings shorter than this keep the existing detectors for this tag (the held-out sets had no shorter audio). */
  minSeconds?: number;
  /** How a recording scored on more than one window decides this tag; without it, the best window decides (as on a
   * single-window clip). Picked on the full-song tuning set (docs/evaluations/all-tags-model-2026-10-06). */
  long?: TaggerLongRule;
}
/** Long-recording rules. 'max': the best window passes `threshold`. 'windows': at least `windows` windows pass it.
 * 'mean': the windows' mean passes it. 'agree': the best window passes it and the existing detectors show the tag too.
 * 'detectors': the existing detectors decide the tag, as if the tagger did not cover it. `threshold` defaults to the
 * tag's own. */
export interface TaggerLongRule {
  rule: 'max' | 'windows' | 'mean' | 'agree' | 'detectors';
  threshold?: number;
  windows?: number;
}
export interface TaggerPolicy {
  version: 1;
  revision: string;
  modelSha256: string;
  input: { name: string; output: string; sampleRate: number; windowSamples: number; maxWindows: number };
  tags: TaggerTag[];
}
export const TAGGER_POLICY = policyJson as TaggerPolicy;
export const TAGGER_REVISION = TAGGER_POLICY.revision;
export const TAGGER_SAMPLE_RATE = TAGGER_POLICY.input.sampleRate;
export const TAGGER_WINDOW_SAMPLES = TAGGER_POLICY.input.windowSamples;
export const TAGGER_WINDOW_SECONDS = TAGGER_WINDOW_SAMPLES / TAGGER_SAMPLE_RATE;
/** The held-out full songs were scored on their middle 30 s (scripts/audio-model/prepare-holdout.py): three windows. */
export const TAGGER_MAX_WINDOWS = TAGGER_POLICY.input.maxWindows;
export const TAGGER_UNAVAILABLE = 'The trained tagger was unavailable; the other detectors decided every tag. Reanalyze to retry.';
/** Display names of the tagger's scores. "maybe" marks a tag whose held-out precision or recall is below 0.70. */
export const TAGGER_SCORE = 'Trained tagger score';
export const TAGGER_MAYBE_SCORE = 'Trained tagger score (maybe)';

/** Window starts in seconds, as evaluate.py cuts a clip: whole 10 s windows from the start (one window, padded with
 * silence, when the clip is shorter than 10 s). A recording longer than three windows is read from its middle 30 s,
 * the excerpt the full-song held-out set used. */
export function taggerWindowStarts(duration: number): number[] {
  if (!Number.isFinite(duration) || duration <= 0) return [];
  const whole = Math.floor(duration / TAGGER_WINDOW_SECONDS + 1e-6);
  if (whole <= TAGGER_MAX_WINDOWS) return Array.from({ length: Math.max(1, whole) }, (_, k) => k * TAGGER_WINDOW_SECONDS);
  const first = (duration - TAGGER_MAX_WINDOWS * TAGGER_WINDOW_SECONDS) / 2;
  return Array.from({ length: TAGGER_MAX_WINDOWS }, (_, k) => first + k * TAGGER_WINDOW_SECONDS);
}

/** One model input: the window's samples, cut or padded with silence to exactly 10 s. */
export function taggerWindow(samples: Float32Array): Float32Array {
  if (samples.length === TAGGER_WINDOW_SAMPLES) return samples;
  const out = new Float32Array(TAGGER_WINDOW_SAMPLES);
  out.set(samples.subarray(0, TAGGER_WINDOW_SAMPLES));
  return out;
}

/** What a finished analysis stores: the recording's score per policy output (`scores`, the maximum over its windows, the
 * rule evaluate.py scored: a tag counts when any window passes) and each output's score per window (`windowScores`, in
 * window order), which the long-recording rules read. Thresholds are applied when the tags are shown. */
export interface TaggerAnalysis {
  revision: string;
  windows: number;
  scores: Record<string, number>;
  windowScores?: Record<string, number[]>;
  /** Actual audio intervals, excluding silence added to pad a short input. Negative decisions only cover these ranges. */
  intervals?: Interval[];
}

export class TaggerEvidence {
  private perWindow = new Map<string, number[]>();
  private intervals: Interval[] = [];
  private count = 0;
  add(scores: Record<string, number>, interval?: Interval): void {
    this.count++;
    if (interval) this.intervals.push({ start: interval.start, end: interval.end });
    for (const tag of TAGGER_POLICY.tags) {
      const s = scores[tag.output];
      if (typeof s !== 'number' || !Number.isFinite(s) || s < 0 || s > 1) continue;
      const list = this.perWindow.get(tag.output) ?? [];
      list.push(s); this.perWindow.set(tag.output, list);
    }
  }
  results(): TaggerAnalysis | undefined {
    if (!this.count) return;
    // Missing/invalid output is unknown, not a negative observation. Only outputs scored in every
    // window can decide a tag. Keep model precision: rounding here can cross a calibrated threshold.
    const windowScores = Object.fromEntries([...this.perWindow].filter(([, v]) => v.length === this.count).map(([k, v]) => [k, [...v]]));
    return { revision: TAGGER_REVISION, windows: this.count, scores: Object.fromEntries(Object.entries(windowScores).map(([k, v]) => [k, Math.max(...v)])), windowScores,
      ...(this.intervals.length === this.count ? { intervals: this.intervals.map(i => ({ ...i })) } : {}) };
  }
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
function sanitizeIntervals(raw: unknown, windows: number, duration: number): Interval[] | undefined {
  if (!Array.isArray(raw) || raw.length !== windows) return;
  const intervals: Interval[] = [];
  for (const i of raw) {
    if (!i || !finite(i.start) || !finite(i.end) || i.start < 0 || i.end <= i.start || i.end > duration + 1e-6
      || i.end - i.start > TAGGER_WINDOW_SECONDS + 1e-6 || (intervals.length && i.start < intervals.at(-1)!.end - 1e-6)) return;
    intervals.push({ start: i.start, end: i.end });
  }
  return intervals;
}
/** Current-revision legacy results used this same deterministic sampler. Infer its intervals only when the count
 * matches; unknown or inconsistent coverage cannot veto a native detection. New results store the actual intervals. */
export function taggerIntervals(tagger: TaggerAnalysis | undefined, duration: number): Interval[] {
  if (!tagger || tagger.revision !== TAGGER_REVISION || !finite(duration) || duration <= 0) return [];
  if (tagger.intervals !== undefined) return sanitizeIntervals(tagger.intervals, tagger.windows, duration) ?? [];
  const starts = taggerWindowStarts(duration);
  return starts.length === tagger.windows ? starts.map(start => ({ start, end: Math.min(duration, start + TAGGER_WINDOW_SECONDS) })) : [];
}
export function sanitizeTaggerAnalysis(raw: unknown, durationSeconds = 86400): TaggerAnalysis | undefined {
  const t = raw as Partial<TaggerAnalysis> | undefined;
  if (!t || typeof t !== 'object' || typeof t.revision !== 'string' || !t.revision || t.revision.length > 120) return;
  if (!finite(t.windows) || !Number.isInteger(t.windows) || t.windows < 1 || t.windows > TAGGER_MAX_WINDOWS) return;
  if (!t.scores || typeof t.scores !== 'object' || Array.isArray(t.scores)) return;
  const outputs = new Set(TAGGER_POLICY.tags.map(tag => tag.output));
  const scores = Object.fromEntries(Object.entries(t.scores).filter(([k, v]) => outputs.has(k) && finite(v) && v >= 0 && v <= 1));
  const out: TaggerAnalysis = { revision: t.revision, windows: t.windows, scores };
  if (t.intervals !== undefined) {
    const intervals = sanitizeIntervals(t.intervals, t.windows, durationSeconds);
    if (!intervals) return;
    out.intervals = intervals;
  }
  const perWindow = t.windowScores && typeof t.windowScores === 'object' && !Array.isArray(t.windowScores) ? t.windowScores : undefined;
  if (perWindow) {
    const windowScores = Object.fromEntries(Object.entries(perWindow).filter(([k, v]) => outputs.has(k) && k in scores && Array.isArray(v)
      && v.length === t.windows && v.every(x => finite(x) && x >= 0 && x <= 1)));
    if (Object.keys(windowScores).length) out.windowScores = windowScores;
  }
  return out;
}

export interface TaggerDisplay {
  tag: TaggerTag; shown: boolean; score: number;
  /** Set by the 'agree' rule: the tag shows only if the existing detectors show it as well (checked by the display). */
  needsAgreement?: boolean;
}
/** The recording-level score a tag's rule reads, and the threshold it is compared with. Undefined when the tagger does
 * not decide the tag on this recording (the 'detectors' rule, or per-window scores missing for a rule that needs them). */
function ruleScore(tag: TaggerTag, tagger: TaggerAnalysis): { raw: number; threshold: number; agree: boolean } | undefined {
  const best = tagger.scores[tag.output];
  if (!finite(best) || best < 0 || best > 1) return;
  const long = tagger.windows > 1 ? tag.long : undefined;
  if (!long || long.rule === 'max') return { raw: best, threshold: long?.threshold ?? tag.threshold, agree: false };
  const threshold = long.threshold ?? tag.threshold;
  if (long.rule === 'detectors') return;
  if (long.rule === 'agree') return { raw: best, threshold, agree: true };
  const windows = tagger.windowScores?.[tag.output];
  if (!windows || windows.length !== tagger.windows || !windows.every(v => finite(v) && v >= 0 && v <= 1)) return;
  if (long.rule === 'mean') return { raw: windows.reduce((a, b) => a + b, 0) / windows.length, threshold, agree: false };
  // 'windows': the k-th best window is the score that has to pass, so k windows pass exactly when it does.
  const k = Math.min(windows.length, Math.max(1, long.windows ?? 2));
  return { raw: [...windows].sort((a, b) => b - a)[k - 1], threshold, agree: false };
}
/** The installed policy applied to a stored result: every tag the tagger decides for this recording, whether it is
 * shown, and its display score (the threshold reads as the app's 0.5 likely cutoff, 1 stays 1). Undefined when the
 * stored result came from another tagger revision. */
export function taggerDecisions(tagger: TaggerAnalysis | undefined, durationSeconds: number): TaggerDisplay[] | undefined {
  if (!tagger || tagger.revision !== TAGGER_REVISION) return;
  return TAGGER_POLICY.tags.filter(tag => !tag.minSeconds || (Number.isFinite(durationSeconds) && durationSeconds >= tag.minSeconds - 1e-6)).flatMap(tag => {
    const rule = ruleScore(tag, tagger);
    if (!rule) return [];
    const { raw, threshold } = rule;
    const shown = raw >= threshold;
    const score = shown ? Math.min(1, Math.round((0.5 + 0.5 * (raw - threshold) / (1 - threshold)) * 1e4) / 1e4) : 0;
    return [rule.agree ? { tag, shown, score, needsAgreement: true } : { tag, shown, score }];
  });
}

export const isTaggerScores = (value: unknown): value is Record<string, number> => !!value && typeof value === 'object' && !Array.isArray(value)
  && TAGGER_POLICY.tags.every(tag => Object.hasOwn(value, tag.output))
  && Object.values(value).every(v => finite(v) && v >= 0 && v <= 1);

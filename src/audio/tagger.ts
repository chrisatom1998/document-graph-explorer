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
  /** Passed the ship line on every fresh test set; otherwise shown as a "maybe" tag. Since 2026-10-11 (Chris) the line is 60/30:
   * precision >= 0.60 and recall >= 0.30 on each set with 5+ positives, and at most 1% false alarms on sets with fewer. Before,
   * precision and recall both reached SOUND_TAG_BAR (0.50 from 2026-10-10; 0.70 before). Not the display cutoff. */
  tested: boolean;
  /** Recordings shorter than this keep the existing detectors for this tag (the held-out sets had no shorter audio). */
  minSeconds?: number;
  /** How a recording scored on more than one window decides this tag; without it, the best window decides (as on a
   * single-window clip). Picked on the full-song tuning set (docs/evaluations/all-tags-model-2026-10-06). */
  long?: TaggerLongRule;
  /** Also listens to the tail of a 10-30 s clip that whole 10 s windows leave unheard (taggerTailStart): its best window and
   * its coverage then include one more window ending at the end of the clip. Set per tag where that measured better. */
  tail?: boolean;
  /** Which model to trust for this tag where the tagger listened (default: the tagger replaces the other detectors there,
   * but their positives in sections it never scored stand). 'sole': the tagger's answer covers the whole recording, so
   * other detectors' positives in unscored sections (e.g. the tail of a 15 s clip) are dropped too; only on recordings up
   * to 30 s (TAGGER_MAX_WINDOWS windows), the lengths it was picked on. 'either': the tagger
   * can add the tag, but its "no" does not remove the other detectors' positives. 'both': the tag shows only when the
   * tagger and the other detectors both show it (a tagger "no" also covers sections it did not hear). Picked per tag on one half of a group split, checked on the other
   * (docs/evaluations/tagger-trust-2026-11-07). The long rules still decide whether the tagger is asked at all. */
  trust?: TaggerTrust;
}
export type TaggerTrust = 'sole' | 'either' | 'both';
/** Long-recording rules. 'max': the best window passes `threshold`. 'windows': at least `windows` windows pass it.
 * 'mean': the windows' mean passes it. 'agree': the best window passes it and the existing detectors show the tag too.
 * 'detectors': the existing detectors decide the tag, as if the tagger did not cover it. `threshold` defaults to the
 * tag's own. */
export interface TaggerLongRule {
  rule: 'max' | 'windows' | 'mean' | 'agree' | 'detectors';
  threshold?: number;
  /** The rule covers only recordings longer than this; shorter multi-window clips keep the best window, as the held-out
   * scorer read them (scripts/audio-model/evaluate.py). */
  afterSeconds?: number;
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
/** Display names of the tagger's scores. "maybe" marks a tag whose held-out precision or recall is below the shipping bar. */
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

/** Where the extra tail window starts: a clip of 10-30 s that whole 10 s windows do not cover to the end (the last 5 s
 * of a 15 s or 25 s clip) gets one more window ending at the end of the clip, overlapping the one before it. */
export function taggerTailStart(duration: number): number | undefined {
  const starts = taggerWindowStarts(duration);
  if (starts.length >= TAGGER_MAX_WINDOWS || !(duration > TAGGER_WINDOW_SECONDS)) return;
  return duration - (starts[starts.length - 1] + TAGGER_WINDOW_SECONDS) > 1e-6 ? duration - TAGGER_WINDOW_SECONDS : undefined;
}
/** The outputs that use the tail window. */
export const TAGGER_TAIL_OUTPUTS = new Set(TAGGER_POLICY.tags.filter(t => t.tail).map(t => t.output));

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
  /** The extra window over the unheard tail (taggerTailStart), scored only for the outputs marked `tail`. */
  tail?: { start: number; end: number; scores: Record<string, number> };
}

export class TaggerEvidence {
  private perWindow = new Map<string, number[]>();
  private intervals: Interval[] = [];
  private count = 0;
  private tail?: TaggerAnalysis['tail'];
  /** The tail window (taggerTailStart): kept apart, for the outputs marked `tail` only. */
  addTail(scores: Record<string, number>, interval: Interval): void {
    const kept = Object.fromEntries(Object.entries(scores).filter(([k, v]) => TAGGER_TAIL_OUTPUTS.has(k) && finite(v) && v >= 0 && v <= 1));
    if (Object.keys(kept).length) this.tail = { start: interval.start, end: interval.end, scores: kept };
  }
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
      ...(this.intervals.length === this.count ? { intervals: this.intervals.map(i => ({ ...i })) } : {}),
      ...(this.tail && this.intervals.length === this.count ? { tail: { ...this.tail, scores: { ...this.tail.scores } } } : {}) };
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
  const tail = t.tail;
  if (out.intervals && tail && typeof tail === 'object' && finite(tail.start) && finite(tail.end) && tail.start >= 0 && tail.end > tail.start
    && tail.end <= durationSeconds + 1e-6 && tail.end - tail.start <= TAGGER_WINDOW_SECONDS + 1e-6 && tail.scores && typeof tail.scores === 'object') {
    const kept = Object.fromEntries(Object.entries(tail.scores).filter(([k, v]) => outputs.has(k) && finite(v) && v >= 0 && v <= 1));
    if (Object.keys(kept).length) out.tail = { start: tail.start, end: tail.end, scores: kept };
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
/** `scoredWindows`: the scorer's window count, which picks the long-recording rule. The tail window adds coverage, never a
 * long rule: a 15 s clip stays a one-window clip for that choice, as the held-out scorer read it. */
function ruleScore(tag: TaggerTag, tagger: TaggerAnalysis, durationSeconds: number, scoredWindows = tagger.windows): { raw: number; threshold: number; agree: boolean } | undefined {
  const best = tagger.scores[tag.output];
  if (!finite(best) || best < 0 || best > 1) return;
  const after = tag.long?.afterSeconds;
  const long = scoredWindows > 1 && (after === undefined || !(durationSeconds <= after + 1e-6)) ? tag.long : undefined;
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
/** The analysis as one tag reads it: a `tail` tag sees the tail window as one more window. */
export function taggerForTag(tagger: TaggerAnalysis, tag: TaggerTag): TaggerAnalysis {
  const extra = tag.tail ? tagger.tail : undefined, s = extra?.scores[tag.output];
  if (!extra || !finite(s) || !tagger.intervals) return tagger;
  const windows = tagger.windowScores?.[tag.output];
  return { ...tagger, windows: tagger.windows + 1, scores: { ...tagger.scores, [tag.output]: Math.max(tagger.scores[tag.output] ?? 0, s) },
    ...(windows ? { windowScores: { ...tagger.windowScores, [tag.output]: [...windows, s] } } : {}),
    intervals: [...tagger.intervals, { start: extra.start, end: extra.end }] };
}
export function taggerDecisions(tagger: TaggerAnalysis | undefined, durationSeconds: number): TaggerDisplay[] | undefined {
  if (!tagger || tagger.revision !== TAGGER_REVISION) return;
  return TAGGER_POLICY.tags.filter(tag => !tag.minSeconds || (Number.isFinite(durationSeconds) && durationSeconds >= tag.minSeconds - 1e-6)).flatMap(tag => {
    const rule = ruleScore(tag, taggerForTag(tagger, tag), durationSeconds, tagger.windows);
    if (!rule) return [];
    const { raw, threshold } = rule;
    const shown = raw >= threshold;
    const score = shown ? Math.min(1, Math.round((0.5 + 0.5 * (raw - threshold) / (1 - threshold)) * 1e4) / 1e4) : 0;
    return [rule.agree || tag.trust === 'both' ? { tag, shown, score, needsAgreement: true } : { tag, shown, score }];
  });
}

export const isTaggerScores = (value: unknown): value is Record<string, number> => !!value && typeof value === 'object' && !Array.isArray(value)
  && TAGGER_POLICY.tags.every(tag => Object.hasOwn(value, tag.output))
  && Object.values(value).every(v => finite(v) && v >= 0 && v <= 1);
/** A tested tagger output scoring under this share of its own threshold counts as the audio clearly saying "not this".
 * A guess, not tuned: it only lets the audio overrule a file or folder name (filenameSoundFallback), never add a tag. */
export const TAGGER_CLEAR_NO = 0.1;
/** True when a tested tagger tag that decides this label scored the recording under TAGGER_CLEAR_NO of its threshold. */
export function taggerClearlyAbsent(tagger: TaggerAnalysis | undefined, durationSeconds: number, dimension: TaggerTag['dimension'], label: string): boolean {
  if (!tagger || tagger.revision !== TAGGER_REVISION) return false;
  return TAGGER_POLICY.tags.some(tag => {
    if (!tag.tested || (tag.label !== label || tag.dimension !== dimension) && !(tag.dimension === dimension && tag.decides.includes(label))) return false;
    if (tag.minSeconds && !(Number.isFinite(durationSeconds) && durationSeconds >= tag.minSeconds - 1e-6)) return false;
    const rule = ruleScore(tag, taggerForTag(tagger, tag), durationSeconds, tagger.windows);
    return !!rule && !rule.agree && rule.raw < rule.threshold * TAGGER_CLEAR_NO;
  });
}

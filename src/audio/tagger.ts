import policyJson from './taggerPolicy.json';
import type { Dimension } from './recognition';

/** DGE's own all-tags tagger (scripts/audio-model/, docs/evaluations/all-tags-model-2026-10-06): an EfficientAT mn10
 * network fine-tuned on FSD50K, NSynth, MTG-Jamendo, OpenMIC, Freesound and SoundCloud clips. Its ONNX graph holds the
 * whole log-mel front end, so the browser only supplies 10 s of 32 kHz mono audio per window, exactly as the held-out
 * scorer (scripts/audio-model/evaluate.py) did.
 *
 * Only the outputs in taggerPolicy.json are used: tags where its held-out precision and recall beat the app's measured
 * detectors. For each of them the tagger *decides* the tag on its own: the other models' estimates for it are dropped,
 * and the tag shows only when the tagger's score passes its validation-picked threshold. Every other tag keeps the
 * existing detectors. */
export interface TaggerTag {
  /** Output name in the model's class list (public/tagger-model/model.json). */
  output: string;
  /** Display label and dimension the app shows it under. */
  label: string;
  dimension: Extract<Dimension, 'source' | 'character' | 'effect'>;
  /** Picked on validation artists only (scripts/audio-model/calibrate.py). */
  threshold: number;
  /** Display labels this output replaces: other models' estimates for them are not shown. */
  decides: string[];
  /** Held-out precision and recall both reached 0.70 on every complete-label set; otherwise shown as a "maybe" tag. */
  tested: boolean;
  /** Recordings shorter than this keep the existing detectors for this tag (the held-out sets had no shorter audio). */
  minSeconds?: number;
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

/** What a finished analysis stores: the recording's score per policy output (the maximum over its windows, the rule
 * evaluate.py scored: a tag counts when any window passes). Thresholds are applied when the tags are shown. */
export interface TaggerAnalysis { revision: string; windows: number; scores: Record<string, number> }

export class TaggerEvidence {
  private best = new Map<string, number>();
  private count = 0;
  add(scores: Record<string, number>): void {
    this.count++;
    for (const tag of TAGGER_POLICY.tags) {
      const s = scores[tag.output];
      if (typeof s === 'number' && Number.isFinite(s) && s >= 0 && s <= 1) this.best.set(tag.output, Math.max(this.best.get(tag.output) ?? 0, s));
    }
  }
  results(): TaggerAnalysis | undefined {
    if (!this.count) return;
    return { revision: TAGGER_REVISION, windows: this.count, scores: Object.fromEntries([...this.best].map(([k, v]) => [k, Math.round(v * 1e4) / 1e4])) };
  }
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
export function sanitizeTaggerAnalysis(raw: unknown): TaggerAnalysis | undefined {
  const t = raw as Partial<TaggerAnalysis> | undefined;
  if (!t || typeof t !== 'object' || typeof t.revision !== 'string' || !t.revision || t.revision.length > 120) return;
  if (!finite(t.windows) || !Number.isInteger(t.windows) || t.windows < 1 || t.windows > TAGGER_MAX_WINDOWS) return;
  if (!t.scores || typeof t.scores !== 'object' || Array.isArray(t.scores)) return;
  const outputs = new Set(TAGGER_POLICY.tags.map(tag => tag.output));
  const scores = Object.fromEntries(Object.entries(t.scores).filter(([k, v]) => outputs.has(k) && finite(v) && v >= 0 && v <= 1));
  return { revision: t.revision, windows: t.windows, scores };
}

export interface TaggerDisplay { tag: TaggerTag; shown: boolean; score: number }
/** The installed policy applied to a stored result: every tag the tagger decides for this recording, whether it is
 * shown, and its display score (the threshold reads as the app's 0.5 likely cutoff, 1 stays 1). Undefined when the
 * stored result came from another tagger revision. */
export function taggerDecisions(tagger: TaggerAnalysis | undefined, durationSeconds: number): TaggerDisplay[] | undefined {
  if (!tagger || tagger.revision !== TAGGER_REVISION) return;
  return TAGGER_POLICY.tags.filter(tag => !tag.minSeconds || (Number.isFinite(durationSeconds) && durationSeconds >= tag.minSeconds - 1e-6)).map(tag => {
    const raw = tagger.scores[tag.output] ?? 0;
    const shown = raw >= tag.threshold;
    return { tag, shown, score: shown ? Math.min(1, Math.round((0.5 + 0.5 * (raw - tag.threshold) / (1 - tag.threshold)) * 1e4) / 1e4) : 0 };
  });
}

export const isTaggerScores = (value: unknown): value is Record<string, number> => !!value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length > 0 && Object.values(value).every(v => finite(v) && v >= 0 && v <= 1);

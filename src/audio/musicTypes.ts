import { installedFusionIdentity } from './fusionRelease';
import { sanitizeFusion, type FusionAnalysis } from './fusion';
import { sanitizeFullMixAnalysis, type FullMixAnalysis } from './fullMixHeads';
import { sanitizeTaggerAnalysis, type TaggerAnalysis } from './tagger';
import { sourceLabels, sanitizeRecognition, sanitizeSoundReviews, type Recognition, type SoundReview } from './recognition';
import { sanitizeConfirmedDjTags, type ConfirmedDjTags } from './djTags';
import { sanitizeSoundProfile, type SoundProfile } from './soundProfile';
import { INSTRUMENT_LABELS } from './instrumentLabels';
import { sanitizeCopilotProperties, type CopilotProperties } from './copilotProperties';
import { sanitizeStructure, type TrackStructure } from './structure';
import { sanitizeVersionPrint } from './versionPrint';
import { sanitizeGenreScores, sanitizeStyles, type TrackStyle } from './genreEnergy';
import { sanitizeNativeWindowEvidence, type NativeWindowEvidence } from './nativeWindowEvidence';
export const MUSIC_ANALYSIS_VERSION = 2;
export const KEY_ANALYSIS_REVISION = 4;
export const TEMPO_ANALYSIS_REVISION = 4;
// Enabling the built-in policy makes persisted native-only documents eligible for reanalysis. 70/71: full-mix heads. 73/74: genre and energy.
// 75/76: the trained tagger. 77/78: its per-window scores (long-recording rules).
// 79/80: full-precision tagger scores; incomplete outputs remain unknown.
export const INSTRUMENT_ANALYSIS_REVISION = installedFusionIdentity() ? 80 : 79;
export interface InstrumentEstimate {
  label: string;
  score: number;
  status?: 'likely' | 'possible';
  windows?: number;
  segments?: { start: number; end: number; score: number }[];
  windowEvidence?: NativeWindowEvidence;
}
export type MusicAnalysisMode = 'fast' | 'full';
export interface MusicAnalysis {
  /** Source-owned release checked by this local run, including unsupported input tiers. */
  classifierConfiguration?: string;
  /** Separate experimental window decisions; never merged into native evidence. */
  fusion?: FusionAnalysis;
  /** Full-mix instrument heads over each whole 10 s window's native outputs: labels at or above their tested threshold. */
  fullMix?: FullMixAnalysis;
  /** The trained tagger's recording scores for the tags it decides (src/audio/tagger.ts); thresholds apply at display. */
  tagger?: TaggerAnalysis;
  recognition?: Recognition;
  soundReviews?: SoundReview[];
  stage?: 'preview';
  version: 1 | 2;
  tempoRevision?: number;
  keyRevision?: number;
  analyzedSeconds: number;
  durationSeconds: number;
  tempo?: { bpm: number; confidence: number; alternatives?: number[] };
  key?: { tonic: number; mode: 'major' | 'minor'; strength: number };
  detectedPitch?: { pitchClass: number; confidence: number };
  instruments: InstrumentEstimate[];
  /** Automatic best-match classification. Similarity and margin are not probabilities. */
  instrumentPrediction?: { label: string; score: number; margin: number; model?: 'MTG-Jamendo' | 'Ensemble' };
  /** User correction; when present, replaces model instruments for display and links. */
  confirmedInstruments?: string[];
  confirmedDjTags?: ConfirmedDjTags;
  /** Accepted AI suggestions, not human-confirmed labels or audio measurements. */
  copilotProperties?: CopilotProperties;
  soundProfile?: SoundProfile;
  /** Strongest Discogs styles (mean over the analysed windows); the shown genre is derived from them (genreEnergy.ts). */
  styles?: TrackStyle[];
  /** Genre head probabilities (mean styles in, Beatport genres out), tagged with the head version that made them. */
  genreScores?: { version: string; scores: Record<string, number> };
  /** Energy head probability of a high-energy track (mean logit over windows); the shown level is derived from it. */
  energyScore?: number;
  /** 512-d unit CLAP audio vector (mean of analyzed windows). Lives here, not in EmbeddingRecord, which is the text pipeline's table. Powers 'similar' edges. */
  embedding?: number[];
  /** Intro, drops, breakdowns and outro of a full track (src/audio/structure.ts); absent for clips under a minute. */
  structure?: TrackStructure;
  /** Compact pitch, band-balance and loudness series (versionPrint.ts) that finds other copies and versions of this recording. */
  versionPrint?: string;
  instrumentScan?: { mode?: MusicAnalysisMode; revision?: number; complete: boolean; analyzedSeconds: number; windows: number };
  notes: string[];
}
export const KEY_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
export function keyName(key: NonNullable<MusicAnalysis['key']>): string {
  return `${KEY_NAMES[key.tonic]} ${key.mode}`;
}
/** Persisted analysis is untrusted input, like every other imported graph field. */
export function sanitizeMusicAnalysis(raw: unknown, options: { trustedCache?: boolean } = {}): MusicAnalysis | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const m = raw as Record<string, unknown>;
  const positive = (v: unknown, max: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max;
  if ((m.version !== 1 && m.version !== 2) || !positive(m.analyzedSeconds, 90) || !positive(m.durationSeconds, 86400)) return undefined;
  const out: MusicAnalysis = { version: m.version, analyzedSeconds: m.analyzedSeconds, durationSeconds: m.durationSeconds, instruments: [], notes: [] };
  if (options.trustedCache && typeof m.classifierConfiguration === 'string' && m.classifierConfiguration.length < 2048) out.classifierConfiguration = m.classifierConfiguration;
  const storedFusion = m.fusion as Record<string, unknown> | undefined;
  const importedFusion = !options.trustedCache && storedFusion?.validation === 'policy-qualified'
    ? { ...storedFusion, validation: 'unvalidated', release: undefined, imported: true } : storedFusion;
  const fusion = sanitizeFusion(importedFusion, out.durationSeconds);
  if (fusion) out.fusion = fusion;
  const fullMix = sanitizeFullMixAnalysis(m.fullMix, out.durationSeconds);
  if (fullMix) out.fullMix = fullMix;
  const tagger = sanitizeTaggerAnalysis(m.tagger, out.durationSeconds);
  if (tagger) out.tagger = tagger;
  out.recognition = sanitizeRecognition(m.recognition, out.durationSeconds);
  if (!out.recognition) delete out.recognition;
  if (Array.isArray(m.soundReviews)) out.soundReviews = sanitizeSoundReviews(m.soundReviews);
  if (m.stage === 'preview') out.stage = 'preview';
  if (Array.isArray(m.confirmedInstruments)) out.confirmedInstruments = [...new Set(m.confirmedInstruments.filter((label): label is string => typeof label === 'string' && sourceLabels.includes(label)))];
  const confirmedDjTags = sanitizeConfirmedDjTags(m.confirmedDjTags);
  if (confirmedDjTags) out.confirmedDjTags = confirmedDjTags;
  const copilotProperties = sanitizeCopilotProperties(m.copilotProperties);
  if (copilotProperties) out.copilotProperties = copilotProperties;
  if (Array.isArray(m.embedding) && m.embedding.length === 512 && m.embedding.every(v => typeof v === 'number' && Number.isFinite(v)) && Math.hypot(...(m.embedding as number[])) > 1e-8) out.embedding = m.embedding as number[];
  const versionPrint = sanitizeVersionPrint(m.versionPrint);
  if (versionPrint) out.versionPrint = versionPrint;
  const styles = sanitizeStyles(m.styles);
  if (styles) out.styles = styles;
  const genreScores = sanitizeGenreScores(m.genreScores);
  if (genreScores) out.genreScores = genreScores;
  if (positive(m.energyScore, 1)) out.energyScore = m.energyScore;
  out.soundProfile = sanitizeSoundProfile(m.soundProfile, out.durationSeconds);
  if (!out.soundProfile) delete out.soundProfile;
  const prediction = m.instrumentPrediction as Record<string, unknown> | undefined;
  if (prediction && typeof prediction.label === 'string' && INSTRUMENT_LABELS.includes(prediction.label) && positive(prediction.score, 1) && positive(prediction.margin, 2)) {
    out.instrumentPrediction = { label: prediction.label, score: prediction.score, margin: prediction.margin };
    if (prediction.model === 'MTG-Jamendo' || prediction.model === 'Ensemble') out.instrumentPrediction.model = prediction.model;
  }
  if (positive(m.tempoRevision, 1000) && Number.isInteger(m.tempoRevision)) out.tempoRevision = m.tempoRevision;
  if (positive(m.keyRevision, 1000) && Number.isInteger(m.keyRevision)) out.keyRevision = m.keyRevision;
  const t = m.tempo as Record<string, unknown> | undefined;
  if (t && positive(t.bpm, 250) && t.bpm >= 40 && positive(t.confidence, 1)) out.tempo = { bpm: t.bpm, confidence: t.confidence };
  if (out.tempo && Array.isArray(t?.alternatives)) out.tempo.alternatives = [...new Set(t.alternatives.filter((v): v is number => positive(v, 250) && v >= 40 && v !== out.tempo!.bpm))].slice(0, 2);
  const k = m.key as Record<string, unknown> | undefined;
  if (k && k.source !== 'filename' && positive(k.tonic, 11) && Number.isInteger(k.tonic) && (k.mode === 'major' || k.mode === 'minor') && positive(k.strength, 1)) out.key = { tonic: k.tonic, mode: k.mode, strength: k.strength };
  const structure = sanitizeStructure(m.structure, out.durationSeconds);
  if (structure) out.structure = structure;
  const pitch = m.detectedPitch as Record<string, unknown> | undefined;
  if (pitch && positive(pitch.pitchClass, 11) && Number.isInteger(pitch.pitchClass) && positive(pitch.confidence, 1)) out.detectedPitch = { pitchClass: pitch.pitchClass, confidence: pitch.confidence };
  if (Array.isArray(m.instruments)) out.instruments = m.instruments.slice(0, 100).flatMap((v: unknown) => {
    if (!v || typeof v !== 'object') return [];
    const i = v as Record<string, unknown>;
    if (typeof i.label !== 'string' || !positive(i.score, 1)) return [];
    const item: InstrumentEstimate = { label: i.label.slice(0, 80), score: i.score };
    const windowEvidence = sanitizeNativeWindowEvidence(i.windowEvidence, out.durationSeconds);
    if (windowEvidence) item.windowEvidence = windowEvidence;
    if (m.version === 2) {
      if (i.status !== 'likely' && i.status !== 'possible') return [];
      item.status = i.status;
      if (positive(i.windows, 20000) && Number.isInteger(i.windows)) item.windows = i.windows;
      if (Array.isArray(i.segments)) item.segments = i.segments.slice(0, 5).flatMap((segment: unknown) => {
        if (!segment || typeof segment !== 'object') return [];
        const s = segment as Record<string, unknown>;
        return positive(s.start, out.durationSeconds) && positive(s.end, out.durationSeconds) && s.end > s.start && positive(s.score, 1)
          ? [{ start: s.start, end: s.end, score: s.score }] : [];
      });
    }
    return [item];
  });
  const scan = m.instrumentScan as Record<string, unknown> | undefined;
  if (m.version === 2 && scan && typeof scan.complete === 'boolean' && positive(scan.analyzedSeconds, out.durationSeconds) && positive(scan.windows, 20000) && Number.isInteger(scan.windows)) {
    out.instrumentScan = { complete: scan.complete, analyzedSeconds: scan.analyzedSeconds, windows: scan.windows };
    if (scan.mode === 'fast' || scan.mode === 'full') out.instrumentScan.mode = scan.mode;
    if (positive(scan.revision, 1000) && Number.isInteger(scan.revision)) out.instrumentScan.revision = scan.revision;
  }
  if (Array.isArray(m.notes)) out.notes = m.notes.filter((v): v is string => typeof v === 'string').slice(0, 5).map(v => v.slice(0, 250));
  return out;
}

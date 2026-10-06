import soundManifest from '../../public/sound-model/manifest.json';

/** Full-mix instrument heads: one logistic head per instrument over the three models every full analysis already runs
 * on each 10 s window (CLAP sound embedding, AudioSet AST instrument scores, MTG-Jamendo instrument activations).
 * Fitted on OpenMIC-2018's train partition with every DGE benchmark artist removed (scripts/full-mix-heads/train.py),
 * so they add no model download and no inference: about a thousand multiply-adds per head per window. */
export const FULL_MIX_FILE = 'full-mix.json';
/** The installed heads' revision (checked against the pinned file by a test). Display trusts only results from it.
 * r2 drops the violin head: the fusion violin rule (FULL_MIX_HEADS in confidentSoundSummary.ts) already passes on full
 * mixes, and adding this head on top of it cost precision. */
export const FULL_MIX_REVISION: string | undefined = 'openmic-train-2026-10-06-r2';
/** Heads were fitted on whole ten-second windows; shorter windows (loops, one-shots) are never scored. */
export const FULL_MIX_WINDOW_SECONDS = 10;
/** `replaces`: on full mixes this head alone decides its label; other models' scores for it (and FULL_MIX_FAMILY
 * relatives) are not shown. Used where the other models were measured as unreliable on full mixes (bass). */
export interface FullMixHead { label: string; weights: number[]; bias: number; threshold: number; replaces?: boolean }
/** Display labels other models use for the same instrument as a head label. */
export const FULL_MIX_FAMILY: Record<string, string[]> = { bass: ['bass', 'bass guitar', 'double bass'] };
export interface FullMixModel {
  version: 1;
  revision: string;
  /** Feature order: unit-length CLAP embedding, then logit(AST score) per `ast` label, then logit(Jamendo activation) per `jamendo` class. */
  inputs: { clap: 512; ast: string[]; jamendo: string[] };
  /** A recording's score for a label is the mean of its `top` highest window probabilities (fewer windows: all of them). */
  aggregation: { top: number };
  heads: FullMixHead[];
}
export interface FullMixWindowInput { ast?: Record<string, number>; jamendo?: Record<string, number>; clap?: number[] }
/** `score` is the recording's head probability rescaled so the head's threshold reads 0.5 (the app's likely cutoff)
 * and 1 stays 1; only labels at or above their threshold are kept. */
export interface FullMixLabel { label: string; score: number; segments: { start: number; end: number }[] }
/** `decides`: head labels that replace other models' evidence on this recording (see FullMixHead.replaces). */
export interface FullMixAnalysis { revision: string; windows: number; labels: FullMixLabel[]; decides: string[] }

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const names = (v: unknown, max: number): v is string[] => Array.isArray(v) && v.length <= max && v.every(s => typeof s === 'string' && s.length > 0 && s.length <= 80);
export function sanitizeFullMixModel(raw: unknown): FullMixModel | undefined {
  const m = raw as Partial<FullMixModel> | undefined;
  if (!m || m.version !== 1 || typeof m.revision !== 'string' || !m.revision || m.revision.length > 120) return;
  const inputs = m.inputs;
  if (!inputs || inputs.clap !== 512 || !names(inputs.ast, 200) || !names(inputs.jamendo, 200)) return;
  const top = m.aggregation?.top;
  if (!finite(top) || !Number.isInteger(top) || top < 1 || top > 50) return;
  const length = 512 + inputs.ast.length + inputs.jamendo.length;
  if (!Array.isArray(m.heads) || !m.heads.length || m.heads.length > 50) return;
  const heads: FullMixHead[] = [];
  for (const h of m.heads) {
    if (!h || typeof h.label !== 'string' || !h.label || h.label.length > 80 || !Array.isArray(h.weights) || h.weights.length !== length
      || !h.weights.every(finite) || !finite(h.bias) || !finite(h.threshold) || h.threshold <= 0 || h.threshold >= 1) return;
    if (h.replaces !== undefined && typeof h.replaces !== 'boolean') return;
    heads.push({ label: h.label, weights: h.weights, bias: h.bias, threshold: h.threshold, ...(h.replaces ? { replaces: true } : {}) });
  }
  return { version: 1, revision: m.revision, inputs: { clap: 512, ast: [...inputs.ast], jamendo: [...inputs.jamendo] }, aggregation: { top }, heads };
}

const logit = (p: number) => { const q = Math.min(1 - 1e-6, Math.max(1e-6, p)); return Math.log(q / (1 - q)); };
/** The head input for one window, or undefined while any of the three models has no output for it. */
export function fullMixFeatures(model: FullMixModel, input: FullMixWindowInput): Float64Array | undefined {
  const { ast, jamendo, clap } = input;
  if (!ast || !jamendo || !clap || clap.length !== 512) return;
  const norm = Math.hypot(...clap);
  if (!(norm > 1e-8)) return;
  const x = new Float64Array(512 + model.inputs.ast.length + model.inputs.jamendo.length);
  for (let i = 0; i < 512; i++) x[i] = clap[i] / norm;
  // A label the model returned no score for (or a silent window's empty map) counts as a zero score.
  model.inputs.ast.forEach((label, i) => { x[512 + i] = logit(finite(ast[label]) ? ast[label] : 0); });
  model.inputs.jamendo.forEach((label, i) => { x[512 + model.inputs.ast.length + i] = logit(finite(jamendo[label]) ? jamendo[label] : 0); });
  return x;
}
export function fullMixProbabilities(model: FullMixModel, x: Float64Array): number[] {
  return model.heads.map(h => {
    let z = h.bias;
    for (let i = 0; i < x.length; i++) z += h.weights[i] * x[i];
    return 1 / (1 + Math.exp(-Math.max(-35, Math.min(35, z))));
  });
}

/** Window-level head scores, combined per recording when read. Windows are keyed by their interval, so a window the
 * ordered pass and the score-ahead pass both deliver counts once. */
export class FullMixEvidence {
  private inputs = new Map<string, { start: number; end: number } & FullMixWindowInput>();
  private scored = new Map<string, number[]>();
  constructor(private model: FullMixModel) {}
  add(start: number, end: number, part: FullMixWindowInput): void {
    if (end - start < FULL_MIX_WINDOW_SECONDS - 1e-3) return;
    const key = `${start}:${end}`;
    if (this.scored.has(key)) return;
    const window = { ...(this.inputs.get(key) ?? { start, end }), ...part };
    const x = fullMixFeatures(this.model, window);
    if (!x) { this.inputs.set(key, window); return; }
    // Only the probabilities are kept once a window is complete; its raw inputs are released.
    this.inputs.delete(key);
    this.scored.set(key, fullMixProbabilities(this.model, x));
  }
  results(): FullMixAnalysis | undefined {
    if (!this.scored.size) return;
    const windows = [...this.scored].map(([key, p]) => { const [start, end] = key.split(':').map(Number); return { start, end, p }; });
    const labels: FullMixLabel[] = [];
    this.model.heads.forEach((head, h) => {
      const ranked = windows.map(w => ({ start: w.start, end: w.end, p: w.p[h] })).sort((a, b) => b.p - a.p || a.start - b.start);
      const top = ranked.slice(0, Math.min(this.model.aggregation.top, ranked.length));
      const score = top.reduce((s, w) => s + w.p, 0) / top.length;
      if (score >= head.threshold) labels.push({ label: head.label, score: Math.round((0.5 + 0.5 * (score - head.threshold) / (1 - head.threshold)) * 1e4) / 1e4,
        segments: ranked.filter(w => w.p >= head.threshold).slice(0, 3).map(w => ({ start: w.start, end: w.end })) });
    });
    return { revision: this.model.revision, windows: windows.length, labels: labels.sort((a, b) => b.score - a.score),
      decides: this.model.heads.filter(h => h.replaces).map(h => h.label) };
  }
}

export function sanitizeFullMixAnalysis(raw: unknown, durationSeconds: number): FullMixAnalysis | undefined {
  const f = raw as Partial<FullMixAnalysis> | undefined;
  if (!f || typeof f.revision !== 'string' || f.revision.length > 120 || !finite(f.windows) || !Number.isInteger(f.windows) || f.windows < 1 || f.windows > 20000 || !Array.isArray(f.labels)) return;
  const labels: FullMixLabel[] = [];
  for (const l of f.labels.slice(0, 50)) {
    if (!l || typeof l.label !== 'string' || !l.label || l.label.length > 80 || !finite(l.score) || l.score < 0 || l.score > 1 || !Array.isArray(l.segments)) continue;
    labels.push({ label: l.label, score: l.score, segments: l.segments.slice(0, 3).filter(s => s && finite(s.start) && finite(s.end) && s.start >= 0 && s.end > s.start && s.end <= durationSeconds + 1e-6)
      .map(s => ({ start: s.start, end: s.end })) });
  }
  const decides = Array.isArray(f.decides) ? f.decides.filter((l): l is string => typeof l === 'string' && l.length > 0 && l.length <= 80).slice(0, 50) : [];
  return { revision: f.revision, windows: f.windows, labels, decides };
}

/** The pinned model's revision, or undefined when this build ships no full-mix heads. Display only trusts stored
 * results from the installed revision; a model change makes every analysis stale (INSTRUMENT_ANALYSIS_REVISION). */
export const FULL_MIX_PINNED = Boolean((soundManifest.sha256 as Record<string, string>)[FULL_MIX_FILE]);
let loading: Promise<FullMixModel | undefined> | undefined;
/** Fetch and check the pinned heads once. A missing, altered or malformed file leaves analysis exactly as it was. */
export function loadFullMixHeads(): Promise<FullMixModel | undefined> {
  const pinned = (soundManifest.sha256 as Record<string, string>)[FULL_MIX_FILE];
  if (!pinned || typeof fetch === 'undefined') return Promise.resolve(undefined);
  const attempt = loading ??= (async () => {
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}sound-model/${FULL_MIX_FILE}?v=${pinned.slice(0, 12)}`);
      if (!response.ok) return;
      const bytes = await response.arrayBuffer();
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
      return hash === pinned ? sanitizeFullMixModel(JSON.parse(new TextDecoder().decode(bytes))) : undefined;
    } catch { return undefined; }
  })();
  // Only a successful load is kept: a failed one is retried by the next analysis.
  void attempt.then(model => { if (!model && loading === attempt) loading = undefined; });
  return attempt;
}

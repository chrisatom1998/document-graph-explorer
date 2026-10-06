import type { DescriptionScore } from './profileDescriptions';
import { EVENT_FEATURE_NAMES, EVENT_FEATURE_VERSION } from './eventFeatures';

/** Heads trained and thresholded on short one-shots only (uploader/preset-held-out development data).
 * clapRepeat is the app's normal CLAP fingerprint (the model repeats a short clip to fill 10 s); clapZero follows
 * the clip with silence instead. AST pads its own features; event features read the unchanged audio. Nothing is stretched. */
/** Longest clip the one-shot benchmark measured; longer audio keeps the existing analysis. */
export const SHORT_CLIP_MAX_SECONDS = 2.25;
export type ShortClipBlock = 'clapRepeat' | 'clapZero' | 'ast' | 'event';
export const SHORT_CLIP_BLOCK_SIZES: Record<ShortClipBlock, number> = { clapRepeat: 512, clapZero: 512, ast: 527, event: EVENT_FEATURE_NAMES.length };
export interface ShortClipHead { group: 'source' | 'production' | 'character'; label: string; weights: number[]; bias: number; threshold: number; maybe?: boolean }
export interface ShortClipModel {
  version: 1;
  kind: 'short-clip-heads';
  revision: string;
  clapEncoder: string;
  astModel?: string;
  eventFeatures: string;
  blocks: ShortClipBlock[];
  /** Applies only to clips no longer than this; longer audio keeps the existing analysis. */
  maxSeconds: number;
  mean: number[];
  std: number[];
  heads: ShortClipHead[];
}
export interface ShortClipInputs { clapRepeat?: ArrayLike<number>; clapZero?: ArrayLike<number>; ast?: ArrayLike<number>; event?: ArrayLike<number> }

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
export function sanitizeShortClipModel(raw: unknown): ShortClipModel | undefined {
  if (!raw || typeof raw !== 'object') return;
  const m = raw as Partial<ShortClipModel>;
  if (m.version !== 1 || m.kind !== 'short-clip-heads' || typeof m.revision !== 'string' || typeof m.clapEncoder !== 'string') return;
  if (m.eventFeatures !== EVENT_FEATURE_VERSION || !finite(m.maxSeconds) || m.maxSeconds <= 0 || m.maxSeconds > SHORT_CLIP_MAX_SECONDS) return;
  if (!Array.isArray(m.blocks) || !m.blocks.length || m.blocks.some(b => !(b in SHORT_CLIP_BLOCK_SIZES)) || new Set(m.blocks).size !== m.blocks.length) return;
  if (m.blocks.includes('ast') && typeof m.astModel !== 'string') return;
  const width = m.blocks.reduce((n, b) => n + SHORT_CLIP_BLOCK_SIZES[b], 0);
  if (!Array.isArray(m.mean) || !Array.isArray(m.std) || m.mean.length !== width || m.std.length !== width || !m.mean.every(finite) || !m.std.every(v => finite(v) && v > 0)) return;
  if (!Array.isArray(m.heads) || m.heads.length > 200 || m.heads.some(h => !h || !['source', 'production', 'character'].includes(h.group) || typeof h.label !== 'string' || !h.label
    || h.label.length > 80 || !Array.isArray(h.weights) || h.weights.length !== width || !h.weights.every(finite) || !finite(h.bias)
    || !finite(h.threshold) || h.threshold < .5 || h.threshold > 1 || (h.maybe !== undefined && typeof h.maybe !== 'boolean'))) return;
  return { version: 1, kind: 'short-clip-heads', revision: m.revision, clapEncoder: m.clapEncoder, ...(m.astModel ? { astModel: m.astModel } : {}),
    eventFeatures: m.eventFeatures, blocks: [...m.blocks], maxSeconds: m.maxSeconds, mean: m.mean, std: m.std, heads: m.heads };
}

function vector(model: ShortClipModel, inputs: ShortClipInputs): number[] | undefined {
  const out: number[] = [];
  for (const block of model.blocks) {
    const values = inputs[block];
    if (!values || values.length !== SHORT_CLIP_BLOCK_SIZES[block]) return;
    const raw = Array.from(values);
    if (!raw.every(Number.isFinite)) return;
    // Same scaling as scripts/train-short-clip-heads.py: unit-length CLAP, AST logits / 10, event features as computed.
    if (block === 'clapZero' || block === 'clapRepeat') { const n = Math.hypot(...raw) + 1e-9; out.push(...raw.map(v => v / n)); }
    else if (block === 'ast') out.push(...raw.map(v => v / 10));
    else out.push(...raw);
  }
  return out.map((v, i) => (v - model.mean[i]) / model.std[i]);
}

/** A one-shot tag implied by another head's tag: any voice that is the whole clip (≤ 2.25 s) is a vocal one-shot.
 * The derived tag reuses the voice head's own score and threshold, so it shows exactly when "voice" does, and steps
 * aside if a head trained for the role itself ever ships. The one-shot benchmark's vocal one-shot answers are the
 * same clips as its voice answers (scripts/build-short-clip-bench.py), so this inherits the voice head's test result. */
export const SHORT_CLIP_DERIVED: readonly { from: string; group: ShortClipHead['group']; label: string }[] = [
  { from: 'source:voice', group: 'production', label: 'vocal one-shot' },
];
/** Head probabilities for one short clip; only heads at or above their measured threshold become tags. */
export function shortClipScores(model: ShortClipModel, inputs: ShortClipInputs): { scores: DescriptionScore[]; raw: Record<string, number> } {
  const x = vector(model, inputs);
  const raw: Record<string, number> = {};
  const scores: DescriptionScore[] = [];
  if (!x) return { scores, raw };
  for (const head of model.heads) {
    const logit = head.bias + head.weights.reduce((sum, w, i) => sum + w * x[i], 0);
    const score = 1 / (1 + Math.exp(-Math.max(-35, Math.min(35, logit))));
    raw[`${head.group}:${head.label}`] = Math.round(score * 1e4) / 1e4;
    if (score >= head.threshold) scores.push({ group: 'dj-learned', label: head.label, score, learnedGroup: head.group, decision: 'include', basis: 'head', ...(head.maybe ? { maybe: true } : {}) });
  }
  for (const rule of SHORT_CLIP_DERIVED) {
    if (model.heads.some(h => h.group === rule.group && h.label === rule.label)) continue;
    const parent = scores.find(s => `${s.learnedGroup}:${s.label}` === rule.from);
    if (parent) scores.push({ ...parent, label: rule.label, learnedGroup: rule.group });
  }
  return { scores, raw };
}

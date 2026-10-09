import { canonicalDjLabel, DJ_LABELS, type DjGroup } from './djTags';
import { confidentSoundSummary } from './confidentSoundSummary';
import { confirmedInstrumentList, sourceReviewAllows } from './instrumentEvidence';
import { djReviewAllows, resolvedNonSourceLabels } from './soundReviewPolicy';
import { dimensionLabels, type Interval } from './recognition';
import { TAGGER_SCORE, TAGGER_MAYBE_SCORE } from './tagger';
import type { MusicAnalysis } from './musicTypes';

export const LUNA_MODEL = 'gpt-6-luna';
export const LUNA_POLICY = 'normalization-routing-v1';
export const LUNA_TAXONOMY: Record<DjGroup, readonly string[]> = {
  source: dimensionLabels.source, production: [...new Set([...DJ_LABELS.production, ...dimensionLabels.effect])],
  character: dimensionLabels.character,
};
const aliases: Record<string, string> = { vocals: 'voice', vocal: 'voice', singing: 'voice',
  'hi hat': 'hi-hat', hihat: 'hi-hat', 'violin, fiddle': 'violin / fiddle',
  'marimba, xylophone': 'marimba / xylophone', 'steel guitar, slide guitar': 'steel guitar / slide guitar' };
export function canonicalLunaLabel(group: DjGroup, raw: string): string | null {
  const label = raw.trim().toLowerCase();
  if (LUNA_TAXONOMY[group].includes(label)) return label;
  const alias = canonicalDjLabel(group, label) ?? (group === 'source' ? aliases[label] : undefined);
  return alias && LUNA_TAXONOMY[group].includes(alias) ? alias : null;
}
export interface LunaLabel {
  id: string; group: DjGroup; originalLabel: string; sourceModel: string;
  score: number | null; supported: boolean; ambiguous: boolean;
  /** Null means unknown coverage; never infer a whole recording from an aggregate. */
  coverage: Interval[] | null;
}
export interface LunaSample {
  ref: string; durationSeconds: number; labels: LunaLabel[];
  locked: Record<DjGroup, boolean>; protectedLabels: Record<DjGroup, string[]>;
  truncated: boolean;
}
export interface NormalizedLabel extends LunaLabel {
  canonicalLabel: string | null; method: 'deterministic' | 'luna' | 'unresolved' | 'protected';
}
export type RoutingSignal = 'detector-disagreement' | 'few-supported-labels' | 'ambiguous-evidence';
export interface LunaSampleResult { ref: string; labels: NormalizedLabel[]; signals: RoutingSignal[];
  review: 'recommend' | 'skip' | 'abstain'; reason: string }
export interface LunaReport { model: typeof LUNA_MODEL; policy: typeof LUNA_POLICY; samples: LunaSampleResult[];
  status: 'complete' | 'fallback'; cached: boolean; usage?: { inputTokens: number; outputTokens: number; cachedInputTokens: number }; }
const groupFor = (dimension: string): DjGroup | null => dimension === 'effect' ? 'production' : dimension === 'source' || dimension === 'character' ? dimension : null;

/** Copy only machine evidence. No titles, paths, notes, waveforms, or confirmed answers. */
export function lunaEvidence(audio: MusicAnalysis, index: number): LunaSample {
  const shown = confidentSoundSummary(audio).filter(s => s.origin === 'model estimate');
  const acceptedEvidence = new Set(audio.recognition?.observations.filter(o => o.status === 'accepted').flatMap(o => o.evidenceIds) ?? []);
  const supportedShown = new Set(shown.filter(s => !s.maybe && !s.uncalibrated).map(s => `${s.dimension}:${s.label}`));
  const labels: LunaLabel[] = [];
  let truncated = false;
  const add = (group: DjGroup, originalLabel: string, sourceModel: string, score: number | null, coverage: Interval[] | null, supported: boolean, ambiguous: boolean) => {
    const previous = labels.find(l => l.group === group && l.originalLabel === originalLabel && l.sourceModel === sourceModel && l.score === score && l.supported === supported && l.ambiguous === ambiguous);
    if (previous) {
      if (coverage) {
        const windows = [...(previous.coverage ?? []), ...coverage];
        truncated ||= windows.length > 128; previous.coverage = windows.slice(0, 128);
      }
      previous.supported ||= supported; previous.ambiguous ||= ambiguous;
      return;
    }
    labels.push({ id: `e${labels.length + 1}`, group, originalLabel, sourceModel, score, coverage, supported, ambiguous });
  };
  for (const s of shown) {
    const group = groupFor(s.dimension); if (!group) continue;
    for (const score of s.scores ?? []) {
      const modelId = ({ 'AST score': 'ast', 'Jamendo score': 'jamendo', 'CLAP similarity': 'clap' } as Record<string, string>)[score.model];
      const native = modelId ? audio.recognition?.evidence.filter(e => e.modelId === modelId && e.labelId === s.label && e.dimension === s.dimension) : undefined;
      const fullMix = score.model === 'Full-mix head score' ? audio.fullMix?.labels.find(l => l.label === s.label) : undefined;
      const coverage = score.model === TAGGER_SCORE || score.model === TAGGER_MAYBE_SCORE ? audio.tagger?.intervals ?? null
        : native?.length ? native.map(e => ({ start: e.start, end: e.end }))
        : fullMix?.windowEvidence?.windows.map(w => ({ start: w.start, end: w.end })) ?? fullMix?.segments ?? null;
      truncated ||= (coverage?.length ?? 0) > 128;
      add(group, s.label, score.model, score.score, coverage?.slice(0, 128) ?? null, !s.maybe && !s.uncalibrated, !!s.maybe || !!s.coverageUnknown);
    }
  }
  // Previously accepted AI suggestions remain proposals, with their listening provenance.
  const proposal = audio.copilotProperties;
  if (proposal) for (const group of ['source', 'production', 'character'] as const) for (const label of proposal.tags[group]) {
    const excerpt = proposal.audioExcerpt;
    add(group, label, proposal.model, null, excerpt ? [{ start: excerpt.startSeconds, end: excerpt.startSeconds + excerpt.durationSeconds }] : null, false, false);
  }
  // Retain raw detector names even when a display projection uses a canonical alias.
  for (const e of audio.recognition?.evidence ?? []) {
    const group = groupFor(e.dimension); if (!group) continue;
    const accepted = supportedShown.has(`${e.dimension}:${e.labelId}`) && acceptedEvidence.has(e.id);
    add(group, e.labelId, e.modelId, e.score, [{ start: e.start, end: e.end }], accepted, !accepted);
  }
  for (const t of audio.soundProfile?.djTags ?? []) add(t.group, t.label, t.model ?? 'Sound tag model', t.score,
    t.windowEvidence?.windows.map(w => ({ start: w.start, end: w.end })) ?? t.segments ?? null,
    shown.some(s => s.label === t.label), false);
  for (const t of audio.instruments) add('source', t.label, 'Instrument model', t.score,
    t.windowEvidence?.windows.map(w => ({ start: w.start, end: w.end })) ?? t.segments ?? null,
    shown.some(s => s.label === t.label), false);
  const confirmedNonSource = resolvedNonSourceLabels(audio).filter(l => l.source === 'confirmed');
  const protectedLabels = Object.fromEntries((Object.keys(LUNA_TAXONOMY) as DjGroup[]).map(group => [group,
    LUNA_TAXONOMY[group].filter(label => (group === 'source' ? !sourceReviewAllows(audio, label) : !djReviewAllows(audio, group, label)) || confirmedNonSource.some(l => l.group === group && l.label === label))])) as Record<DjGroup, string[]>;
  return parseLunaSamples([{ ref: `Sample ${index + 1}`, durationSeconds: audio.durationSeconds,
    labels: labels.slice(0, 64), truncated: truncated || labels.length > 64,
    locked: { source: confirmedInstrumentList(audio) !== undefined, production: audio.confirmedDjTags !== undefined, character: audio.confirmedDjTags !== undefined }, protectedLabels }], false)[0];
}
const groups: DjGroup[] = ['source', 'production', 'character'];
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
/** Strict allowlist at both boundaries; unexpected payload properties never go upstream. */
export function parseLunaSamples(value: unknown, sequential = true): LunaSample[] {
  if (!Array.isArray(value) || !value.length || value.length > 5) throw Error('Choose one to five sounds.');
  const refs = new Set<string>();
  return value.map((v, i) => {
    if (!v || !/^Sample [1-5]$/.test(v.ref) || refs.has(v.ref) || (sequential && v.ref !== `Sample ${i + 1}`) ||
      !finite(v.durationSeconds) || v.durationSeconds < 0 || v.durationSeconds > 86400 || typeof v.truncated !== 'boolean' ||
      !Array.isArray(v.labels) || v.labels.length > 64 || !v.locked || !v.protectedLabels) throw Error('Invalid Luna evidence.');
    refs.add(v.ref);
    const locked = {} as Record<DjGroup, boolean>, protectedLabels = {} as Record<DjGroup, string[]>;
    for (const g of groups) {
      if (typeof v.locked[g] !== 'boolean' || !Array.isArray(v.protectedLabels[g]) || v.protectedLabels[g].length > LUNA_TAXONOMY[g].length || v.protectedLabels[g].some((l: unknown) => typeof l !== 'string' || !LUNA_TAXONOMY[g].includes(l))) throw Error('Invalid protected labels.');
      locked[g] = v.locked[g]; protectedLabels[g] = [...new Set<string>(v.protectedLabels[g])];
    }
    const ids = new Set<string>();
    const labels = v.labels.map((l: LunaLabel): LunaLabel => {
      if (!l || !/^e\d{1,4}$/.test(l.id) || ids.has(l.id) || !groups.includes(l.group) ||
        typeof l.originalLabel !== 'string' || !l.originalLabel.trim() || l.originalLabel.length > 100 ||
        typeof l.sourceModel !== 'string' || !l.sourceModel.trim() || l.sourceModel.length > 100 ||
        (l.score !== null && (!finite(l.score) || l.score < 0 || l.score > 1)) || typeof l.supported !== 'boolean' || typeof l.ambiguous !== 'boolean' ||
        (l.coverage !== null && (!Array.isArray(l.coverage) || l.coverage.length > 128 || l.coverage.some(w => !w || !finite(w.start) || !finite(w.end) || w.start < 0 || w.end <= w.start || w.end > v.durationSeconds + 1e-6)))) throw Error('Invalid detector label.');
      ids.add(l.id);
      return { id: l.id, group: l.group, originalLabel: l.originalLabel, sourceModel: l.sourceModel, score: l.score,
        supported: l.supported, ambiguous: l.ambiguous, coverage: l.coverage?.map(w => ({ start: w.start, end: w.end })) ?? null };
    });
    return { ref: v.ref, durationSeconds: v.durationSeconds, locked, protectedLabels, truncated: v.truncated, labels };
  });
}
export function deterministicLuna(sample: LunaSample): LunaSampleResult {
  const labels: NormalizedLabel[] = sample.labels.map(l => {
    const canonicalLabel = canonicalLunaLabel(l.group, l.originalLabel);
    const protectedLabel = sample.locked[l.group] || (canonicalLabel !== null && sample.protectedLabels[l.group].includes(canonicalLabel));
    return { ...l, canonicalLabel, method: protectedLabel ? 'protected' : canonicalLabel ? 'deterministic' : 'unresolved' };
  });
  const supported = labels.filter(l => l.supported && l.canonicalLabel && l.method !== 'protected');
  const signals: RoutingSignal[] = [];
  // Different detector sets are a reason to inspect, not proof that either detector is wrong.
  const sets = new Map<string, Set<string>>();
  for (const l of supported) {
    const model = ({ 'AST score': 'ast', 'Jamendo score': 'jamendo', 'CLAP similarity': 'clap' } as Record<string, string>)[l.sourceModel] ?? l.sourceModel;
    const set = sets.get(model) ?? new Set(); set.add(`${l.group}:${l.canonicalLabel}`); sets.set(model, set);
  }
  if (new Set([...sets.values()].map(s => [...s].sort().join('|'))).size > 1) signals.push('detector-disagreement');
  if (new Set(supported.map(l => `${l.group}:${l.canonicalLabel}`)).size < 2 && groups.some(g => !sample.locked[g])) signals.push('few-supported-labels');
  if (groups.some(g => !sample.locked[g]) && (sample.truncated || labels.some(l => l.method !== 'protected' && (l.ambiguous || l.coverage === null || l.method === 'unresolved')))) signals.push('ambiguous-evidence');
  return { ref: sample.ref, labels, signals, review: 'abstain', reason: signals.length ? 'Metadata indicates possible review needs; no audio has been heard.' : 'No metadata review trigger.' };
}

/** Semantic validation is required even when the provider claims schema conformance. */
export function mergeLunaResponse(value: unknown, samples: LunaSample[]): LunaSampleResult[] {
  const root = value as { samples?: unknown[] } | null;
  if (!root || Object.keys(root).join() !== 'samples' || !Array.isArray(root.samples) || root.samples.length !== samples.length) throw Error('Invalid Luna response.');
  const seen = new Set<string>();
  const results = root.samples.map(raw => {
    const v = raw as { ref: string; normalizations: { id: string; canonicalLabel: string | null }[]; review: LunaSampleResult['review']; reason: string };
    const sample = samples.find(s => s.ref === v?.ref);
    if (!sample || seen.has(v.ref) || Object.keys(v).some(k => !['ref', 'normalizations', 'review', 'reason'].includes(k)) ||
      !['recommend', 'skip', 'abstain'].includes(v.review) || typeof v.reason !== 'string' || !v.reason.trim() || v.reason.length > 400 || /\d\s*(?:%|percent|per cent)|(?:confidence|probability)\s*[:=]?\s*\d/i.test(v.reason) || !Array.isArray(v.normalizations)) throw Error('Invalid Luna recommendation.');
    seen.add(v.ref);
    const result = deterministicLuna(sample), ids = new Set<string>();
    for (const mapping of v.normalizations) {
      const label = result.labels.find(l => l.id === mapping?.id);
      if (!label || ids.has(mapping.id) || label.method !== 'unresolved' || Object.keys(mapping).some(k => !['id', 'canonicalLabel'].includes(k)) ||
        (mapping.canonicalLabel !== null && !LUNA_TAXONOMY[label.group].includes(mapping.canonicalLabel))) throw Error('Invalid Luna normalization.');
      ids.add(mapping.id);
      if (mapping.canonicalLabel !== null && !sample.protectedLabels[label.group].includes(mapping.canonicalLabel)) {
        label.canonicalLabel = mapping.canonicalLabel; label.method = 'luna';
      }
    }
    // No trigger is not permission to invent a new routing rationale.
    return { ...result, review: result.signals.length ? v.review : 'skip' as const, reason: v.reason };
  });
  return samples.map(s => results.find(r => r.ref === s.ref)!);
}

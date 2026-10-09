import { score } from '../audio-listening/score.mjs';
export function comparison(items, records) {
  const result = score(items, records);
  for (const mode of ['lunaNormalized', 'lunaRouted']) {
    result[mode] = score(items, records.map(r => ({ ...r, native: r[mode] ?? r.native }))).native;
  }
  for (const [mode, metrics] of Object.entries(result)) {
    const eligible = records.filter(r => !r.error);
    const predictions = r => mode === 'native' ? r.native : mode === 'audio' ? r.audio : mode === 'union' ? [...r.native, ...r.audio]
      : mode === 'agreement' ? r.native.filter(c => r.audio.includes(c)) : mode === 'fallback' ? r.native.length ? r.native : r.audio : r[mode] ?? r.native;
    metrics.coverage = { requested: items.length, paired: metrics.evaluated, labeled: eligible.filter(r => predictions(r).length).length,
      abstentions: eligible.filter(r => !predictions(r).length).length, failed: records.filter(r => r.error).length };
  }
  for (const metrics of Object.values(result)) {
    metrics.regressions = Object.entries(metrics.classes).flatMap(([label, values]) => {
      const base = result.native.classes[label];
      return values.fp > base.fp || values.fn > base.fn ? [{ label, additionalFalsePositives: values.fp - base.fp, additionalMisses: values.fn - base.fn }] : [];
    });
  }
  return result;
}
// Bill conservatively if modality details are absent; do not silently price audio as text.
export function audioCost(usage) {
  if (!usage || !Number.isInteger(usage.prompt_tokens) || !Number.isInteger(usage.completion_tokens)) return null;
  const audio = usage.prompt_tokens_details?.audio_tokens;
  return { usd: (Number.isInteger(audio) ? audio * 32 + (usage.prompt_tokens - audio) * 2.5 : usage.prompt_tokens * 32) / 1e6 + usage.completion_tokens * 10 / 1e6,
    basis: Number.isInteger(audio) ? 'standard rate estimate, no cache discount' : 'upper bound: all input priced as audio' };
}
export class Budget {
  constructor(limit = 5) { if (!Number.isFinite(limit) || limit <= 0 || limit > 5) throw Error('Budget must be >0 and <= $5.'); this.limit = limit; this.charged = 0; this.pending = []; }
  reserve(usd) { if (!Number.isFinite(usd) || usd < 0 || this.charged + usd > this.limit) return false; this.charged += usd; this.pending.push(usd); return true; }
  settle(reserved, actual) { const index = this.pending.indexOf(reserved); if (index < 0) throw Error('Unknown or settled reservation.'); this.pending.splice(index, 1); if (actual !== null && actual >= 0 && actual <= reserved) this.charged -= reserved - actual; }
}
// Thread count is a recorded compute choice, not a different model/policy version.
export function sameDetectorConfiguration(actual, current) {
  const normalize = value => typeof value === 'string' ? value.replace(/wasm-threads-[1-4]-jamendo-1-v2/g, 'wasm-threads-N-jamendo-1-v2') : null;
  return typeof actual === 'string' && normalize(actual) === normalize(current);
}

// Deterministic local results make no billable request; unknown provider usage keeps the reservation.
export function lunaCost(usage, noRequest = false) {
  if (noRequest) return 0;
  if (!usage || !Number.isInteger(usage.inputTokens) || usage.inputTokens < 0 || !Number.isInteger(usage.outputTokens) || usage.outputTokens < 0) return null;
  const longContext = usage.inputTokens > 272000;
  return (usage.inputTokens * .125 * (longContext ? 2 : 1) + usage.outputTokens * .5 * (longContext ? 1.5 : 1)) / 1e6;
}

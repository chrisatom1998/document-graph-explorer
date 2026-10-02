import { INSTRUMENT_LABELS } from './instrumentLabels';
export interface SoundPrompt { label: string | null; vector: number[]; }
export interface SoundSuggestion { label: string; score: number; margin: number; }

/** Cosine similarity against fixed sound descriptions, including non-instrument controls. */
export function soundSuggestions(embedding: ArrayLike<number>, prompts: SoundPrompt[]): SoundSuggestion[] {
  const audio = Array.from(embedding);
  const norm = Math.hypot(...audio);
  if (!norm || !Number.isFinite(norm)) return [];
  const scores = prompts.filter(p => p.vector.length === audio.length).map(p => ({
    label: p.label,
    score: p.vector.reduce((sum, x, i) => sum + x * audio[i], 0) / (Math.hypot(...p.vector) * norm),
  })).filter(p => Number.isFinite(p.score)).sort((a, b) => b.score - a.score);
  // Non-musical or vocal controls must not be forced into an instrument class.
  if (!scores[0]?.label) return [];
  const best = new Map<string, number>();
  for (const { label, score } of scores) {
    if (label && INSTRUMENT_LABELS.includes(label) && score >= 0.3 && scores[0].score - score <= 0.12 && !best.has(label)) best.set(label, Math.min(1, score));
  }
  return [...best].slice(0, 2).map(([label, score]) => ({ label, score,
    margin: Math.max(0, score - (scores.find(candidate => candidate.label !== label)?.score ?? score)),
  }));
}

/** Only name a primary instrument when a majority of sampled passages agree. */
export function primaryInstrument(passages: SoundSuggestion[][]): SoundSuggestion | undefined {
  for (const passage of passages) {
    const top = passage[0];
    if (!top) continue;
    const agreeing = passages.flatMap(p => p[0]?.label === top.label ? [p[0]] : []);
    if (agreeing.length > passages.length / 2) return {
      label: top.label,
      score: Math.min(...agreeing.map(p => p.score)),
      margin: Math.min(...agreeing.map(p => p.margin)),
    };
  }
  return undefined;
}

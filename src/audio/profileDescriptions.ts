import { CHARACTER_LABELS, RESEMBLANCE_LABELS, ROLE_LABELS, VOCAL_LABELS } from './soundProfile';
export type DescriptionGroup = 'source' | 'articulation' | 'tone' | 'space' | 'role' | 'vocal' | 'sample' | 'dj-type' | 'breath' | 'dj-tone' | 'dj-rhythm' | `dj-${string}`;
export interface DescriptionScore { group: DescriptionGroup; label: string | null; score: number; alternative?: string; learnedGroup?: 'source' | 'production' | 'character'; decision?: 'include' | 'exclude'; /** Set when a trained head, not a reviewed example, produced this score. */ basis?: 'head'; }
export interface DescriptionPrompt { group: DescriptionGroup; label: string | null; vector: number[]; prompt?: string; }
export function descriptionScores(embedding: ArrayLike<number>, prompts: DescriptionPrompt[]): DescriptionScore[] {
  const audio = Array.from(embedding); const norm = Math.hypot(...audio);
  if (!norm || !Number.isFinite(norm)) return [];
  return prompts.flatMap(p => {
    if (p.vector.length !== audio.length) return [];
    const score = p.vector.reduce((sum, x, i) => sum + x * audio[i], 0) / (Math.hypot(...p.vector) * norm);
    return Number.isFinite(score) ? [{ group: p.group, label: p.label, score: Math.max(-1, Math.min(1, score)), ...(p.label === null && p.prompt ? {alternative:p.prompt} : {}) }] : [];
  });
}
export function averageDescriptions(passages: DescriptionScore[][]): DescriptionScore[] {
  if (!passages.length) return [];
  const all = new Map<string, DescriptionScore>();
  for (const passage of passages) {
    const seen = new Set<string>();
    for (const p of passage) {
      const key = `${p.group}:${p.label}:${p.alternative ?? ""}:${p.learnedGroup ?? ""}:${p.decision ?? ""}`;
      if (seen.has(key) || !Number.isFinite(p.score)) continue;
      seen.add(key);
      const previous = all.get(key);
      all.set(key, { ...p, score: (previous?.score ?? 0) + p.score / passages.length });
    }
  }
  return [...all.values()];
}
/** Compare within each descriptive axis. Scores are similarity, not probabilities. */
export function selectDescriptions(scores: DescriptionScore[]) {
  const ranking = (group: DescriptionGroup) => scores.filter(s => s.group === group).sort((a,b) => b.score-a.score);
  const source = ranking('source');
  const sources = source[0]?.label && source[0].score >= .30
    ? source.filter(s => s.label && RESEMBLANCE_LABELS.includes(s.label) && s.score >= .30 && source[0].score-s.score <= .08).slice(0, 3).map(s => ({ label: s.label!, score: s.score })) : [];
  const choose = (group: DescriptionGroup, allowed: string[]) => {
    const list = ranking(group); const top = list[0];
    return top?.label && allowed.includes(top.label) && top.score >= .28 && top.score - (list[1]?.score ?? 0) >= .025 ? [top.label] : [];
  };
  const vocal = ranking('vocal');
  // Processed voices may lose speech/instrument cues. Require a much clearer
  // CLAP lead over both vocal and non-vocal alternatives to suggest voice alone.
  const sample = ranking('sample');
  // Compare chops against other sampled/instrumental sounds, rather than
  // requiring chopped syllables to resemble continuous speech or singing.
  const chopSource = sample[0]?.label === 'vocal chops' && sample[0].score >= .35 && sample[0].score - (sample[1]?.score ?? 0) >= .05;
  const vocalSource = !!vocal[0]?.label && VOCAL_LABELS.includes(vocal[0].label) && vocal[0].score >= .35 && vocal[0].score - (vocal[1]?.score ?? 0) >= .10;
  // Preserve the exact qualifying prompt, rather than relabeling its similarity
  // as a direct voice score or selecting an unrelated higher-scoring prompt.
  const vocalSourceEvidence = chopSource ? { group: 'sample' as const, labelId: 'vocal chops', score: sample[0].score }
    : vocalSource ? { group: 'vocal' as const, labelId: vocal[0].label!, score: vocal[0].score } : undefined;
  return { sources, vocalSource: vocalSource || chopSource, vocalSourceEvidence, vocalStyle: chopSource ? 'vocal chops' : choose('vocal', VOCAL_LABELS)[0], sourceClear: !!source[0]?.label && source[0].score - (source[1]?.score ?? 0) >= .025, character: (['articulation','tone','space'] as const).flatMap(g => choose(g, CHARACTER_LABELS)), roles: choose('role', ROLE_LABELS) };
}

/** Bounded memory even when Full mode scans hours of audio. */
export class DescriptionAccumulator {
  private sums = new Map<string,DescriptionScore>();
  private count = 0;
  private reviewed = new Map<string, DescriptionScore>();
  add(scores: DescriptionScore[]) {
    this.count++;
    const seen = new Set<string>();
    for (const score of scores) {
      if(score.group === 'dj-learned' && score.learnedGroup && score.label && score.decision && Number.isFinite(score.score)) {
        const key=`${score.learnedGroup}:${score.label}:${score.decision}`;
        if(score.score > (this.reviewed.get(key)?.score ?? -1))this.reviewed.set(key,{...score});
        continue;
      }
      const key=`${score.group}:${score.label}:${score.alternative ?? ""}:${score.learnedGroup ?? ""}:${score.decision ?? ""}`;
      if (seen.has(key) || !Number.isFinite(score.score)) continue;
      seen.add(key);
      this.sums.set(key,{...score,score:(this.sums.get(key)?.score??0)+score.score});
    }
  }
  average(): DescriptionScore[] {
    if(!this.count)return [];
    // An instrument can occur in only one section. Conflicting reviewed sections abstain.
    const reviewed=[...this.reviewed.values()].filter(s=>{
      const opposite=this.reviewed.get(`${s.learnedGroup}:${s.label}:${s.decision==='include'?'exclude':'include'}`);
      return !opposite || s.score-opposite.score >= .04;
    });
    return [...this.sums.values()].map(s=>({...s,score:s.score/this.count})).concat(reviewed);
  }
}

import model from './genreEnergyModel.json';

/** Discogs style scores ride in the Jamendo window map under this prefix (the EffnetDiscogs model's own output). */
export const STYLE_PREFIX = 'style:';
/** Per-window probability of the energy head (a linear head on the same EffnetDiscogs embedding). */
export const ENERGY_KEY = 'energy:high';
export const isGenreEnergyScore = (key: string) => key.startsWith(STYLE_PREFIX) || key === ENERGY_KEY;
/** Part of the saved-feature cache key and of saved genre scores: a refit head must not reuse the old one's output. */
export const GENRE_ENERGY_VERSION = model.version;
/** How many Discogs styles a track keeps for display. */
export const KEPT_STYLES = model.genre.keptStyles;

export type EnergyLevel = 'low' | 'medium' | 'high';
export interface TrackStyle { label: string; score: number }
export interface GenreEstimate { label: string; score: number; tested: boolean }
export interface EnergyEstimate { level: EnergyLevel; score: number; tested: boolean }

const ENERGY_WEIGHTS = Float64Array.from(model.energy.weights);
/** Fitted by scripts/genre-energy/fit.py on MTG-Jamendo split-0 train/validation tracks tagged high or low energy. */
export function energyLogit(embedding: ArrayLike<number>): number {
  if (embedding.length !== ENERGY_WEIGHTS.length) return 0;
  let z = model.energy.bias;
  for (let i = 0; i < ENERGY_WEIGHTS.length; i++) z += ENERGY_WEIGHTS[i] * embedding[i];
  return Number.isFinite(z) ? z : 0;
}
const logit = (p: number) => { const q = Math.min(1 - 1e-6, Math.max(1e-6, p)); return Math.log(q / (1 - q)); };

const GENRES: readonly string[] = model.genre.classes;
const STYLE_INDEX = new Map(model.genre.styles.map((label, i) => [label, i]));
const GENRE_WEIGHTS = model.genre.weights.map(row => Float64Array.from(row));

/** Genre probabilities from mean Discogs style scores: a softmax head fitted on Beatport genres
 * (scripts/genre-energy/fit.py, on GiantSteps tracks no test round uses). */
export function genreProbabilities(styles: ReadonlyMap<string, number>): Record<string, number> {
  if (!GENRES.length || !styles.size) return {};
  const x = new Float64Array(STYLE_INDEX.size).fill(Math.log(1e-4));
  for (const [label, score] of styles) { const i = STYLE_INDEX.get(label); if (i !== undefined) x[i] = Math.log(Math.min(1, Math.max(1e-4, score))); }
  const z = GENRE_WEIGHTS.map((w, g) => { let s = model.genre.bias[g]; for (let i = 0; i < w.length; i++) s += w[i] * x[i]; return s; });
  const top = Math.max(...z), e = z.map(v => Math.exp(v - top)), sum = e.reduce((a, b) => a + b, 0);
  return Object.fromEntries(GENRES.map((g, i) => [g, +(e[i] / sum).toFixed(4)]));
}

/** Recording-level style and energy scores: plain means over every analysed window (energy as a mean logit, which
 * equals the head applied to the mean embedding it was fitted on). */
export class GenreEnergyScores {
  private styles = new Map<string, number>();
  private energy = 0;
  private windows = 0;
  private energyWindows = 0;
  add(scores: Record<string, number>): this {
    let any = false;
    for (const [key, score] of Object.entries(scores)) {
      if (!Number.isFinite(score) || score < 0 || score > 1) continue;
      if (key === ENERGY_KEY) { this.energy += logit(score); this.energyWindows++; }
      else if (key.startsWith(STYLE_PREFIX)) { any = true; const label = key.slice(STYLE_PREFIX.length); this.styles.set(label, (this.styles.get(label) ?? 0) + score); }
    }
    if (any) this.windows++;
    return this;
  }
  private means(): Map<string, number> { return new Map([...this.styles].map(([label, sum]) => [label, sum / this.windows])); }
  /** The strongest styles, as stored on the track for display. */
  styleList(): TrackStyle[] {
    if (!this.windows) return [];
    return [...this.means()].map(([label, score]) => ({ label, score: +score.toFixed(4) }))
      .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label)).slice(0, KEPT_STYLES);
  }
  genreScores(): Record<string, number> { return this.windows ? genreProbabilities(this.means()) : {}; }
  energyScore(): number | undefined {
    return this.energyWindows ? +(1 / (1 + Math.exp(-this.energy / this.energyWindows))).toFixed(4) : undefined;
  }
}

type Family = { label: string; members: string[]; threshold: number; tested: boolean };
const FAMILIES: readonly Family[] = model.genre.families;
/** Labels a track can show: Beatport genres, and families (house, techno, trance…) for tracks whose exact subgenre
 * is unclear. `tested` means precision and recall both reached 70% on tracks no tuning used. */
export const GENRE_LABELS = [...GENRES, ...FAMILIES.map(f => f.label)].filter((label, i, all) => all.indexOf(label) === i);
export const genreTested = (label: string) => !!(model.genre.tested[GENRES.indexOf(label)] ?? FAMILIES.find(f => f.label === label)?.tested);

/** The most probable genre when it clears that genre's threshold, else the most probable family (summed member
 * probabilities) when it clears the family's threshold. Thresholds were set in cross-validation on tuning tracks. */
export function genreFromScores(scores: Readonly<Record<string, number>> | undefined): GenreEstimate | undefined {
  if (!scores) return;
  const p = (label: string) => { const v = scores[label]; return typeof v === 'number' && Number.isFinite(v) ? v : 0; };
  let best: string | undefined;
  for (const label of GENRES) if (!best || p(label) > p(best)) best = label;
  if (!best || !p(best)) return;
  const k = GENRES.indexOf(best);
  if (p(best) >= model.genre.thresholds[k]) return { label: best, score: p(best), tested: !!model.genre.tested[k] };
  let family: { f: Family; v: number } | undefined;
  for (const f of FAMILIES) { const v = f.members.reduce((sum, m) => sum + p(m), 0); if (!family || v > family.v) family = { f, v }; }
  if (family && family.v >= family.f.threshold) return { label: family.f.label, score: +Math.min(1, family.v).toFixed(4), tested: family.f.tested };
  return undefined;
}

/** Low / medium / high from the energy head's probability. */
export function energyFromScore(score: number | undefined): EnergyEstimate | undefined {
  if (score === undefined || !Number.isFinite(score) || score < 0 || score > 1) return;
  const level: EnergyLevel = score >= model.energy.high ? 'high' : score <= model.energy.low ? 'low' : 'medium';
  return { level, score, tested: level === 'medium' ? false : model.energy.tested[level] };
}

/** "Deep House" style names without their Discogs parent genre. */
export const styleName = (label: string) => label.split('---').at(-1) ?? label;
const GENRE_TEXT: Record<string, string> = { 'drum-and-bass': 'drum & bass', 'hardcore-hard-techno': 'hardcore / hard techno', 'indie-dance-nu-disco': 'indie dance / nu disco' };
export const genreText = (label: string) => GENRE_TEXT[label] ?? label.replaceAll('-', ' ');

export function sanitizeStyles(raw: unknown): TrackStyle[] | undefined {
  if (!Array.isArray(raw)) return;
  const out = raw.slice(0, KEPT_STYLES).flatMap((v: unknown) => {
    if (!v || typeof v !== 'object') return [];
    const s = v as Record<string, unknown>;
    return typeof s.label === 'string' && s.label.length <= 80 && typeof s.score === 'number' && Number.isFinite(s.score) && s.score >= 0 && s.score <= 1
      ? [{ label: s.label, score: s.score }] : [];
  });
  return out.length ? out : undefined;
}
/** Saved genre scores count only when they came from this head version (an older head's classes may differ). */
export function sanitizeGenreScores(raw: unknown): { version: string; scores: Record<string, number> } | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
  const r = raw as Record<string, unknown>;
  if (r.version !== GENRE_ENERGY_VERSION || !r.scores || typeof r.scores !== 'object') return;
  const scores = Object.fromEntries(Object.entries(r.scores as Record<string, unknown>)
    .filter((e): e is [string, number] => GENRES.includes(e[0]) && typeof e[1] === 'number' && Number.isFinite(e[1]) && e[1] >= 0 && e[1] <= 1));
  return Object.keys(scores).length ? { version: GENRE_ENERGY_VERSION, scores } : undefined;
}

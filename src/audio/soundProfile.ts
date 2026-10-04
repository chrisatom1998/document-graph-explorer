import { DJ_LABELS, sanitizeDjTags, type DjTag } from './djTags';
import { INSTRUMENT_LABELS } from './instrumentLabels';
export const PROFILE_MODELS = ['AudioSet AST', 'MTG-Jamendo', 'Music CLAP', 'Reviewed examples'] as const;
export type ProfileModel = typeof PROFILE_MODELS[number];
export const CHARACTER_LABELS = ['plucked', 'sustained', 'rhythmic stabs', 'pulsing', 'airy', 'metallic', 'distorted', 'warm', 'bright', 'reverberant', 'dry'];
export const ROLE_LABELS = ['bass', 'lead', 'pad', 'arpeggio', 'rhythm', 'atmosphere'];
export const VOCAL_LABELS = ['vocal chops', 'singing', 'speech', 'choir'];
export const RESEMBLANCE_LABELS = [...INSTRUMENT_LABELS, ...DJ_LABELS.source, 'environmental sound', 'noise', 'sound effect'];
export interface ModelCandidate { label: string; score: number; }
export interface SoundProfile {
  version: 1;
  source?: { label: string; basis: ProfileModel; corroborated: boolean };
  voice?: { basis: ProfileModel; corroborated: boolean; style?: string };
  resemblance?: string;
  djTags?: DjTag[];
  character: string[];
  roles: string[];
  disagreement: boolean;
  models: { model: ProfileModel; complete: boolean; candidates: ModelCandidate[] }[];
}
export function sanitizeSoundProfile(raw: unknown): SoundProfile | undefined {
  if (!raw || typeof raw !== 'object') return;
  const p = raw as Record<string, unknown>;
  if (p.version !== 1 || !Array.isArray(p.models)) return;
  const labels = (v: unknown, allowed: string[], count: number) => Array.isArray(v) ? [...new Set(v.filter((s): s is string => typeof s === 'string' && allowed.includes(s)))].slice(0, count) : [];
  const result: SoundProfile = { version: 1, character: labels(p.character, CHARACTER_LABELS, 3), roles: labels(p.roles, ROLE_LABELS, 2), disagreement: p.disagreement === true, models: [] };
  if (Array.isArray(p.djTags)) result.djTags = sanitizeDjTags(p.djTags);
  for (const value of p.models.slice(0, PROFILE_MODELS.length)) {
    if (!value || typeof value !== 'object') continue;
    const m = value as Record<string, unknown>;
    if (!PROFILE_MODELS.includes(m.model as ProfileModel) || result.models.some(existing => existing.model === m.model)) continue;
    const candidates: ModelCandidate[] = [];
    if (Array.isArray(m.candidates)) for (const value of m.candidates.slice(0, 5)) {
      if (!value || typeof value !== 'object') continue;
      const c = value as Record<string, unknown>;
      if (typeof c.label === 'string' && (RESEMBLANCE_LABELS.includes(c.label) || (m.model === 'Reviewed examples' && Object.values(DJ_LABELS).flat().includes(c.label))) && typeof c.score === 'number' && Number.isFinite(c.score) && c.score >= 0 && c.score <= 1) candidates.push({ label: c.label, score: c.score });
    }
    result.models.push({ model: m.model as ProfileModel, complete: m.complete === true, candidates });
  }
  const source = p.source as Record<string, unknown> | undefined;
  if (source && typeof source.label === 'string' && RESEMBLANCE_LABELS.includes(source.label) && PROFILE_MODELS.includes(source.basis as ProfileModel)) result.source = { label: source.label, basis: source.basis as ProfileModel, corroborated: source.corroborated === true };
  const voice = p.voice as Record<string, unknown> | undefined;
  if (voice && PROFILE_MODELS.includes(voice.basis as ProfileModel)) {
    result.voice = { basis: voice.basis as ProfileModel, corroborated: voice.corroborated === true };
    if (typeof voice.style === 'string' && VOCAL_LABELS.includes(voice.style)) result.voice.style = voice.style;
  }
  if (typeof p.resemblance === 'string' && RESEMBLANCE_LABELS.includes(p.resemblance)) result.resemblance = p.resemblance;
  return result;
}

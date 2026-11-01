import { canonicalDjLabel, DJ_HIDDEN_LABELS, DJ_PICKER_LABELS, soundLabelText, type DjGroup } from './djTags';
import { dimensionLabels, type Dimension } from './recognition';
import type { DisplaySound } from './confidentSoundSummary';

/** A listener's correction of one shown sound tag, from the "Not sure? Fix it" chip. Display only: it overrides what the
 * Sounds row shows for this file and never changes model scores, thresholds, labels or graph links. */
export interface SoundTagFix {
  dimension: Dimension; label: string;
  action: 'keep' | 'remove' | 'replace';
  /** The right tag, for `replace`. */
  to?: { dimension: Dimension; label: string };
  at: string;
}
export const SOUND_TAG_FIX_LIMIT = 500;
const DIMENSIONS: readonly Dimension[] = ['source', 'vocal', 'role', 'character', 'effect'];
const GROUP_OF: Partial<Record<Dimension, DjGroup>> = { source: 'source', effect: 'production', character: 'character' };

/** The chip shows only on uncertain model estimates: the 0.40–0.49 "possible" tier, or a "maybe"-level detector. */
export function needsFixChip(sound: { origin: string; tier?: DisplaySound['tier']; maybe?: boolean }): boolean {
  return sound.origin === 'model estimate' && (sound.tier === 'possible' || !!sound.maybe);
}

function knownLabel(dimension: Dimension, label: string): boolean {
  if (dimensionLabels[dimension]?.includes(label)) return true;
  const group = GROUP_OF[dimension];
  return !!group && canonicalDjLabel(group, label) === label;
}
const object = (v: unknown): Record<string, unknown> | undefined => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : undefined;
const tag = (v: unknown): { dimension: Dimension; label: string } | undefined => {
  const t = object(v);
  if (!t || !DIMENSIONS.includes(t.dimension as Dimension) || typeof t.label !== 'string' || t.label.length > 80) return;
  const dimension = t.dimension as Dimension;
  return knownLabel(dimension, t.label) ? { dimension, label: t.label } : undefined;
};

/** Stored and imported fixes: unknown labels, actions or dates are dropped, never guessed. */
export function sanitizeSoundTagFixes(raw: unknown): SoundTagFix[] | undefined {
  if (!Array.isArray(raw)) return;
  return raw.slice(-SOUND_TAG_FIX_LIMIT).flatMap((value): SoundTagFix[] => {
    const f = object(value), from = tag(value);
    if (!f || !from || !['keep', 'remove', 'replace'].includes(f.action as string)) return [];
    if (typeof f.at !== 'string' || f.at.length > 64 || !Number.isFinite(Date.parse(f.at))) return [];
    const action = f.action as SoundTagFix['action'];
    if (action !== 'replace') return [{ ...from, action, at: f.at }];
    const to = tag(f.to);
    return to && (to.dimension !== from.dimension || to.label !== from.label) ? [{ ...from, action, to, at: f.at }] : [];
  });
}

const key = (dimension: Dimension, label: string) => `${dimension}:${label}`;
/** Later fixes win: each tag ends up shown (kept or picked as the right one) or hidden (removed or replaced). */
export function soundTagFixState(fixes: readonly SoundTagFix[] | undefined): Map<string, { dimension: Dimension; label: string; show: boolean }> {
  const state = new Map<string, { dimension: Dimension; label: string; show: boolean }>();
  for (const fix of fixes ?? []) {
    const k = key(fix.dimension, fix.label);
    state.delete(k);
    state.set(k, { dimension: fix.dimension, label: fix.label, show: fix.action === 'keep' });
    if (fix.action === 'replace' && fix.to) {
      const t = key(fix.to.dimension, fix.to.label);
      state.delete(t);
      state.set(t, { ...fix.to, show: true });
    }
  }
  return state;
}

/** Apply the listener's fixes to the Sounds row: removed tags go, kept and picked tags show as "confirmed by you". */
export function applySoundTagFixes<T extends DisplaySound>(sounds: readonly T[], fixes: readonly SoundTagFix[] | undefined): (T | DisplaySound)[] {
  if (!fixes?.length) return [...sounds];
  const state = soundTagFixState(fixes);
  const out: (T | DisplaySound)[] = [];
  const seen = new Set<string>();
  for (const sound of sounds) {
    const k = key(sound.dimension, sound.label), fix = state.get(k);
    seen.add(k);
    if (!fix) { out.push(sound); continue; }
    if (!fix.show) continue;
    out.push({ dimension: sound.dimension, label: sound.label, origin: 'confirmed by you' });
  }
  for (const [k, fix] of state) if (fix.show && !seen.has(k)) out.push({ dimension: fix.dimension, label: fix.label, origin: 'confirmed by you' });
  return out;
}

export interface FixOption { dimension: Dimension; label: string; text: string }
const GROUP_NAMES: Record<DjGroup, string> = { source: 'Sound source', production: 'Sound type', character: 'Character' };
/** The tags a listener can pick as the right one: the same picker list the DJ tag editor offers, sorted by name. */
export function soundTagFixOptions(): { group: string; options: FixOption[] }[] {
  return (['source', 'production', 'character'] as const).map(group => ({
    group: GROUP_NAMES[group],
    options: DJ_PICKER_LABELS[group].filter(label => !DJ_HIDDEN_LABELS.has(`${group}:${label}`))
      .map(label => ({ dimension: (group === 'production' ? 'effect' : group) as Dimension, label, text: soundLabelText(label) }))
      .filter(option => knownLabel(option.dimension, option.label))
      .sort((a, b) => a.text.localeCompare(b.text)),
  })).filter(g => g.options.length);
}

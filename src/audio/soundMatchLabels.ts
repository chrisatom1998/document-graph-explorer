import type { DocNode } from '../model/types';
import { mergedDjLabel, type DjGroup, type ConfirmedDjTags } from './djTags';
import type { SoundProfile } from './soundProfile';
import { confidentSoundSummary } from './confidentSoundSummary';
import { filenameSoundFallback } from './filenameSoundFallback';
import { confirmedInstrumentList, sourceReviewAllows } from './instrumentEvidence';
import { musicNameHints } from './nameHints';
import { resolvedNonSourceLabels, reviewedSoundProfile, type ResolvedDjLabel } from './soundReviewPolicy';
import { sharedSoundReviewIdentity } from './soundReviewIdentity';
import { isRuleDescribedLabel } from './timbreDescriptions';

export const labelKey = (label: string) => label.replaceAll('_', ' ').toLowerCase();
const displayedLabelKey = (label: string) => sharedSoundReviewIdentity('source', labelKey(label))
  ?? sharedSoundReviewIdentity('effect', labelKey(label)) ?? labelKey(label);
export type MatchOrigin = 'confirmed' | 'sounds' | 'maybe' | 'filename' | 'guess' | 'unverified';
export interface MatchLabel { group: DjGroup; label: string; origin: MatchOrigin; weight: number }
/** How strongly each origin counts toward a link. None of these are probabilities. */
export const MATCH_WEIGHT: Record<MatchOrigin, number> = { confirmed: .85, sounds: .7, maybe: .55, filename: .45, guess: .4, unverified: .4 };
export const MATCH_ORIGIN_TEXT: Record<MatchOrigin, string> = { confirmed: 'confirmed by you', sounds: 'model estimate', maybe: 'maybe-level model estimate', filename: 'from the file name', guess: 'untested model guess', unverified: 'uncalibrated catalog similarity' };

/** The "Other model guesses" groups. Shared by the panel and by link building so they cannot drift apart. */
export function otherModelGuessGroups({ profile, confirmedDjTags, reviewedLabels, exclude, skipSource = false }: {
  profile?: Pick<SoundProfile, 'djTags'>; confirmedDjTags?: ConfirmedDjTags | object; reviewedLabels?: ResolvedDjLabel[];
  exclude: Iterable<string>; skipSource?: boolean;
}): { group: DjGroup; values: string[] }[] {
  const shown = new Set([...exclude].map(displayedLabelKey));
  const groups = ['source', 'production', 'character'] as DjGroup[];
  const rawOf = (group: DjGroup) => group !== 'source' && reviewedLabels?.length
    ? reviewedLabels.filter(t => t.group === group && t.source !== 'confirmed').map(t => t.label)
    : profile?.djTags?.filter(t => t.group === group).map(t => t.label) ?? [];
  // Merged look-alike tags show once, under the surviving name and group.
  const merged = groups.flatMap(group => rawOf(group).map(label => mergedDjLabel(group, label)));
  return groups.flatMap(group => {
    if (group === 'source' ? skipSource || confirmedDjTags : confirmedDjTags) return [];
    const raw = merged.filter(m => m.group === group).map(m => m.label);
    // Rule-described character words (timbreDescriptions.ts) are never model guesses.
    const values = [...new Set(raw)].filter(label => !shown.has(displayedLabelKey(label)) && !(group === 'character' && isRuleDescribedLabel(labelKey(label))));
    return values.length ? [{ group, values }] : [];
  });
}

/** Every label the panel's "Sounds" and "Other model guesses" sections show for this sound. */
export function soundMatchLabels(node: Pick<DocNode, 'path' | 'title' | 'audio'>): MatchLabel[] {
  const analysis = node.audio;
  if (!analysis) return [];
  const toGroup = (dimension: string): DjGroup => dimension === 'source' ? 'source' : dimension === 'effect' ? 'production' : 'character';
  const found = new Map<string, MatchLabel>();
  const put = (group: DjGroup, label: string, origin: MatchOrigin) => {
    const key = `${group}:${labelKey(label)}`, weight = MATCH_WEIGHT[origin], old = found.get(key);
    if (!old || weight > old.weight) found.set(key, { group, label: labelKey(label), origin, weight });
  };
  const scored = confidentSoundSummary(analysis);
  const fallback = filenameSoundFallback(analysis, node, scored);
  for (const s of scored) put(toGroup(s.dimension), s.label, s.origin === 'confirmed by you' ? 'confirmed' : s.uncalibrated ? 'unverified' : s.maybe || s.tier === 'possible' ? 'maybe' : 'sounds');
  for (const s of fallback) put(toGroup(s.dimension), s.label, 'filename');
  const confirmed = confirmedInstrumentList(analysis);
  const reviewedLabels = resolvedNonSourceLabels(analysis);
  const profile = reviewedSoundProfile(analysis);
  const rawHints = musicNameHints(node);
  const namedInstruments = rawHints.instruments?.value.filter(label => sourceReviewAllows(analysis, label));
  const displayProfile = profile && { ...profile, djTags: profile.djTags?.filter(tag => tag.group !== 'source' || sourceReviewAllows(analysis, tag.label)) };
  const groups = otherModelGuessGroups({
    profile: displayProfile, confirmedDjTags: confirmed !== undefined ? {} : undefined, reviewedLabels,
    exclude: [...scored, ...fallback].map(s => s.label), skipSource: confirmed !== undefined || !!namedInstruments?.length,
  });
  for (const { group, values } of groups) for (const value of values) put(group, value, 'guess');
  return [...found.values()];
}

import { canonicalDjLabel, mergedDjLabel, MERGED_DJ_LABELS, type DjGroup } from './djTags';
import type { Dimension, SoundReview } from './recognition';
import type { TaggerTag } from './tagger';
import policy from './taggerPolicy.json';

export const canonicalReviewLabel = (dimension: Dimension, label: string): string => dimension === 'character'
  ? canonicalDjLabel('character', label) ?? label
  : dimension === 'effect' ? canonicalDjLabel('production', label) ?? label : label;
const GROUP_OF: Partial<Record<Dimension, DjGroup>> = { source: 'source', effect: 'production', character: 'character' };
const DIMENSION_OF: Record<DjGroup, Dimension> = { source: 'source', production: 'effect', character: 'character' };
// Merged look-alike tags (djTags MERGED_DJ_LABELS) share one identity, so a decision on either name covers both.
const labelKey = (dimension: Dimension, label: string) => {
  const canonical = canonicalReviewLabel(dimension, label), group = GROUP_OF[dimension];
  if (!group) return `${dimension}:${canonical}`;
  const merged = mergedDjLabel(group, canonical);
  return `${DIMENSION_OF[merged.group]}:${merged.label}`;
};

// Only explicit cross-dimension equivalents share listener decisions. A tagger's broader
// replacement families (e.g. bass / bass guitar) must not merge distinct sound reviews.
const sharedIdentities = new Map<string, string>();
// Merged labels must also be recognized as reviewable shared sounds by consumer policies,
// even when no trained tagger declares an alsoDecides relationship for them.
for (const { group, label } of Object.values(MERGED_DJ_LABELS)) {
  const identity = labelKey(DIMENSION_OF[group], label);
  sharedIdentities.set(identity, identity);
}
for (const tag of policy.tags as TaggerTag[]) {
  if (!tag.alsoDecides?.length) continue;
  const identity = labelKey(tag.dimension, tag.label);
  for (const { dimension, label } of [
    ...tag.decides.map(label => ({ dimension: tag.dimension, label })), ...tag.alsoDecides,
  ]) sharedIdentities.set(labelKey(dimension, label), identity);
}

/** Identity exists independently of tagger availability or whether it scored this recording. */
export function sharedSoundReviewIdentity(dimension: Dimension, label: string): string | undefined {
  return sharedIdentities.get(labelKey(dimension, label));
}
export function soundReviewKey(dimension: Dimension, label: string): string {
  const key = labelKey(dimension, label);
  return sharedIdentities.get(key) ?? key;
}

/** Append order is authoritative, even across aliases, tied timestamps, and evidence runs. */
export function latestSoundReview(reviews: readonly SoundReview[] | undefined, dimension: Dimension, label: string): SoundReview | undefined {
  const key = soundReviewKey(dimension, label);
  for (let i = (reviews?.length ?? 0) - 1; i >= 0; i--) {
    const review = reviews![i];
    if (soundReviewKey(review.dimension, review.labelId) === key) return review;
  }
  return undefined;
}

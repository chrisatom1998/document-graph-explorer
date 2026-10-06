import type { MusicAnalysis } from './musicTypes';
import { resolvedNonSourceLabels } from './soundReviewPolicy';

/**
 * Character/style labels for a clip, resolved the same way as the rest of the
 * sound pipeline: your saved tags replace model estimates, and labels you
 * rejected or marked unsure never come back. Powers the "Genre / Style" filter.
 */
export function styleTags(audio: MusicAnalysis | undefined): string[] {
  if (!audio) return [];
  return resolvedNonSourceLabels(audio).filter(l => l.group === 'character').map(l => l.label);
}

import type { MusicAnalysis } from './musicTypes';
import { genreFromScores } from './genreEnergy';
import { resolvedNonSourceLabels } from './soundReviewPolicy';

/**
 * The genre a clip is filed under, as the track panel shows it (tested or
 * "maybe"). Powers the "Genre" filter; sound characters belong to the Sounds filter.
 */
export function styleTags(audio: MusicAnalysis | undefined): string[] {
  const genre = genreFromScores(audio?.genreScores?.scores);
  return genre ? [genre.label] : [];
}

/**
 * Whether a clip matches the Genre filter's saved value. Views and shared
 * snapshots saved before the Genre filter used this field for character
 * labels such as "warm"; those still match through the clip's character
 * tags, so a restored view does not hide every clip. The facet stays separate
 * from Sounds: folding it in would turn "character AND sounds" into OR.
 */
export function matchesStyleFilter(audio: MusicAnalysis | undefined, selected: string): boolean {
  if (styleTags(audio).includes(selected)) return true;
  return !!audio && resolvedNonSourceLabels(audio).some(label => label.group === 'character' && label.label === selected);
}

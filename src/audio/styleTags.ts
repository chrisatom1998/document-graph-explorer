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

/** Saved views and shared snapshots before the Genre filter used this same field
 * for character labels. Keep that facet separate from Sounds: combining them
 * would change character AND sounds into character OR sounds.
 */
export function matchesStyleFilter(audio: MusicAnalysis | undefined, selected: string): boolean {
  return styleTags(audio).includes(selected) || !!audio && resolvedNonSourceLabels(audio)
    .some(label => label.group === 'character' && label.label === selected);
}

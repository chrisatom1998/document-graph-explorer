import type { MusicAnalysis } from './musicTypes';
import { genreFromScores } from './genreEnergy';

/**
 * The genre a clip is filed under, as the track panel shows it (tested or
 * "maybe"). Powers the "Genre" filter; sound characters belong to the Sounds filter.
 */
export function styleTags(audio: MusicAnalysis | undefined): string[] {
  const genre = genreFromScores(audio?.genreScores?.scores);
  return genre ? [genre.label] : [];
}

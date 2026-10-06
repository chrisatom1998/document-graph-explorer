import type { MusicAnalysis } from './musicTypes';

/**
 * Character/style labels for a clip: the user's confirmed tags first, then the
 * model's character tags. Powers the "Genre / Style" filter and the clip facets.
 */
export function styleTags(audio: MusicAnalysis | undefined): string[] {
  if (!audio) return [];
  const tags = new Set<string>(audio.confirmedDjTags?.character ?? []);
  for (const tag of audio.soundProfile?.djTags ?? []) if (tag.group === 'character') tags.add(tag.label);
  for (const label of audio.soundProfile?.character ?? []) tags.add(label);
  return [...tags];
}

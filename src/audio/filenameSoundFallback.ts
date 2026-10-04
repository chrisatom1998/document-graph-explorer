import type { DocNode } from '../model/types';
import type { MusicAnalysis } from './musicTypes';
import type { DisplaySound } from './confidentSoundSummary';
import { DJ_CATALOG } from './djTags';
import { musicNameHints } from './nameHints';
import { confirmedInstrumentList, sourceReviewAllows } from './instrumentEvidence';
import { latestSoundReview } from './soundReviewPolicy';

const words = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export interface FilenameSound { dimension: 'source' | 'effect' | 'character'; label: string; origin: 'From filename' }
/** Read-only presentation fallback. Filename semantics are never audio evidence or training truth. */
export function filenameSoundFallback(audio: MusicAnalysis, node: Pick<DocNode, 'path' | 'title'>, displayed: DisplaySound[]): FilenameSound[] {
  const filename = (node.path || node.title).replaceAll('\\', '/').split('/').at(-1) ?? '';
  const text = ` ${words(filename.replace(/\.[a-z0-9]{1,8}$/i, ''))} `;
  const result: FilenameSound[] = [];
  const occupied = (dimension: FilenameSound['dimension']) => displayed.some(item => item.dimension === dimension);
  const allowed = (dimension: FilenameSound['dimension'], label: string) => {
    const review = latestSoundReview(audio.soundReviews, dimension, label);
    return !review || review.decision === 'confirmed';
  };
  if (!occupied('source') && confirmedInstrumentList(audio) === undefined) {
    for (const label of musicNameHints({title: filename}).instruments?.value ?? []) {
      if (sourceReviewAllows(audio, label)) result.push({dimension: 'source', label, origin: 'From filename'});
    }
  }
  if (audio.confirmedDjTags !== undefined) return result;
  const sources = displayed.filter(item => item.dimension === 'source').map(item => item.label);
  const sourceSnapshot = confirmedInstrumentList(audio);
  const compatibleSource = (source?: string) => !source || (sourceSnapshot === undefined || sourceSnapshot.includes(source))
    && sourceReviewAllows(audio, source) && (!sources.length || sources.includes(source));
  // Long phrases precede their nested aliases, e.g. "reverse impact" before "impact".
  const matches = DJ_CATALOG.filter(c => c.group !== 'source').flatMap(c => [c.label, ...c.aliases]
    .map(words).filter(alias => /[a-z]/.test(alias) && text.includes(` ${alias} `)).map(alias => ({c, alias})))
    .sort((a, b) => b.alias.length - a.alias.length);
  const consumed: string[] = [];
  for (const {c, alias} of matches) {
    if (consumed.some(longer => ` ${longer} `.includes(` ${alias} `))) continue;
    consumed.push(alias);
    const dimension = c.group === 'character' ? 'character' : 'effect';
    if (occupied(dimension) || !allowed(dimension, c.label) || !compatibleSource(c.source ?? undefined)) continue;
    const materialHit = c.label === 'impact' && text.match(/\b(glass|metal|wood|stone|plastic) (?:hit|impact)\b/);
    const label = materialHit ? `${materialHit[1]} hit` : c.label;
    if (!allowed(dimension, label)) continue;
    if (!result.some(item => item.dimension === dimension && item.label === label)) result.push({dimension, label, origin: 'From filename'});
  }
  return result;
}

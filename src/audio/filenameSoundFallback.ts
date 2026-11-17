import type { DocNode } from '../model/types';
import type { MusicAnalysis } from './musicTypes';
import type { DisplaySound } from './confidentSoundSummary';
import { DJ_CATALOG, DJ_HIDDEN_LABELS, mergedDjLabel, type DjGroup } from './djTags';
import { musicNameHints } from './nameHints';
import { confirmedInstrumentList, sourceReviewAllows } from './instrumentEvidence';
import { latestSoundReview } from './soundReviewPolicy';
import { areHiddenSoundTagsShown } from './hiddenSoundTagsSwitch';
import { namedSounds } from './nameSoundLexicon';
import { taggerClearlyAbsent } from './tagger';

const DIMENSION_OF: Record<DjGroup, FilenameSound['dimension']> = { source: 'source', production: 'effect', character: 'character' };
const words = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const GROUP_OF: Record<FilenameSound['dimension'], DjGroup> = { source: 'source', effect: 'production', character: 'character' };
export interface FilenameSound { dimension: 'source' | 'effect' | 'character'; label: string; origin: 'From filename' | 'From folder name' }
/** Name tags are read for samples and loops up to this long. Longer recordings are usually songs, whose titles name
 * things that aren't sounds ("Purple Rain", "Top Gun"), so they keep the older, narrower filename fallback. */
export const NAME_TAGS_MAX_SECONDS = 60;
/** Read-only presentation, Loopcloud / Atlas style: what the file and folder names say, shown next to the audio tags and
 * labelled as coming from the name. Filename semantics are never audio evidence or training truth. A name tag is left out
 * when a listener rejected it or confirmed a tag list, when the audio already shows it, when the trained tagger is
 * clearly sure it is absent (taggerClearlyAbsent), and, with the hidden-tags switch off, when it is a hidden tag. */
export function filenameSoundFallback(audio: MusicAnalysis, node: Pick<DocNode, 'path' | 'title'>, displayed: DisplaySound[]): FilenameSound[] {
  const short = Number.isFinite(audio.durationSeconds) && audio.durationSeconds <= NAME_TAGS_MAX_SECONDS;
  const result = short ? nameSounds(audio, node, displayed) : songFilenameSounds(audio, node, displayed);
  if (areHiddenSoundTagsShown()) return result;
  return result.filter(s => !DJ_HIDDEN_LABELS.has(`${GROUP_OF[s.dimension]}:${s.label}`));
}

function nameSounds(audio: MusicAnalysis, node: Pick<DocNode, 'path' | 'title'>, displayed: DisplaySound[]): FilenameSound[] {
  const path = node.path || node.title;
  const result: FilenameSound[] = [];
  const shownLabels = new Set(displayed.map(item => item.label));
  const taken = (label: string) => shownLabels.has(label) || result.some(item => item.label === label);
  const sourceSnapshot = confirmedInstrumentList(audio);
  const allowed = (dimension: FilenameSound['dimension'], label: string) => {
    if (dimension === 'source') return sourceReviewAllows(audio, label);
    const review = latestSoundReview(audio.soundReviews, dimension, label);
    return !review || review.decision === 'confirmed';
  };
  const add = (dimension: FilenameSound['dimension'], label: string, from: 'file name' | 'folder name') => {
    if (taken(label) || !allowed(dimension, label) || taggerClearlyAbsent(audio.tagger, audio.durationSeconds, dimension, label)) return;
    result.push({ dimension, label, origin: from === 'file name' ? 'From filename' : 'From folder name' });
  };
  if (sourceSnapshot === undefined) {
    const instruments = musicNameHints({ path, title: path }).instruments;
    for (const label of instruments?.value ?? []) add('source', label, instruments!.source);
  }
  const filename = path.replaceAll('\\', '/').split('/').at(-1) ?? '';
  const material = filename.toLowerCase().match(/(?:^|[^a-z])(glass|metal|wood|stone|plastic)[^a-z]*(?:hit|impact)(?![a-z])/);
  for (const named of namedSounds(path)) {
    const dimension = DIMENSION_OF[named.group];
    // Listener snapshots win: a confirmed instrument list governs sources, a confirmed DJ tag list everything else.
    if (dimension === 'source' ? sourceSnapshot !== undefined : audio.confirmedDjTags !== undefined) continue;
    const needs = DJ_CATALOG.find(c => c.label === named.label)?.source ?? undefined;
    if (needs && (sourceSnapshot !== undefined && !sourceSnapshot.includes(needs) || !sourceReviewAllows(audio, needs))) continue;
    const label = named.label === 'impact' && named.from === 'file name' && material ? `${material[1]} hit` : named.label;
    if (label !== named.label && !allowed(dimension, named.label)) continue;
    add(dimension, label, named.from);
  }
  return result;
}

/** The narrower fallback kept for long recordings (songs): catalog words in the file name only, and only for a dimension
 * the audio left empty. */
function songFilenameSounds(audio: MusicAnalysis, node: Pick<DocNode, 'path' | 'title'>, displayed: DisplaySound[]): FilenameSound[] {
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
  const matches = DJ_CATALOG.filter(c => c.group !== 'source' || mergedDjLabel('source', c.label).group !== 'source').flatMap(c => [c.label, ...c.aliases]
    .map(words).filter(alias => /[a-z]/.test(alias) && text.includes(` ${alias} `)).map(alias => ({c, alias})))
    .sort((a, b) => b.alias.length - a.alias.length);
  const consumed: string[] = [];
  for (const {c, alias} of matches) {
    if (consumed.some(longer => ` ${longer} `.includes(` ${alias} `))) continue;
    consumed.push(alias);
    // Merged look-alike tags (djTags MERGED_DJ_LABELS) show under their surviving name and group.
    const merged = mergedDjLabel(c.group as DjGroup, c.label), dimension = DIMENSION_OF[merged.group];
    if (occupied(dimension) || !allowed(dimension, merged.label) || !compatibleSource(c.source ?? undefined)) continue;
    const materialHit = merged.label === 'impact' && text.match(/\b(glass|metal|wood|stone|plastic) (?:hit|impact)\b/);
    const label = materialHit ? `${materialHit[1]} hit` : merged.label;
    if (!allowed(dimension, label)) continue;
    if (!result.some(item => item.dimension === dimension && item.label === label)) result.push({dimension, label, origin: 'From filename'});
  }
  return result;
}

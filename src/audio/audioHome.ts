import type { DocNode, Edge } from '../model/types';
import { clipShape } from './clipShape';
import { soundLabelText } from './djTags';
import { soundsLike } from './musicLinks';
import { resolveTempoKey } from './resolvedTempoKey';
import { nodeSoundTags } from './soundFilterTags';
import { nodeStemRoles } from './stemRole';
import { styleTags } from './styleTags';
import { timbreDescriptions } from './timbreDescriptions';

/** A sample library: at least one sound, and no notes, papers or code mixed in. */
export function isAudioLibrary(nodes: DocNode[]): boolean {
  const docs = nodes.filter(node => node.kind === 'document');
  return docs.length > 0 && docs.every(node => node.fileType === 'audio');
}

export interface ForYouShelf {
  id: string;
  title: string;
  subtitle?: string;
  items: DocNode[];
}

/** Shelves for the audio home. "Sounds like" uses the same stored fingerprint as the graph's sounds-alike links. */
export function forYouShelves(focus: DocNode | undefined, nodes: DocNode[], edges: Edge[]): ForYouShelf[] {
  const audio = nodes.filter(node => node.kind === 'document' && node.fileType === 'audio');
  const shelves: ForYouShelf[] = [];
  if (focus && focus.fileType === 'audio') {
    const hits = soundsLike(focus.id, nodes, edges, 12);
    if (hits?.length) {
      const byId = new Map(audio.map(node => [node.id, node]));
      const items = hits.flatMap(hit => {
        const node = byId.get(hit.id);
        return node ? [node] : [];
      });
      if (items.length) shelves.push({
        id: 'similar',
        title: `Sounds like ${focus.title}`,
        subtitle: 'Ranked by the stored sound fingerprint',
        items,
      });
    }
    const bpm = resolveTempoKey(focus).tempo?.bpm;
    if (bpm !== undefined && Number.isFinite(bpm)) {
      const rounded = Math.round(bpm);
      const near = audio.filter(node => {
        if (node.id === focus.id) return false;
        const other = resolveTempoKey(node).tempo?.bpm;
        return other !== undefined && Math.abs(Math.round(other) - rounded) <= 12;
      });
      if (near.length) shelves.push({ id: 'tempo', title: `Around ${rounded} BPM`, subtitle: 'Close enough to mix', items: near });
    }
  }
  const loops = audio.filter(node => clipShape(node) === 'loop');
  const shots = audio.filter(node => clipShape(node) === 'one-shot');
  if (loops.length) shelves.push({ id: 'loops', title: 'Loops', items: loops });
  if (shots.length) shelves.push({ id: 'shots', title: 'One-shots', items: shots });
  return shelves;
}

export type TagGroup = 'Key' | 'Tempo' | 'Shape' | 'Part' | 'Genre' | 'Sound' | 'Character';
export interface ClipTag { group: TagGroup; label: string }

const titleCase = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** Tags the inspector already knows, shown on the audio home without opening the full panel. */
export function clipTags(node: DocNode): ClipTag[] {
  const resolved = node.fileType === 'audio' ? resolveTempoKey(node) : undefined;
  const tags: ClipTag[] = [];
  if (resolved?.keyLabel) tags.push({ group: 'Key', label: resolved.keyLabel });
  if (resolved?.tempo && Number.isFinite(resolved.tempo.bpm)) tags.push({ group: 'Tempo', label: `${Math.round(resolved.tempo.bpm)} BPM` });
  const shape = node.fileType === 'audio' ? clipShape(node) : undefined;
  if (shape === 'loop') tags.push({ group: 'Shape', label: 'Loop' });
  else if (shape === 'one-shot') tags.push({ group: 'Shape', label: 'One-shot' });
  for (const role of nodeStemRoles(node)) tags.push({ group: 'Part', label: titleCase(role) });
  for (const genre of styleTags(node.audio)) tags.push({ group: 'Genre', label: soundLabelText(genre) });
  for (const sound of nodeSoundTags(node)) tags.push({ group: 'Sound', label: soundLabelText(sound) });
  for (const word of timbreDescriptions(node.audio?.timbre)) tags.push({ group: 'Character', label: titleCase(soundLabelText(word)) });
  const seen = new Set<string>();
  return tags.filter(tag => {
    const key = `${tag.group}:${tag.label.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The selected sound, or the first sound in the library when nothing is selected. */
export function featuredClip(nodes: DocNode[], selectedId: string | null): DocNode | undefined {
  const audio = nodes.filter(node => node.kind === 'document' && node.fileType === 'audio');
  return audio.find(node => node.id === selectedId) ?? audio[0];
}

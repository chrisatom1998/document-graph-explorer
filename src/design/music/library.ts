import type { DocNode, Edge } from '../../model/types';
import { keyName } from '../../audio/musicTypes';
import { resolveTempoKey } from '../../audio/resolvedTempoKey';
import { clipShape } from '../../audio/clipShape';
import { hexFor } from '../../scene/palette';
import { nodeSoundTags } from '../../audio/soundFilterTags';
import { soundLabelText } from '../../audio/djTags';
import { styleTags } from '../../audio/styleTags';
import { nodeStemRoles } from '../../audio/stemRole';
import { timbreDescriptions } from '../../audio/timbreDescriptions';

export interface ClipFacts {
  bpm: number | null;
  key: string | null;
  seconds: number | null;
  shape: 'Loop' | 'One-shot' | null;
  kind: string;
}

/** Tempo and key the way the inspector reports them: a value in the file name wins over the estimate. */
export function clipFacts(node: DocNode): ClipFacts {
  const audio = node.fileType === 'audio';
  const resolved = audio ? resolveTempoKey(node) : null;
  const bpm = (audio ? resolved?.tempo?.bpm : node.audio?.tempo?.bpm) ?? null;
  const key = audio ? resolved?.keyLabel ?? null : node.audio?.key ? keyName(node.audio.key) : null;
  const shape = audio ? clipShape(node) : undefined;
  return {
    bpm: bpm === null ? null : Math.round(bpm),
    key,
    seconds: node.audio?.durationSeconds ?? null,
    shape: shape === 'loop' ? 'Loop' : shape === 'one-shot' ? 'One-shot' : null,
    kind: audio ? 'Sample' : node.fileType.toUpperCase(),
  };
}

export function clipColor(node: DocNode): string {
  return hexFor(Math.max(0, node.cluster));
}

export function clock(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '--:--';
  if (seconds < 10) return `${seconds.toFixed(1)} s`;
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export interface Neighbor { node: DocNode; strength: number; reasons: string[] }

const REASON: Partial<Record<Edge['kind'], string>> = {
  similar: 'Sounds alike', instrument: 'Same instruments', sound: 'Similar character', title: 'Similar name',
  tempo: 'Similar tempo', key: 'Compatible key', semantic: 'Similar meaning', keyword: 'Shared keywords',
  entity: 'Shared names', reference: 'Linked', topic: 'Shared topic',
};

/** Neighbours of `id`, strongest shared connection first, with a short reason per edge. */
export function neighborsOf(id: string, nodes: DocNode[], nodeIndex: Record<string, number>, edges: Edge[]): Neighbor[] {
  const byId = new Map<string, Neighbor>();
  for (const edge of edges) {
    const other = edge.source === id ? edge.target : edge.target === id ? edge.source : null;
    if (!other) continue;
    const node = nodes[nodeIndex[other]];
    if (!node || node.kind !== 'document') continue;
    const entry = byId.get(other) ?? { node, strength: 0, reasons: [] };
    const reason = REASON[edge.kind] ?? edge.kind;
    if (!entry.reasons.includes(reason)) entry.reasons.push(reason);
    entry.strength = Math.max(entry.strength, edge.weight);
    byId.set(other, entry);
  }
  return [...byId.values()].sort((a, b) => b.strength - a.strength || a.node.title.localeCompare(b.node.title));
}

export interface Shelf { id: string; title: string; subtitle?: string; items: DocNode[] }

/** "For You" style shelves: similar to the focus clip, same key, nearby tempo, then loops and one-shots. */
export function shelvesFor(focus: DocNode | undefined, docs: DocNode[], neighbors: Neighbor[]): Shelf[] {
  const shelves: Shelf[] = [];
  if (focus && neighbors.length) shelves.push({ id: 'similar', title: `Sounds like ${focus.title}`, subtitle: 'Closest matches in your library', items: neighbors.map(n => n.node) });
  const focusFacts = focus ? clipFacts(focus) : null;
  const facts = new Map(docs.map(d => [d.id, clipFacts(d)]));
  if (focusFacts?.bpm) {
    const near = docs.filter(d => d.id !== focus?.id && facts.get(d.id)?.bpm && Math.abs((facts.get(d.id)?.bpm ?? 0) - (focusFacts.bpm ?? 0)) <= 12);
    if (near.length) shelves.push({ id: 'tempo', title: `Around ${focusFacts.bpm} BPM`, subtitle: 'Mixes cleanly at this tempo', items: near });
  }
  const keyed = docs.filter(d => facts.get(d.id)?.key);
  if (keyed.length) shelves.push({ id: 'keys', title: 'In key', subtitle: 'Samples with a detected or named key', items: keyed });
  const loops = docs.filter(d => facts.get(d.id)?.shape === 'Loop');
  if (loops.length) shelves.push({ id: 'loops', title: 'Loops', items: loops });
  const shots = docs.filter(d => facts.get(d.id)?.shape === 'One-shot');
  if (shots.length) shelves.push({ id: 'shots', title: 'One-shots', items: shots });
  const rest = docs.filter(d => d.fileType !== 'audio');
  if (rest.length) shelves.push({ id: 'docs', title: 'Notes and documents', items: rest });
  if (!shelves.length && docs.length) shelves.push({ id: 'all', title: 'Your library', items: docs });
  return shelves;
}

export type TagGroup = 'Key' | 'Tempo' | 'Shape' | 'Part' | 'Genre' | 'Sound' | 'Character' | 'Type';
export interface ClipTag { group: TagGroup; label: string }

const title = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** Every tag and category the app holds for a clip, in reading order: key, tempo, shape, part, genre, sounds, character. */
export function clipTags(node: DocNode): ClipTag[] {
  const f = clipFacts(node);
  const tags: ClipTag[] = [];
  if (f.key) tags.push({ group: 'Key', label: f.key });
  if (f.bpm !== null) tags.push({ group: 'Tempo', label: `${f.bpm} BPM` });
  if (f.shape) tags.push({ group: 'Shape', label: f.shape });
  if (node.fileType !== 'audio') tags.push({ group: 'Type', label: node.fileType.toUpperCase() });
  for (const role of nodeStemRoles(node)) tags.push({ group: 'Part', label: title(role) });
  for (const genre of styleTags(node.audio)) tags.push({ group: 'Genre', label: soundLabelText(genre) });
  for (const sound of nodeSoundTags(node)) tags.push({ group: 'Sound', label: soundLabelText(sound) });
  for (const word of timbreDescriptions(node.audio?.timbre)) tags.push({ group: 'Character', label: title(soundLabelText(word)) });
  if (node.fileType !== 'audio') for (const topic of node.topics.slice(0, 6)) tags.push({ group: 'Sound', label: topic });
  const seen = new Set<string>();
  return tags.filter(t => { const k = `${t.group}:${t.label.toLowerCase()}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

/** A sidebar shelf built from a property found in the library, with the sounds that carry it. */
export interface LibraryLabel { id: string; label: string; group: TagGroup; ids: ReadonlySet<string> }

/** Groups after shape and key, in the order ties are broken. Tempo is a number, not a shelf. */
const LABEL_GROUPS: readonly TagGroup[] = ['Part', 'Genre', 'Sound', 'Character', 'Type'];
export const MAX_LIBRARY_LABELS = 6;
const SHAPE_WORDS = new Set(['oneshot', 'oneshots', 'loop', 'loops']);

/**
 * Shelf labels for the library sidebar, read from the properties the analysis
 * actually found: Loops/One-shots and "In key" first when present, then the
 * most common parts, genres, sounds and character words. Recomputed whenever
 * the nodes change, so labels appear as analysis results arrive.
 */
export function libraryLabels(docs: readonly DocNode[], max = MAX_LIBRARY_LABELS): LibraryLabel[] {
  const found = new Map<string, { id: string; label: string; group: TagGroup; ids: Set<string> }>();
  const add = (group: TagGroup, id: string, label: string, nodeId: string) => {
    const entry = found.get(id) ?? { id, label, group, ids: new Set<string>() };
    // The same word from two detectors (part "Bass", sound "bass") is one shelf, filed under the earlier group.
    if (LABEL_GROUPS.indexOf(group) < LABEL_GROUPS.indexOf(entry.group)) entry.group = group;
    entry.ids.add(nodeId);
    found.set(id, entry);
  };
  for (const node of docs) {
    for (const tag of clipTags(node)) {
      if (tag.group === 'Tempo') continue;
      if (tag.group === 'Key') { add('Key', 'key', 'In key', node.id); continue; }
      if (tag.group === 'Shape') { add('Shape', `shape:${tag.label.toLowerCase()}`, tag.label === 'Loop' ? 'Loops' : 'One-shots', node.id); continue; }
      const word = tag.label.trim().toLowerCase();
      // Shape already has its own shelves; a sound tag saying "one shot" or "loop" would repeat them.
      if (!word || SHAPE_WORDS.has(word.replace(/[\s-]+/g, ''))) continue;
      add(tag.group, `tag:${word}`, title(tag.label.trim()), node.id);
    }
  }
  // A shelf holding every item filters nothing ("PDF" in an all-PDF library), so it is left out.
  const useful = (l: { ids: Set<string> }) => docs.length < 2 || l.ids.size < docs.length;
  const pinned = ['shape:loop', 'shape:one-shot', 'key'].flatMap(id => found.get(id) ?? []).filter(useful);
  const rest = [...found.values()]
    .filter(l => LABEL_GROUPS.includes(l.group) && useful(l))
    .sort((a, b) => b.ids.size - a.ids.size || LABEL_GROUPS.indexOf(a.group) - LABEL_GROUPS.indexOf(b.group) || a.label.localeCompare(b.label));
  return [...pinned, ...rest].slice(0, max);
}

/** One line under a library row, from the sound's own properties: part, shape, tempo, key. */
export function rowDetail(node: DocNode): string {
  const f = clipFacts(node);
  if (node.fileType !== 'audio') return [f.kind, f.bpm !== null ? `${f.bpm} BPM` : null, f.key].filter(Boolean).join(' · ');
  const tags = clipTags(node).filter(t => !SHAPE_WORDS.has(t.label.toLowerCase().replace(/[\s-]+/g, '')));
  const lead = tags.find(t => t.group === 'Part') ?? tags.find(t => t.group === 'Sound') ?? tags.find(t => t.group === 'Genre');
  return [lead ? title(lead.label) : f.kind, f.shape, f.bpm !== null ? `${f.bpm} BPM` : null, f.key].filter(Boolean).join(' · ');
}

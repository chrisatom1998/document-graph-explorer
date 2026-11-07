import type { DocNode, Edge } from '../../model/types';
import { resolveTempoKey } from '../../audio/resolvedTempoKey';
import { confidentSoundSummary } from '../../audio/confidentSoundSummary';
import { filenameSoundFallback } from '../../audio/filenameSoundFallback';
import { soundLabelText } from '../../audio/djTags';

/** Everything the For you view shows, derived from the graph. Nothing is invented: a missing value stays null. */
export interface ForYouModel {
  sounds: DocNode[];
  documents: number;
  /** Distinct community ids among the clips, or null until clustering has assigned any. */
  neighbourhoods: number | null;
  focus: DocNode | null;
  /** True when `related` came from shared links rather than being the rest of the library. */
  focusLinked: boolean;
  related: DocNode[];
  tags: SoundTag[];
  crate: Crate | null;
  keyedClips: number;
  tempoClips: number;
}

export interface Crate { key: string; clips: DocNode[]; bpmMin: number | null; bpmMax: number | null }

export const tempoOf = (node: DocNode): number | null => {
  const bpm = resolveTempoKey(node).tempo?.bpm;
  return bpm === undefined ? null : Math.round(bpm);
};
export const keyOf = (node: DocNode): string | null => resolveTempoKey(node).keyLabel ?? null;
/** How a tag was found. Only `confirmed` and `likely` are stated plainly; the rest are shown qualified. */
export type TagBasis = 'confirmed' | 'likely' | 'possible' | 'name';
export interface SoundTag { label: string; basis: TagBasis }

const BASIS_TEXT: Record<TagBasis, string> = { confirmed: 'confirmed by you', likely: 'model estimate', possible: 'possible, low confidence', name: 'from the file or folder name' };
export const tagBasisText = (basis: TagBasis): string => BASIS_TEXT[basis];
/** The text a tag chip shows: plain for confirmed and likely labels, qualified for uncertain or name-derived ones. */
export const tagText = (tag: SoundTag): string => (tag.basis === 'confirmed' || tag.basis === 'likely' ? tag.label : `${tag.label} (${tag.basis === 'name' ? 'from name' : 'possible'})`);

const tagCache = new WeakMap<DocNode, SoundTag[]>();
/** Tags with their provenance, from the same sources as the Sounds row; nothing is added that the app does not already show for the clip. */
export function soundTagsOf(node: DocNode): SoundTag[] {
  if (!node.audio) return [];
  const hit = tagCache.get(node);
  if (hit) return hit;
  const scored = confidentSoundSummary(node.audio);
  const byLabel = new Map<string, SoundTag>();
  for (const s of scored) {
    const basis: TagBasis = s.origin === 'confirmed by you' ? 'confirmed' : s.tier === 'possible' || s.maybe || s.uncalibrated ? 'possible' : 'likely';
    byLabel.set(s.label, { label: soundLabelText(s.label), basis });
  }
  for (const s of filenameSoundFallback(node.audio, node, scored)) if (!byLabel.has(s.label)) byLabel.set(s.label, { label: soundLabelText(s.label), basis: 'name' });
  const rank: Record<TagBasis, number> = { confirmed: 0, likely: 1, possible: 2, name: 3 };
  const tags = [...byLabel.values()].sort((a, b) => rank[a.basis] - rank[b.basis] || a.label.localeCompare(b.label));
  tagCache.set(node, tags);
  return tags;
}

/** The most common key among clips that have one, with its tempo range. */
export function bestCrate(sounds: DocNode[]): Crate | null {
  const byKey = new Map<string, DocNode[]>();
  for (const node of sounds) {
    const key = keyOf(node);
    if (key) byKey.set(key, [...(byKey.get(key) ?? []), node]);
  }
  let best: [string, DocNode[]] | null = null;
  for (const entry of byKey) if (!best || entry[1].length > best[1].length || (entry[1].length === best[1].length && entry[0] < best[0])) best = entry;
  if (!best) return null;
  const bpms = best[1].map(tempoOf).filter((v): v is number => v !== null);
  return { key: best[0], clips: best[1], bpmMin: bpms.length ? Math.min(...bpms) : null, bpmMax: bpms.length ? Math.max(...bpms) : null };
}

/** Clips linked to `id`, strongest link first. */
export function linkedSounds(id: string, sounds: DocNode[], edges: Edge[]): DocNode[] {
  const byId = new Map(sounds.map(n => [n.id, n]));
  const strength = new Map<string, number>();
  for (const e of edges) {
    const other = e.source === id ? e.target : e.target === id ? e.source : null;
    if (other && byId.has(other)) strength.set(other, Math.max(strength.get(other) ?? 0, e.weight));
  }
  return [...strength.entries()].sort((a, b) => b[1] - a[1] || byId.get(a[0])!.title.localeCompare(byId.get(b[0])!.title)).map(([k]) => byId.get(k)!);
}

export function buildForYou(nodes: DocNode[], edges: Edge[], selectedId: string | null, currentId: string | null): ForYouModel {
  const docs = nodes.filter(n => n.kind === 'document');
  const sounds = docs.filter(n => n.fileType === 'audio');
  const pool = sounds.length ? sounds : docs;
  const clusters = new Set(pool.filter(n => n.cluster >= 0).map(n => n.cluster));
  const pick = (id: string | null) => (id ? pool.find(n => n.id === id) ?? null : null);
  const focus = pick(selectedId) ?? pick(currentId) ?? [...pool].sort((a, b) => b.degree - a.degree || a.title.localeCompare(b.title))[0] ?? null;
  const linked = focus ? linkedSounds(focus.id, pool, edges) : [];
  const related = (linked.length ? linked : pool.filter(n => n.id !== focus?.id)).slice(0, 12);
  // Each label keeps its most certain basis across the clips shown; count only breaks ties.
  const rank: Record<TagBasis, number> = { confirmed: 0, likely: 1, possible: 2, name: 3 };
  const tagCounts = new Map<string, { tag: SoundTag; count: number }>();
  for (const n of focus ? [focus, ...related] : []) for (const t of soundTagsOf(n)) {
    const have = tagCounts.get(t.label);
    tagCounts.set(t.label, { tag: have && rank[have.tag.basis] <= rank[t.basis] ? have.tag : t, count: (have?.count ?? 0) + 1 });
  }
  const tags = [...tagCounts.values()].sort((a, b) => rank[a.tag.basis] - rank[b.tag.basis] || b.count - a.count || a.tag.label.localeCompare(b.tag.label)).slice(0, 8).map(e => e.tag);
  return {
    sounds, documents: docs.length - sounds.length,
    neighbourhoods: clusters.size || null,
    focus, focusLinked: linked.length > 0, related, tags,
    crate: bestCrate(sounds),
    keyedClips: sounds.filter(n => keyOf(n)).length,
    tempoClips: sounds.filter(n => tempoOf(n) !== null).length,
  };
}

/** A fixed pair of gradient stops per cluster hue so a clip keeps its colour; clusterless clips hash their id. */
const STOPS: [string, string][] = [
  ['#ffd23f', '#ff9a3c'], ['#1fd1c1', '#6a5cff'], ['#ff8a3d', '#ff3d8b'], ['#8b3dff', '#ff3d9a'],
  ['#e6e04a', '#2fd0a4'], ['#2b2f9a', '#1fb5a8'], ['#ff5d73', '#ffb347'], ['#38e0a2', '#2f7bff'],
];
export function gradientFor(node: Pick<DocNode, 'id' | 'cluster'>): [string, string] {
  if (node.cluster >= 0) return STOPS[node.cluster % STOPS.length];
  let h = 0;
  for (let i = 0; i < node.id.length; i++) h = (h * 31 + node.id.charCodeAt(i)) >>> 0;
  return STOPS[h % STOPS.length];
}

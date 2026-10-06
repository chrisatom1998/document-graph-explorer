import type { DocNode, Edge } from '../model/types';
import { musicNameHints } from '../audio/nameHints';
import { KEY_NAMES } from '../audio/musicTypes';
import { mixFeatures, mixSuggestions, type KeyRelation, type MixSuggestion } from '../audio/mixSuggestions';

type Key = { tonic: number; mode: 'major' | 'minor' };

/** Tempo and key exactly as the track panel shows them: a file/folder name tag wins over the audio estimate. */
export function shownTempoKey(node: Pick<DocNode, 'path' | 'title' | 'audio'>) {
  const hints = musicNameHints(node);
  const audio = node.audio;
  const bpm = hints.tempo ? hints.tempo.value : audio?.tempo?.bpm;
  const key = hints.key ? hints.key.value : audio?.key ? { tonic: audio.key.tonic, mode: audio.key.mode } : undefined;
  const keyLabel = hints.key ? hints.key.displayName : key ? `${KEY_NAMES[key.tonic]} ${key.mode}` : undefined;
  return { bpm: bpm !== undefined && Number.isFinite(bpm) ? Number(bpm.toFixed(1)) : undefined, key, keyLabel, hints };
}

/** Compact key for chips and rows: "Gm" / "E♭". */
export function shortKey(key: Key): string {
  return `${KEY_NAMES[key.tonic]}${key.mode === 'minor' ? 'm' : ''}`;
}

/** Leading words every title shares ("SHADOW UK1 Melodic Loop"), so labels can show what tells tracks apart.
 * Returns '' unless there are at least two titles and every one keeps a non-empty remainder. */
export function sharedTitlePrefix(titles: string[]): string {
  if (titles.length < 2) return '';
  const split = titles.map((t) => t.trim().split(/\s+/));
  let words = 0;
  while (split.every((w) => w.length > words + 1 && w[words].toLowerCase() === split[0][words].toLowerCase())) words += 1;
  return words ? `${split[0].slice(0, words).join(' ')} ` : '';
}

/** `title` without the words `sharedTitlePrefix` found, compared the same way (case-insensitive, any whitespace). */
export function stripTitlePrefix(title: string, prefix: string): string {
  const words = prefix.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return title;
  const match = title.match(new RegExp(`^\\s*((?:\\S+\\s+){${words.length}})`));
  if (!match) return title;
  const head = match[1].trim().split(/\s+/);
  const rest = title.slice(match[0].length);
  return rest && head.every((w, i) => w.toLowerCase() === words[i].toLowerCase()) ? rest : title;
}

export interface NeighbourReason { kind: Edge['kind'] | 'clash'; text: string; detail: string }
export interface MusicNeighbour {
  id: string; node: DocNode; reasons: NeighbourReason[]; score: number;
  /** In a compatible key and within beatmatching range (from mixSuggestions), not only linked in the graph. */
  mixable: boolean;
}

const REASON_ORDER: Edge['kind'][] = ['similar', 'key', 'tempo', 'instrument', 'sound', 'genre', 'reference', 'title', 'semantic', 'keyword', 'entity', 'topic'];
/** A shared title phrase is a weak hint next to sound, key and tempo, so it ranks lower. */
const KIND_RANK_WEIGHT: Partial<Record<Edge['kind'], number>> = { title: 0.5 };
const KEY_CHIP: Record<KeyRelation, string> = {
  'same key': 'Same key', adjacent: 'Adjacent key', relative: 'Relative key', diagonal: 'Diagonal key', 'two steps': 'Two keys away', clash: 'Key clash',
};

/** Chips stay one line: the first three shared labels, then a count (hover shows them all). */
const shortList = (list: string) => {
  const items = list.split(', ');
  return items.length > 3 ? `${items.slice(0, 3).join(', ')} +${items.length - 3}` : list;
};
const bpmDelta = (self: number | undefined, other: number | undefined): string => {
  const delta = self !== undefined && other !== undefined ? Math.round((other - self) * 10) / 10 : undefined;
  return delta === undefined || delta === 0 ? 'Same BPM' : `${delta > 0 ? '+' : '−'}${Math.abs(delta)} BPM`;
};

function reasonFor(edge: Edge, self: DocNode, other: DocNode): NeighbourReason {
  const evidence = edge.evidence[0] ?? '';
  const detail = evidence;
  switch (edge.kind) {
    case 'similar': {
      const pct = evidence.match(/(\d+)% similar/)?.[1] ?? String(Math.floor(edge.weight * 100));
      return { kind: edge.kind, text: `Sounds ${pct}% alike`, detail };
    }
    case 'key': {
      const text = /relative/.test(evidence) ? 'Relative key' : /neighboring/.test(evidence) ? 'Adjacent key' : 'Same key';
      return { kind: edge.kind, text, detail };
    }
    case 'tempo':
      if (/^Half\/double/.test(evidence)) return { kind: edge.kind, text: 'Half/double time', detail };
      return { kind: edge.kind, text: bpmDelta(shownTempoKey(self).bpm, shownTempoKey(other).bpm), detail };
    case 'instrument': {
      const list = evidence.match(/^Shared instruments?(?: hints)?: ([^.]+)\./)?.[1];
      return { kind: edge.kind, text: list ? `Both: ${shortList(list)}` : 'Shared instruments', detail };
    }
    case 'sound': {
      const list = evidence.match(/^Shared sound properties: ([^.]+)\./)?.[1]?.replace(/ \([^)]*\)/g, '');
      return { kind: edge.kind, text: list ? `Both: ${shortList(list)}` : 'Shared sound', detail };
    }
    case 'genre': {
      const genre = evidence.match(/^Same estimated genre: ([^.]+)\./)?.[1];
      return { kind: edge.kind, text: genre ? `Both ${genre}` : 'Same genre', detail };
    }
    case 'title':
      return { kind: edge.kind, text: 'Similar name', detail };
    case 'version':
      return { kind: edge.kind, text: evidence.startsWith('Same recording') ? 'Same recording' : 'Other version', detail };
    case 'reference':
      return { kind: edge.kind, text: edge.authored ? 'Your link' : 'Reference', detail: evidence.replace(/^Your relationship: /, '') };
    default:
      return { kind: edge.kind, text: edge.kind, detail };
  }
}

/** Key, tempo and sound-alike chips for a mix suggestion, each with the suggestion's own wording on hover. */
function mixReasons(row: MixSuggestion, selfBpm: number | undefined): NeighbourReason[] {
  const out: NeighbourReason[] = [];
  const said = (prefix: RegExp) => row.reasons.find((r) => prefix.test(r)) ?? '';
  if (row.similarity !== undefined && row.similarity >= 0.7) out.push({ kind: 'similar', text: `Sounds ${Math.floor(row.similarity * 100)}% alike`, detail: said(/^sounds /) });
  if (row.keyRelation) out.push({ kind: row.keyRelation === 'clash' ? 'clash' : 'key', text: KEY_CHIP[row.keyRelation], detail: said(/^\d+[AB] /) });
  if (row.tempoRelation) out.push({ kind: 'tempo', text: row.tempoRelation === 'same' ? bpmDelta(selfBpm, row.bpm) : `${row.tempoRelation === 'half' ? 'Half' : 'Double'} time`, detail: said(/BPM/) });
  return out;
}

/** Big libraries can have hundreds of compatible tracks; the list keeps the best few. */
export const MIX_LIMIT = 20;

/** One list per track: tracks that mix with this one (compatible key, beatmatchable tempo; see mixSuggestions) come
 * first, then other tracks the graph links to it. Each row carries every reason, so no track is listed twice. */
export function musicNeighbours(node: DocNode, edges: Edge[], nodes: DocNode[], nodeIndex: Record<string, number>): MusicNeighbour[] {
  const byId = new Map<string, { node: DocNode; edges: Edge[] }>();
  for (const edge of edges) {
    const otherId = edge.source === node.id ? edge.target : edge.target === node.id ? edge.source : undefined;
    if (!otherId) continue;
    const other = nodes[nodeIndex[otherId]];
    if (!other || other.fileType !== 'audio') continue;
    const entry = byId.get(otherId) ?? { node: other, edges: [] };
    entry.edges.push(edge);
    byId.set(otherId, entry);
  }
  const edgeReasons = (other: DocNode, linked: Edge[]) => [...linked]
    .sort((a, b) => REASON_ORDER.indexOf(a.kind) - REASON_ORDER.indexOf(b.kind))
    .map((e) => reasonFor(e, node, other));
  const selfBpm = node.audio ? mixFeatures(node).tempo?.bpm : undefined;
  const mixable = mixSuggestions(node, nodes, { limit: MIX_LIMIT }).map((row): MusicNeighbour => {
    // Tempo, key and sound-alike come from the mix ranking; graph links add what it does not cover.
    const extra = edgeReasons(row.node, (byId.get(row.node.id)?.edges ?? []).filter((e) => !['tempo', 'key', 'similar'].includes(e.kind)));
    return { id: row.node.id, node: row.node, reasons: [...mixReasons(row, selfBpm), ...extra], score: row.score, mixable: true };
  });
  const shown = new Set(mixable.map((row) => row.id));
  const linked = [...byId].filter(([id]) => !shown.has(id)).map(([id, { node: other, edges: links }]): MusicNeighbour => {
    const ranked = links.map((e) => e.weight * (KIND_RANK_WEIGHT[e.kind] ?? 1));
    return { id, node: other, reasons: edgeReasons(other, links), score: Math.max(...ranked) + 0.05 * (ranked.length - 1), mixable: false };
  }).sort((a, b) => b.score - a.score || a.node.title.localeCompare(b.node.title));
  return [...mixable, ...linked];
}

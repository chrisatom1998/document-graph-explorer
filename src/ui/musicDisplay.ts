import type { DocNode, Edge } from '../model/types';
import { musicNameHints } from '../audio/nameHints';
import { KEY_NAMES } from '../audio/musicTypes';

type Key = { tonic: number; mode: 'major' | 'minor' };

/** Camelot wheel code (8A = A minor, 8B = C major); a fifth up adds one, so 7 semitones step the wheel. */
export function camelotCode(key: Key): string {
  const fifths = (((key.tonic - (key.mode === 'minor' ? 9 : 0)) * 7) % 12 + 12) % 12;
  return `${((7 + fifths) % 12) + 1}${key.mode === 'minor' ? 'A' : 'B'}`;
}

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

export interface NeighbourReason { kind: Edge['kind']; text: string; detail: string }
export interface MusicNeighbour { id: string; node: DocNode; reasons: NeighbourReason[]; score: number }

const REASON_ORDER: Edge['kind'][] = ['similar', 'key', 'tempo', 'instrument', 'sound', 'reference', 'title', 'semantic', 'keyword', 'entity', 'topic'];
/** A shared title phrase is a weak hint next to sound, key and tempo, so it ranks lower. */
const KIND_RANK_WEIGHT: Partial<Record<Edge['kind'], number>> = { title: 0.5 };

/** Chips stay one line: the first three shared labels, then a count (hover shows them all). */
const shortList = (list: string) => {
  const items = list.split(', ');
  return items.length > 3 ? `${items.slice(0, 3).join(', ')} +${items.length - 3}` : list;
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
    case 'tempo': {
      if (/^Half\/double/.test(evidence)) return { kind: edge.kind, text: 'Half/double time', detail };
      const a = shownTempoKey(self).bpm, b = shownTempoKey(other).bpm;
      const delta = a !== undefined && b !== undefined ? Math.round((b - a) * 10) / 10 : undefined;
      return { kind: edge.kind, text: delta === undefined || delta === 0 ? 'Same BPM' : `${delta > 0 ? '+' : '−'}${Math.abs(delta)} BPM`, detail };
    }
    case 'instrument': {
      const list = evidence.match(/^Shared instruments?(?: hints)?: ([^.]+)\./)?.[1];
      return { kind: edge.kind, text: list ? `Both: ${shortList(list)}` : 'Shared instruments', detail };
    }
    case 'sound': {
      const list = evidence.match(/^Shared sound properties: ([^.]+)\./)?.[1]?.replace(/ \([^)]*\)/g, '');
      return { kind: edge.kind, text: list ? `Both: ${shortList(list)}` : 'Shared sound', detail };
    }
    case 'title':
      return { kind: edge.kind, text: 'Similar name', detail };
    case 'reference':
      return { kind: edge.kind, text: edge.authored ? 'Your link' : 'Reference', detail: evidence.replace(/^Your relationship: /, '') };
    default:
      return { kind: edge.kind, text: edge.kind, detail };
  }
}

/** One row per neighbouring track (not per link), strongest first, with every reason they are linked. */
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
  return [...byId].map(([id, { node: other, edges: linked }]) => {
    const ranked = linked.map((e) => e.weight * (KIND_RANK_WEIGHT[e.kind] ?? 1));
    const score = Math.max(...ranked) + 0.05 * (ranked.length - 1);
    const reasons = linked
      .sort((a, b) => REASON_ORDER.indexOf(a.kind) - REASON_ORDER.indexOf(b.kind))
      .map((e) => reasonFor(e, node, other));
    return { id, node: other, reasons, score };
  }).sort((a, b) => b.score - a.score || a.node.title.localeCompare(b.node.title));
}

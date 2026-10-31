import type { DocNode } from '../model/types';
import { resolveTempoKey } from './resolvedTempoKey';
import { SHORT_CLIP_MAX_SECONDS } from './shortClipModel';

export type ClipShape = 'loop' | 'one-shot';
export const CLIP_SHAPES: readonly ClipShape[] = ['loop', 'one-shot'];
type ShapeNode = Pick<DocNode, 'path' | 'title' | 'audio' | 'fileType'>;

const clean = (name: string) => name.replace(/[_()[\]{}-]+/g, ' ').replace(/\s+/g, ' ').trim();
const ONE_SHOT_WORD = /\b(?:one ?shots?|1 ?shots?)\b/i;
const LOOP_WORD = /\bloops?\b/i;
/** Longer than this is a song or a recording, not a loop. */
const LOOP_MAX_SECONDS = 120;

/** "loop" or "one-shot" from the file name, then the nearest folder that says. */
function namedShape(node: Pick<DocNode, 'path' | 'title'>): ClipShape | undefined {
  const parts = (node.path || node.title).replaceAll('\\', '/').split('/').filter(Boolean);
  const file = (parts.pop() ?? '').replace(/\.[a-z0-9]{1,8}$/i, '');
  for (const name of [file, ...parts.reverse()]) {
    const text = clean(name);
    if (ONE_SHOT_WORD.test(text)) return 'one-shot';
    if (LOOP_WORD.test(text)) return 'loop';
  }
  return undefined;
}

/** Whether the clip lasts a whole number of 4/4 bars at this tempo. A 0.06 s slack (or 0.2% on long loops)
 * covers trimmed tails and a tempo rounded to 0.1 BPM. On Chris's Cymatics folder, with each pack's BPM from
 * the file name, this caught 184 of 186 loops and no one-shots (reports/dj-tag-review-2026-10-10). */
export function lastsWholeBars(seconds: number, bpm: number): boolean {
  if (!(seconds > 0) || !(bpm >= 40 && bpm <= 250)) return false;
  const bar = 240 / bpm, bars = Math.round(seconds / bar);
  return bars >= 1 && Math.abs(seconds - bars * bar) <= Math.max(0.06, 0.002 * seconds);
}

const cache = new WeakMap<ShapeNode, ClipShape | null>();

/** Loop or one-shot, the first split in sample libraries. File and folder names win; otherwise a clip that lasts
 * whole bars at a steady tempo is a loop, and a short clip that does not is a one-shot. Anything else (songs,
 * long one-shots with no name hint, loops cut off-grid) stays unknown rather than guessed. */
export function clipShape(node: ShapeNode): ClipShape | undefined {
  if (node.fileType !== 'audio') return undefined;
  const hit = cache.get(node);
  if (hit !== undefined) return hit ?? undefined;
  // The name needs no analysis, so it also covers clips still being analysed or whose analysis failed.
  let shape = namedShape(node);
  const seconds = node.audio?.durationSeconds ?? 0;
  // A quick preview can carry a duration of 0 before the length is known; that is not a short clip.
  if (!shape && node.audio && Number.isFinite(seconds) && seconds > 0) {
    const { tempo } = resolveTempoKey(node);
    const steady = tempo && tempo.confidence >= 0.5 ? [tempo.bpm, ...(tempo.alternatives ?? [])] : [];
    if (seconds <= LOOP_MAX_SECONDS && steady.some(bpm => lastsWholeBars(seconds, bpm))) shape = 'loop';
    else if (seconds <= SHORT_CLIP_MAX_SECONDS) shape = 'one-shot';
  }
  cache.set(node, shape ?? null);
  return shape;
}

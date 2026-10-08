import type { DocNode } from '../model/types';
import { confidentSoundSummary } from './confidentSoundSummary';
import { filenameSoundFallback } from './filenameSoundFallback';

const cache = new WeakMap<DocNode, string[]>();

/**
 * The labels a clip's Sounds row shows (confirmed, model estimates including
 * maybe/possible/unverified ones, and file-name fallbacks), for the Sounds
 * filter. The dimmed "likely" extras are display only and are left out.
 * Nodes are replaced on every patch, so caching on the node object is safe.
 */
export function nodeSoundTags(node: DocNode): string[] {
  if (!node.audio) return [];
  const hit = cache.get(node);
  if (hit) return hit;
  const scored = confidentSoundSummary(node.audio);
  const tags = [...new Set([...scored, ...filenameSoundFallback(node.audio, node, scored)].map((s) => s.label))];
  cache.set(node, tags);
  return tags;
}

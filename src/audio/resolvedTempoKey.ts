import type { DocNode } from '../model/types';
import { keyName, type MusicAnalysis } from './musicTypes';
import { musicNameHints } from './nameHints';

type MusicalKey = Pick<NonNullable<MusicAnalysis['key']>, 'tonic' | 'mode'>;
type TempoKeyNode = Pick<DocNode, 'path' | 'title' | 'audio'>;
interface ResolvedTempoKey {
  hints: ReturnType<typeof musicNameHints>;
  tempo: MusicAnalysis['tempo'];
  key: MusicAnalysis['key'];
  keyLabel: string | undefined;
}

// Graph nodes are immutable snapshots. Labels refresh every ~120 ms, so reuse
// the parsed name fields until a rename or new analysis replaces the node.
const resolvedCache = new WeakMap<TempoKeyNode, ResolvedTempoKey>();

/** Resolve each field from the file name, nearest tagged folder, then audio.
 * Keep name provenance separate and leave the recorded estimates untouched. */
export function resolveTempoKey(node: TempoKeyNode): ResolvedTempoKey {
  const cached = resolvedCache.get(node);
  if (cached) return cached;
  const hints = musicNameHints(node);
  const tempo = hints.tempo ? { bpm: hints.tempo.value, confidence: 0.65 } : node.audio?.tempo;
  const key = hints.key ? { ...hints.key.value, strength: 0.65 } : node.audio?.key;
  const resolved = {
    hints,
    tempo: tempo && Number.isFinite(tempo.bpm) ? tempo : undefined,
    key,
    keyLabel: hints.key?.displayName ?? (key ? keyName(key) : undefined),
  };
  resolvedCache.set(node, resolved);
  return resolved;
}

const NATURAL_PITCH: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** Saved filters and name tags may spell the same key with sharps or flats. */
export function matchesKeyName(key: MusicalKey | undefined, label: string): boolean {
  if (!key) return false;
  const match = /^([a-g])([#b♯♭]?)\s+(major|minor)$/i.exec(label.trim());
  if (!match) return false;
  const accidental = match[2];
  const offset = accidental === '#' || accidental === '♯' ? 1 : accidental ? -1 : 0;
  const tonic = (NATURAL_PITCH[match[1].toUpperCase()] + offset + 12) % 12;
  return key.tonic === tonic && key.mode === match[3].toLowerCase();
}

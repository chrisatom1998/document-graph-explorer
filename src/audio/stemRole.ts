import type { DocNode } from '../model/types';
import { DJ_CATALOG } from './djTags';
import { nodeSoundTags } from './soundFilterTags';

/** The four parts DJ stem players (Rekordbox, Serato) and mix sessions split a track into. */
export type StemRole = 'drums' | 'bass' | 'vocals' | 'melody';
export const STEM_ROLES: readonly StemRole[] = ['drums', 'bass', 'vocals', 'melody'];

const DRUMS = ['drums', 'percussion', 'hand percussion', 'tabla', 'djembe', 'cajon', 'triangle', 'gong',
  'bass drum', 'cymbal', 'drum', 'drum kit', 'drum machine', 'hi-hat', 'jingle bell', 'maraca', 'rattle (instrument)',
  'snare drum', 'tambourine', 'timpani', 'wood block'];
// acid synth carries the merged acid bass label, and a 303 line usually sits in the bass part.
const BASS = ['bass guitar', 'double bass', 'synth bass', 'bass hit', 'acid synth'];
const VOCALS = ['voice', 'breath', 'vocal breath'];
const MELODY = ['synthesizer', 'guitar', 'piano', 'electric piano', 'acoustic guitar', 'electric guitar', 'strings',
  'violin / fiddle', 'cello', 'viola', 'trumpet', 'saxophone', 'flute', 'clarinet', 'organ', 'bell', 'mallet instrument',
  'harp', 'trombone', 'horn', 'tuba', 'oboe', 'bassoon', 'harmonica', 'accordion', 'banjo', 'ukulele', 'sitar', 'mandolin',
  'steel guitar', 'xylophone', 'marimba', 'vibraphone', 'steel drum', 'glockenspiel', 'kalimba', 'whistle', 'tuned percussion',
  'jaw harp', 'atmospheric pad', 'bagpipes', 'bowed string instrument', 'brass instrument', 'chime', 'didgeridoo',
  'electronic organ', 'french horn', 'hammond organ', 'harpsichord', 'keyboard (musical)', 'mallet percussion',
  'marimba / xylophone', 'plucked string instrument', 'shofar', 'steel guitar / slide guitar', 'steelpan', 'string section',
  'theremin', 'tubular bells', 'wind instrument / woodwind instrument', 'zither'];

/** Sound label to stem. Whole tag families map by family (every drum hit and pattern is drums, every bass tag is bass,
 * every vocal or voice-sourced tag is vocals, every synth tag but synth bass and acid synth is melody); effects, textures, ambiences and character
 * words belong to no stem. */
const ROLE = new Map<string, StemRole>();
for (const c of DJ_CATALOG) {
  const role: StemRole | undefined = c.family === 'drum-hit' || c.family === 'drum-pattern' ? 'drums'
    : c.family === 'bass' ? 'bass' : c.family === 'vocal' || c.source === 'voice' ? 'vocals'
    : c.family === 'synth' ? 'melody' : undefined;
  if (role) ROLE.set(c.label, role);
}
for (const [labels, role] of [[DRUMS, 'drums'], [BASS, 'bass'], [VOCALS, 'vocals'], [MELODY, 'melody']] as const) {
  for (const label of labels) ROLE.set(label, role);
}

export const stemRoleOf = (label: string): StemRole | undefined => ROLE.get(label);

const cache = new WeakMap<DocNode, StemRole[]>();

/** The stems a clip's Sounds row covers, in stem order. A full mix can cover all four; a riser covers none. */
export function nodeStemRoles(node: DocNode): StemRole[] {
  const hit = cache.get(node);
  if (hit) return hit;
  const found = new Set(nodeSoundTags(node).map(stemRoleOf));
  const roles = STEM_ROLES.filter(role => found.has(role));
  cache.set(node, roles);
  return roles;
}

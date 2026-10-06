import type { DocNode } from '../model/types';
import { INSTRUMENT_LABELS, INSTRUMENT_PARENTS } from './instrumentLabels';

export interface NamedHint<T> { value: T; source: 'file name' | 'folder name'; name: string }
export interface MusicNameHints {
  tempo?: NamedHint<number>;
  key?: NamedHint<{ tonic: number; mode: 'major' | 'minor' }> & { displayName: string };
  pitch?: NamedHint<number>;
  instruments?: NamedHint<string[]>;
}
const pitchClass = (note: string, accidental = '') =>
  (({ C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[note.toUpperCase()] ?? 0) + (accidental === '#' ? 1 : accidental.toLowerCase() === 'b' ? -1 : 0) + 12) % 12;
const clean = (name: string) => name.replace(/[♯]/g, '#').replace(/[♭]/g, 'b').replace(/[_()[\]{}-]+/g, ' ').replace(/\s+/g, ' ').trim();
// Packs that tag church modes ("Cphr", "A#lyd") name the root; it is a pitch, not a major/minor key.
const MODAL = /(?:^|\s)([A-G])([#b]?)(?:dor|dorian|phr|phrygian|lyd|lydian|mix|mixolydian|loc|locrian)(?=\s|$)/gi;
const MUSICAL = /\b(?:vocal|vocals|synth|synthesizer|loops?|samples?|pitch|note|oneshot|arp|pad|pads|chord|chords|chd|gtr|guitar|keys|piano|bass|lead|pluck|melody|melodic|riff|stab)\b/i;
const isTempoToken = (token = '') => /^\d{2,3}(?:\.\d+)?(?:\s*bpm)?$/i.test(token) && parseFloat(token) >= 40 && parseFloat(token) <= 250;
const unique = <T,>(values: T[]): T | undefined => {
  const found = [...new Map(values.map(v => [JSON.stringify(v), v])).values()];
  return found.length === 1 ? found[0] : undefined;
};

/** Only explicit musical tags count. A genre, "bass", or "melodic" is not an instrument. */
export function musicNameHints(node: Pick<DocNode, 'path' | 'title'>): MusicNameHints {
  const parts = (node.path || node.title).replaceAll('\\', '/').split('/').filter(Boolean);
  const file = (parts.pop() ?? '').replace(/\.[a-z0-9]{1,8}$/i, '');
  const hints: MusicNameHints = {};
  // A "Loops" folder makes a bare number in the file name a tempo ("Drum Loops/DL_Breaker_130.wav").
  const inLoopFolder = parts.some(part => /\bloops?\b/i.test(clean(part)));
  const musicalPath = [file, ...parts].some(part => MUSICAL.test(clean(part)));
  // Per-field precedence: file, closest folder, then its parents.
  for (const [index, name] of [file, ...parts.reverse()].entries()) {
    const source = index === 0 ? 'file name' as const : 'folder name' as const;
    const hint = <T,>(value: T): NamedHint<T> => ({ value, source, name });
    const text = clean(name);
    // In an all-caps name "AM" could be A minor, A major or amplitude modulation, so a lone "M" is not a mode there.
    const caseless = !/[a-z]/.test(name.replace(/♭/g, ''));
    const keyTags = [...text.matchAll(/(?:^|\s)([A-G])([#b]?)(?:\s*)(major|minor|maj|min|m)(?=\s|$)/gi)]
      .filter(m => !(caseless && m[3] === 'M'));
    const keys = keyTags.map(m => ({ tonic: pitchClass(m[1], m[2]), mode: m[3] !== 'M' && /^m(?:in|inor)?$/.test(m[3].toLowerCase()) ? 'minor' as const : 'major' as const }));
    const key = unique(keys);
    if (!hints.key && key) {
      const tag = keyTags[0];
      const accidental = tag[2] === '#' ? '♯' : tag[2] ? '♭' : '';
      // Keep the source spelling for display; numeric pitches still drive matching.
      hints.key = { ...hint(key), displayName: `${tag[1].toUpperCase()}${accidental} ${key.mode}` };
    }
    const notes = [...text.matchAll(/(?:^|\s)([A-G])([#b]?)[0-8](?=\s|$)/gi)].map(m => pitchClass(m[1], m[2]));
    const taggedNotes = [...text.matchAll(/(?:^|\s)(?:pitch|note)\s+([A-G])([#b]?)(?=\s|$)/gi)].map(m => pitchClass(m[1], m[2]));
    // Sample packs often tag vocals as "AY_D_140", without a major/minor mode.
    // Require musical context or an adjacent tempo to avoid ordinary title letters.
    // A tempo right before or after the note also counts ("Arp_137_D", "AY_D_140").
    const musical = MUSICAL.test(text);
    const nextToTempo = (m: RegExpMatchArray) => {
      const before = text.slice(0, m.index!).trim().split(' '), after = text.slice(m.index! + m[0].length).trim().split(' ');
      return [before.at(-1), before.slice(-2).join(' '), after[0], after.slice(0, 2).join(' ')].some(isTempoToken);
    };
    // A modal tag ("Cphr") is specific enough on its own as a whole name or anywhere in a musical path; "Bloc Party" is not.
    const bareNotes = [...[...text.matchAll(/(?:^|\s)([A-G])([#b]?)(?=\s|$)/g)].filter(m => musical || nextToTempo(m)),
      ...[...text.matchAll(MODAL)].filter(m => musicalPath || nextToTempo(m) || m[0].trim() === text)]
      .map(m => pitchClass(m[1], m[2]));
    const pitch = unique([...notes, ...taggedNotes, ...bareNotes, ...(key ? [key.tonic] : [])]);
    if (!hints.pitch && pitch !== undefined) hints.pitch = hint(pitch);
    const explicit = [...text.matchAll(/(?:^|\s)(?:(\d{2,3}(?:\.\d+)?)\s*bpm|bpm\s*(\d{2,3}(?:\.\d+)?))(?=\s|$)/gi)].map(m => Number(m[1] || m[2]));
    // Bare numbers need musical context, so track numbers and years aren't BPM tags.
    const numbers = explicit.length ? explicit : key || pitch !== undefined || /\b(?:loops?|tempo)\b/i.test(text) || (index === 0 && inLoopFolder)
      ? [...text.matchAll(/(?:^|\s)(\d{2,3}(?:\.\d+)?)(?=\s|$)/g)].map(m => Number(m[1])) : [];
    const bpm = unique(numbers.filter(n => n >= 40 && n <= 250));
    if (!hints.tempo && bpm !== undefined) hints.tempo = hint(bpm);
    const words = ` ${text.toLowerCase().replace(/\bsynths?\b|\bsynthesisers?\b|\bsynthesizers\b/g, 'synthesizer')} `;
    let labels = INSTRUMENT_LABELS.filter(label => words.includes(` ${label} `));
    const parents = new Set(labels.flatMap(label => INSTRUMENT_PARENTS[label] ?? []));
    labels = labels.filter(label => !parents.has(label));
    if (!hints.instruments && labels.length) hints.instruments = hint(labels);
  }
  return hints;
}

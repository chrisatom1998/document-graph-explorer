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
const unique = <T,>(values: T[]): T | undefined => {
  const found = [...new Map(values.map(v => [JSON.stringify(v), v])).values()];
  return found.length === 1 ? found[0] : undefined;
};

/** Only explicit musical tags count. A genre, "bass", or "melodic" is not an instrument. */
export function musicNameHints(node: Pick<DocNode, 'path' | 'title'>): MusicNameHints {
  const parts = (node.path || node.title).replaceAll('\\', '/').split('/').filter(Boolean);
  const file = (parts.pop() ?? '').replace(/\.[a-z0-9]{1,8}$/i, '');
  const hints: MusicNameHints = {};
  // Per-field precedence: file, closest folder, then its parents.
  for (const [index, name] of [file, ...parts.reverse()].entries()) {
    const source = index === 0 ? 'file name' as const : 'folder name' as const;
    const hint = <T,>(value: T): NamedHint<T> => ({ value, source, name });
    const text = name.replace(/[♯]/g, '#').replace(/[♭]/g, 'b').replace(/[_()[\]{}-]+/g, ' ').replace(/\s+/g, ' ').trim();
    const keyTags = [...text.matchAll(/(?:^|\s)([A-G])([#b]?)(?:\s*)(major|minor|maj|min|m)(?=\s|$)/gi)];
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
    const pitch = unique([...notes, ...taggedNotes, ...(key ? [key.tonic] : [])]);
    if (!hints.pitch && pitch !== undefined) hints.pitch = hint(pitch);
    const explicit = [...text.matchAll(/(?:^|\s)(?:(\d{2,3}(?:\.\d+)?)\s*bpm|bpm\s*(\d{2,3}(?:\.\d+)?))(?=\s|$)/gi)].map(m => Number(m[1] || m[2]));
    // Bare numbers need musical context, so track numbers and years aren't BPM tags.
    const numbers = explicit.length ? explicit : key || /\b(?:loops?|tempo)\b/i.test(text)
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

/**
 * Rekordbox collection XML export (the DJ_PLAYLISTS format Rekordbox reads via
 * Preferences > Advanced > Database > rekordbox xml).
 *
 * Writes what the track panel shows: a BPM/key written in the file or folder
 * name first, else the detected one, and the sound tags on the Sounds row. Tags go in Comments, with the Camelot key first so
 * they sort and search the way DJs expect.
 *
 * Deliberately left out:
 * - TEMPO beat-grid markers. A TEMPO element pins the grid to `Inizio`, and we
 *   never detect the first downbeat, so a guessed Inizio would hand Rekordbox
 *   a wrong grid. AverageBpm alone lets Rekordbox draw its own grid.
 * - Size, BitRate, SampleRate: we don't have the original file metadata, and
 *   Rekordbox fills them in when it reads the file.
 *
 * The browser only knows paths relative to the folder the user picked, so the
 * caller supplies each picked folder's absolute location on disk.
 */

import { confidentSoundSummary } from '../audio/confidentSoundSummary';
import { filenameSoundFallback } from '../audio/filenameSoundFallback';
import { musicNameHints } from '../audio/nameHints';
import type { DocNode } from '../model/types';
import { PRODUCT_NAME } from '../product/brand';

export const REKORDBOX_PLAYLIST_NAME = PRODUCT_NAME;

type Key = { tonic: number; mode: 'major' | 'minor' };

/** Rekordbox's classic key notation, indexed by pitch class (C = 0). */
const MAJOR_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const MINOR_NAMES = ['Cm', 'Dbm', 'Dm', 'Ebm', 'Em', 'Fm', 'F#m', 'Gm', 'Abm', 'Am', 'Bbm', 'Bm'];

export function rekordboxTonality(key: Key): string {
  return (key.mode === 'major' ? MAJOR_NAMES : MINOR_NAMES)[key.tonic];
}

/** Camelot wheel code, e.g. A minor → 8A, C major → 8B. */
export function camelotKey(key: Key): string {
  // Each wheel step is a fifth (+7 semitones) from B = 1B, and 7 is its own
  // inverse mod 12. A minor key sits on its relative major's number.
  const majorTonic = key.mode === 'major' ? key.tonic : (key.tonic + 3) % 12;
  const number = ((((majorTonic - 11) * 7) % 12) + 12) % 12 + 1;
  return `${number}${key.mode === 'major' ? 'B' : 'A'}`;
}

export interface RekordboxTrackData {
  bpm?: number;
  key?: Key;
  tags: string[];
}

/** The BPM, key and tags a track panel shows for this node. */
export function rekordboxTrackData(node: DocNode): RekordboxTrackData {
  const audio = node.audio;
  const hints = musicNameHints(node);
  // Same precedence as the track panel: a BPM or key written in the name wins.
  const bpm = hints.tempo?.value ?? audio?.tempo?.bpm;
  const key = hints.key?.value ?? (audio?.key ? { tonic: audio.key.tonic, mode: audio.key.mode } : undefined);
  let tags: string[] = [];
  if (audio) {
    const scored = confidentSoundSummary(audio);
    tags = [...new Set([...scored, ...filenameSoundFallback(audio, node, scored)].map(s => s.label))];
  }
  return { bpm, key, tags };
}

/** Top-level folder of a node's ingest path ('' for files added on their own). */
export function rekordboxRootName(node: DocNode): string {
  const parts = (node.path ?? '').replaceAll('\\', '/').split('/').filter(Boolean);
  return parts.length > 1 ? parts[0] : '';
}

/**
 * file://localhost URL for a file, given the absolute location of the folder
 * the user picked (or, for loose files, the folder they sit in). Returns
 * undefined when the folder location isn't an absolute path.
 */
export function rekordboxLocation(node: DocNode, folderPath: string): string | undefined {
  const folder = folderPath.trim().replaceAll('\\', '/').replace(/\/+$/, '');
  const windows = /^[A-Za-z]:(\/|$)/.test(folder);
  if (!windows && !folder.startsWith('/')) return undefined;
  const parts = (node.path || node.title).replaceAll('\\', '/').split('/').filter(Boolean);
  // The ingest path starts with the picked folder's own name; the folder path
  // the user typed already ends with it.
  const relative = parts.length > 1 ? parts.slice(1) : parts;
  const segments = [...folder.split('/').filter(Boolean), ...relative];
  const encoded = segments.map((segment, index) =>
    index === 0 && windows ? segment : encodeURIComponent(segment),
  );
  return `file://localhost/${encoded.join('/')}`;
}

/** Folder paths must end with the picked folder's name so nothing is guessed. */
export function folderPathMatchesRoot(folderPath: string, rootName: string): boolean {
  const folder = folderPath.trim().replaceAll('\\', '/').replace(/\/+$/, '');
  if (!/^([A-Za-z]:)?\//.test(folder)) return false;
  return rootName === '' || folder.split('/').at(-1) === rootName;
}

// XML 1.0 forbids most control characters even when escaped.
// eslint-disable-next-line no-control-regex
const INVALID_XML_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;

function attr(value: string | number): string {
  return String(value)
    .replace(INVALID_XML_CHARS, '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
    .replaceAll('\n', '&#10;')
    .replaceAll('\r', '&#13;')
    .replaceAll('\t', '&#9;');
}

const KIND_BY_EXTENSION: Record<string, string> = {
  mp3: 'MP3 File',
  wav: 'WAV File',
  aif: 'AIFF File',
  aiff: 'AIFF File',
  flac: 'FLAC File',
  m4a: 'M4A File',
  mp4: 'M4A File',
  aac: 'AAC File',
  ogg: 'OGG File',
};

export interface RekordboxExportOptions {
  /** Absolute folder location for each root name from rekordboxRootName. */
  folderPaths: Record<string, string>;
  playlistName?: string;
  now?: Date;
  productVersion?: string;
}

export interface RekordboxExportResult {
  xml: string;
  tracks: number;
  /** Audio files left out because their folder location was missing or invalid. */
  skipped: number;
  /**
   * Audio files left out because another file has the same path. That happens
   * when two folders with the same name were added from different places; the
   * browser can't tell them apart, so neither copy gets a guessed location.
   */
  ambiguous: number;
}

export function buildRekordboxXml(nodes: DocNode[], options: RekordboxExportOptions): RekordboxExportResult {
  const date = (options.now ?? new Date()).toISOString().slice(0, 10);
  const tracks: string[] = [];
  let skipped = 0;
  let ambiguous = 0;
  const audioNodes = nodes.filter(node => node.kind === 'document' && node.fileType === 'audio');
  const pathCounts = new Map<string, number>();
  for (const node of audioNodes) pathCounts.set(node.path || node.title, (pathCounts.get(node.path || node.title) ?? 0) + 1);
  for (const node of audioNodes) {
    if (pathCounts.get(node.path || node.title)! > 1) {
      ambiguous++;
      continue;
    }
    const root = rekordboxRootName(node);
    const folder = options.folderPaths[root];
    const location = folder && folderPathMatchesRoot(folder, root) ? rekordboxLocation(node, folder) : undefined;
    if (!location) {
      skipped++;
      continue;
    }
    const id = tracks.length + 1;
    const data = rekordboxTrackData(node);
    const fileName = (node.path || node.title).replaceAll('\\', '/').split('/').at(-1) ?? node.title;
    const extension = fileName.match(/\.([a-z0-9]{1,8})$/i)?.[1]?.toLowerCase() ?? '';
    const comments = [data.key ? camelotKey(data.key) : '', data.tags.join(', ')].filter(Boolean).join(' | ');
    const fields: [string, string | number][] = [
      ['TrackID', id],
      ['Name', fileName.replace(/\.[a-z0-9]{1,8}$/i, '')],
      ...(KIND_BY_EXTENSION[extension] ? [['Kind', KIND_BY_EXTENSION[extension]] as [string, string]] : []),
      ...(node.audio?.durationSeconds ? [['TotalTime', Math.round(node.audio.durationSeconds)] as [string, number]] : []),
      ...(data.bpm ? [['AverageBpm', data.bpm.toFixed(2)] as [string, string]] : []),
      ['DateAdded', date],
      ...(comments ? [['Comments', comments] as [string, string]] : []),
      ['Location', location],
      ...(data.key ? [['Tonality', rekordboxTonality(data.key)] as [string, string]] : []),
    ];
    tracks.push(`    <TRACK ${fields.map(([name, value]) => `${name}="${attr(value)}"`).join(' ')}/>`);
  }
  const playlist = options.playlistName ?? REKORDBOX_PLAYLIST_NAME;
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<DJ_PLAYLISTS Version="1.0.0">',
    `  <PRODUCT Name="${PRODUCT_NAME}" Version="${attr(options.productVersion ?? '1.0.0')}" Company=""/>`,
    `  <COLLECTION Entries="${tracks.length}">`,
    ...tracks,
    '  </COLLECTION>',
    '  <PLAYLISTS>',
    '    <NODE Type="0" Name="ROOT" Count="1">',
    `      <NODE Name="${attr(playlist)}" Type="1" KeyType="0" Entries="${tracks.length}">`,
    ...tracks.map((_, index) => `        <TRACK Key="${index + 1}"/>`),
    '      </NODE>',
    '    </NODE>',
    '  </PLAYLISTS>',
    '</DJ_PLAYLISTS>',
    '',
  ].join('\n');
  return { xml, tracks: tracks.length, skipped, ambiguous };
}

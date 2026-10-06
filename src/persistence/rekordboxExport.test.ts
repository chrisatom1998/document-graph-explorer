import { describe, expect, it } from 'vitest';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import type { DocNode } from '../model/types';
import type { MusicAnalysis } from '../audio/musicTypes';
import {
  buildRekordboxXml,
  camelotKey,
  folderPathMatchesRoot,
  rekordboxLocation,
  rekordboxTonality,
} from './rekordboxExport';

/**
 * Attributes Rekordbox documents for each element of its collection XML
 * ("rekordbox xml format list"). Anything else would be silently dropped,
 * and a missing required attribute makes Rekordbox skip the element.
 */
const SCHEMA: Record<string, { required: string[]; optional: string[] }> = {
  DJ_PLAYLISTS: { required: ['Version'], optional: [] },
  PRODUCT: { required: ['Name', 'Version', 'Company'], optional: [] },
  COLLECTION: { required: ['Entries'], optional: [] },
  TRACK: {
    required: ['TrackID', 'Location'],
    optional: ['Name', 'Artist', 'Composer', 'Album', 'Grouping', 'Genre', 'Kind', 'Size', 'TotalTime', 'DiscNumber',
      'TrackNumber', 'Year', 'AverageBpm', 'DateAdded', 'BitRate', 'SampleRate', 'Comments', 'PlayCount', 'Rating',
      'Remixer', 'Tonality', 'Label', 'Mix'],
  },
  PLAYLIST_TRACK: { required: ['Key'], optional: [] },
  FOLDER_NODE: { required: ['Type', 'Name', 'Count'], optional: [] },
  PLAYLIST_NODE: { required: ['Type', 'Name', 'Entries', 'KeyType'], optional: [] },
};

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', parseAttributeValue: false, isArray: name => name === 'TRACK' || name === 'NODE' });
type Element = Record<string, unknown>;

function checkAttributes(element: Element, kind: keyof typeof SCHEMA): void {
  const { required, optional } = SCHEMA[kind];
  const attributes = Object.keys(element).filter(name => typeof element[name] === 'string');
  for (const name of required) expect(attributes, `${kind} needs ${name}`).toContain(name);
  for (const name of attributes) expect([...required, ...optional], `${kind} has undocumented ${name}`).toContain(name);
}

function parseAndValidate(xml: string) {
  expect(XMLValidator.validate(xml)).toBe(true);
  const doc = parser.parse(xml) as { DJ_PLAYLISTS: Element };
  const root = doc.DJ_PLAYLISTS;
  checkAttributes(root, 'DJ_PLAYLISTS');
  checkAttributes(root.PRODUCT as Element, 'PRODUCT');
  const collection = root.COLLECTION as Element;
  checkAttributes(collection, 'COLLECTION');
  const tracks = (collection.TRACK as Element[] | undefined) ?? [];
  expect(Number(collection.Entries)).toBe(tracks.length);
  for (const track of tracks) {
    checkAttributes(track, 'TRACK');
    expect(String(track.Location)).toMatch(/^file:\/\/localhost\//);
    if (track.AverageBpm !== undefined) expect(String(track.AverageBpm)).toMatch(/^\d+\.\d{2}$/);
    if (track.TotalTime !== undefined) expect(String(track.TotalTime)).toMatch(/^\d+$/);
    if (track.DateAdded !== undefined) expect(String(track.DateAdded)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  }
  const [folder] = (root.PLAYLISTS as Element).NODE as Element[];
  checkAttributes(folder, 'FOLDER_NODE');
  expect(folder.Type).toBe('0');
  const [playlist] = folder.NODE as Element[];
  checkAttributes(playlist, 'PLAYLIST_NODE');
  expect(playlist.Type).toBe('1');
  const keys = ((playlist.TRACK as Element[] | undefined) ?? []).map(t => { checkAttributes(t, 'PLAYLIST_TRACK'); return t.Key; });
  expect(Number(playlist.Entries)).toBe(keys.length);
  // KeyType 0 means playlist entries reference COLLECTION TrackIDs.
  expect(keys).toEqual(tracks.map(t => t.TrackID));
  return tracks;
}

function audioNode(path: string, audio: Partial<MusicAnalysis> = {}): DocNode {
  return {
    id: path, kind: 'document', title: path.split('/').at(-1)!, fileType: 'audio', path,
    topics: [], entities: [], keywords: [], wordCount: 0, cluster: 0, degree: 0, status: 'ok',
    audio: { version: 2, analyzedSeconds: 30, durationSeconds: 245.6, instruments: [], notes: [], ...audio },
  } as DocNode;
}

describe('Rekordbox key notation', () => {
  it('maps every key onto the Camelot wheel', () => {
    expect(camelotKey({ tonic: 9, mode: 'minor' })).toBe('8A');
    expect(camelotKey({ tonic: 0, mode: 'major' })).toBe('8B');
    expect(camelotKey({ tonic: 11, mode: 'major' })).toBe('1B');
    expect(camelotKey({ tonic: 8, mode: 'minor' })).toBe('1A');
    expect(camelotKey({ tonic: 4, mode: 'major' })).toBe('12B');
    expect(camelotKey({ tonic: 2, mode: 'minor' })).toBe('7A');
    const codes = new Set(Array.from({ length: 24 }, (_, i) => camelotKey({ tonic: i % 12, mode: i < 12 ? 'major' : 'minor' })));
    expect(codes.size).toBe(24);
  });

  it('writes the classic key names Rekordbox shows', () => {
    expect(rekordboxTonality({ tonic: 9, mode: 'minor' })).toBe('Am');
    expect(rekordboxTonality({ tonic: 6, mode: 'minor' })).toBe('F#m');
    expect(rekordboxTonality({ tonic: 3, mode: 'major' })).toBe('Eb');
  });
});

describe('Rekordbox file locations', () => {
  it('keeps the original names and percent-encodes them per segment', () => {
    const node = audioNode('My Crate/Sets 2026/Track #1 (Remix) & Co – é.mp3');
    expect(rekordboxLocation(node, '/Users/chris/Music/My Crate'))
      .toBe('file://localhost/Users/chris/Music/My%20Crate/Sets%202026/Track%20%231%20(Remix)%20%26%20Co%20%E2%80%93%20%C3%A9.mp3');
    const decoded = decodeURIComponent(new URL(rekordboxLocation(node, '/Users/chris/Music/My Crate')!).pathname);
    expect(decoded).toBe('/Users/chris/Music/My Crate/Sets 2026/Track #1 (Remix) & Co – é.mp3');
  });

  it('handles Windows drive paths and loose files', () => {
    expect(rekordboxLocation(audioNode('DJ/a.wav'), 'C:\\Music\\DJ\\')).toBe('file://localhost/C:/Music/DJ/a.wav');
    expect(rekordboxLocation(audioNode('loop.wav'), '/Users/chris/Downloads')).toBe('file://localhost/Users/chris/Downloads/loop.wav');
  });

  it('only accepts an absolute path that ends with the picked folder', () => {
    expect(folderPathMatchesRoot('/Users/chris/Music/DJ', 'DJ')).toBe(true);
    expect(folderPathMatchesRoot('/Users/chris/Music/DJ/', 'DJ')).toBe(true);
    expect(folderPathMatchesRoot('D:\\DJ', 'DJ')).toBe(true);
    expect(folderPathMatchesRoot('/Users/chris/Music', 'DJ')).toBe(false);
    expect(folderPathMatchesRoot('Music/DJ', 'DJ')).toBe(false);
    expect(folderPathMatchesRoot('/Users/chris/Downloads', '')).toBe(true);
  });
});

describe('buildRekordboxXml', () => {
  const nodes = [
    audioNode('DJ/Bass "Line" <1>.wav', {
      tempo: { bpm: 174, confidence: 0.9 },
      key: { tonic: 9, mode: 'minor', strength: 0.7 },
      confirmedInstruments: ['drums', 'bass'],
    }),
    // Nothing detected: the file name's key and BPM fill in.
    audioNode('DJ/Loops/SHADOW_UK1_Melodic_Loop_Fight_Gm_140.wav', { durationSeconds: 13.7 }),
    audioNode('Elsewhere/skip.mp3', { tempo: { bpm: 120, confidence: 1 } }),
    { ...audioNode('DJ/notes.md'), fileType: 'md', audio: undefined } as DocNode,
  ];

  it('produces a schema-valid collection that round-trips', () => {
    const { xml, tracks, skipped } = buildRekordboxXml(nodes, {
      folderPaths: { DJ: '/Users/chris/Music/DJ', Elsewhere: '/Users/chris/Music' },
      now: new Date('2026-10-06T12:00:00Z'),
    });
    expect(tracks).toBe(2);
    expect(skipped).toBe(1);
    const parsed = parseAndValidate(xml);
    expect(parsed).toHaveLength(2);
    const [first, second] = parsed;
    expect(first).toMatchObject({
      TrackID: '1', Name: 'Bass "Line" <1>', Kind: 'WAV File', TotalTime: '246', AverageBpm: '174.00',
      Tonality: 'Am', DateAdded: '2026-10-06', Comments: '8A | drums, bass',
      Location: 'file://localhost/Users/chris/Music/DJ/Bass%20%22Line%22%20%3C1%3E.wav',
    });
    expect(second).toMatchObject({ TrackID: '2', AverageBpm: '140.00', Tonality: 'Gm', TotalTime: '14' });
    expect(String(second.Comments)).toMatch(/^6A/);
  });

  it('writes an empty but valid collection when no folder is known', () => {
    const { xml, tracks, skipped } = buildRekordboxXml(nodes, { folderPaths: {} });
    expect(tracks).toBe(0);
    expect(skipped).toBe(3);
    expect(XMLValidator.validate(xml)).toBe(true);
  });

  it('prefers a BPM and key in the name, like the track panel', () => {
    const node = audioNode('DJ/Loop_Dm_140.wav', { tempo: { bpm: 70, confidence: 0.9 }, key: { tonic: 9, mode: 'minor', strength: 0.8 } });
    const [track] = parseAndValidate(buildRekordboxXml([node], { folderPaths: { DJ: '/x/DJ' } }).xml);
    expect(track).toMatchObject({ AverageBpm: '140.00', Tonality: 'Dm' });
  });

  it('leaves out files whose path is shared by same-named folders', () => {
    const { xml, tracks, ambiguous } = buildRekordboxXml(
      [audioNode('Crate/a.mp3'), { ...audioNode('Crate/a.mp3'), id: 'other' }, audioNode('Crate/b.mp3')],
      { folderPaths: { Crate: '/x/Crate' } },
    );
    expect(tracks).toBe(1);
    expect(ambiguous).toBe(2);
    expect(parseAndValidate(xml).map(t => t.Location)).toEqual(['file://localhost/x/Crate/b.mp3']);
  });

  it('strips characters XML cannot carry', () => {
    const { xml } = buildRekordboxXml([audioNode('DJ/odd\u0001name.mp3')], { folderPaths: { DJ: '/x/DJ' } });
    expect(XMLValidator.validate(xml)).toBe(true);
    expect(xml).not.toContain('\u0001');
  });
});

import { describe, expect, it } from 'vitest';
import { parseAudio } from './parseAudio';
import { namedRelationship } from './relationships';
import { routeFile, routeFileWithSniff } from '../ingest/fileRouter';
import type { DocNode } from '../model/types';
import { sanitizeGraphExport } from '../persistence/validateImport';
const node = (id: string): DocNode => ({ id, kind: 'document', title: id, fileType: 'audio', topics: [], entities: [], keywords: [], wordCount: 0, cluster: -1, degree: 0, status: 'ok' });
describe('audio graphs', () => {
  it.each(['mp3','wav','flac','aiff','opus','wma','m4a','aac','ape','dsf','mka','amr','caf'])('routes %s audio', (ext) => { expect(routeFile(`song.${ext}`)).toBe('audio'); });
  it('accepts an unfamiliar audio extension by MIME', () => { expect(routeFileWithSniff('recording.unknown', new ArrayBuffer(4), 'audio/x-custom')).toBe('audio'); });
  it('never turns binary audio into a transcript', () => {
    const parsed = parseAudio(new Uint8Array([255, 0, 255, 65]).buffer, 'my-track.flac');
    expect(parsed.text).toBe('My Track');
    expect(parsed.warning).toContain('pending');
    expect(() => parseAudio(new ArrayBuffer(0), 'empty.wav')).toThrow('empty');
  });
  it('preserves named relationships through graph export validation', () => {
    const nodes = [node('a'), node('b')];
    const edge = namedRelationship(nodes, 'b', 'a', ' Shared bassline ');
    expect(namedRelationship(nodes, 'a', 'b', 'Another reason').id).toBe(edge.id);
    const graph = sanitizeGraphExport({ version: 1, nodes, edges: [edge] });
    expect(graph.nodes[0].fileType).toBe('audio');
    expect(graph.edges[0].authored).toBe(true);
    expect(graph.edges[0].evidence).toEqual(['Your relationship: Shared bassline']);
  });
  it('rejects self links, missing tracks, and blank labels', () => {
    const nodes = [node('a'), node('b')];
    expect(() => namedRelationship(nodes, 'a', 'a', 'same')).toThrow();
    expect(() => namedRelationship(nodes, 'a', 'missing', 'same')).toThrow();
    expect(() => namedRelationship(nodes, 'a', 'b', ' ')).toThrow();
  });
});

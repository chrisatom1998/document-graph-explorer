/**
 * Regression coverage for the shared emphasis computation (spec §7.3),
 * extracted from Nodes.tsx into ./emphasis. Precedence is hover > selection >
 * search > filter; the filter facets (fileTypes/clusters/minDegree/
 * minEdgeWeight) compose with AND. The minEdgeWeight case is a regression
 * test: the pre-fix code omitted the edge-weight facet from `filterActive`,
 * so the link-strength slider dimmed edges (Edges.tsx's isEdgeHidden) but
 * left every node at full brightness (computeEmphasis returned null).
 */

import { describe, expect, it } from 'vitest';
import type { DocNode, Edge } from '../model/types';
import type { GraphFilter } from '../store/uiStore';
import { adjacencyFor, computeEmphasis, isFilterActive, nodesMatchingFilter } from './emphasis';
import type { MusicAnalysis } from '../audio/musicTypes';

function mkNode(overrides: Partial<DocNode> & { id: string }): DocNode {
  return {
    kind: 'document',
    title: overrides.id,
    fileType: 'md',
    topics: [],
    entities: [],
    keywords: [],
    wordCount: 10,
    cluster: 0,
    degree: 0,
    status: 'ok',
    ...overrides,
  };
}

function mkEdge(
  source: string,
  target: string,
  weight = 0.5,
  kind: Edge['kind'] = 'semantic',
): Edge {
  return { id: `${source}->${target}:${kind}`, source, target, kind, weight, evidence: [] };
}

const NO_FILTER: GraphFilter = {
  fileTypes: null,
  clusters: null,
  minDegree: 0,
  minEdgeWeight: 0,
  edgeKinds: null,
  modifiedWithinDays: null,
  bpmRange: null,
  musicKey: null,
  style: null,
  sounds: null,
};

describe('adjacencyFor', () => {
  it('builds a symmetric adjacency map from edges', () => {
    const edges = [mkEdge('a', 'b'), mkEdge('b', 'c')];
    const adj = adjacencyFor(edges);
    expect(adj.get('a')).toEqual(new Set(['b']));
    expect(adj.get('b')).toEqual(new Set(['a', 'c']));
    expect(adj.get('c')).toEqual(new Set(['b']));
  });

  it('memoizes on edges array identity', () => {
    const edges = [mkEdge('a', 'b')];
    expect(adjacencyFor(edges)).toBe(adjacencyFor(edges));
  });
});

describe('computeEmphasis', () => {
  const nodes = [mkNode({ id: 'a' }), mkNode({ id: 'b' }), mkNode({ id: 'c' })];
  const edges = [mkEdge('a', 'b'), mkEdge('b', 'c')];

  it('returns null when nothing is hovered/selected/searched/filtered', () => {
    expect(computeEmphasis(nodes, edges, null, null, null, NO_FILTER)).toBeNull();
  });

  it('hover: emphasizes the hovered node + its neighbors', () => {
    const set = computeEmphasis(nodes, edges, 'b', null, null, NO_FILTER);
    expect(set).toEqual(new Set(['b', 'a', 'c']));
  });

  it('selection: emphasizes the selected node + its neighbors when nothing is hovered', () => {
    const set = computeEmphasis(nodes, edges, null, 'a', null, NO_FILTER);
    expect(set).toEqual(new Set(['a', 'b']));
  });

  it('hover takes precedence over selection', () => {
    const set = computeEmphasis(nodes, edges, 'c', 'a', null, NO_FILTER);
    expect(set).toEqual(new Set(['c', 'b'])); // c's neighborhood, not a's
  });

  it('search: emphasizes results + their neighbors when nothing is hovered/selected', () => {
    const set = computeEmphasis(nodes, edges, null, null, ['a'], NO_FILTER);
    expect(set).toEqual(new Set(['a', 'b']));
  });

  it('search is ignored when a focus (hover/selection) is active', () => {
    const set = computeEmphasis(nodes, edges, 'a', null, ['c'], NO_FILTER);
    expect(set).toEqual(new Set(['a', 'b'])); // a's neighborhood, not c's search hit
  });

  it('filter: fileTypes facet keeps only matching nodes', () => {
    const mixed = [
      mkNode({ id: 'a', fileType: 'md' }),
      mkNode({ id: 'b', fileType: 'pdf' }),
    ];
    const set = computeEmphasis(mixed, [], null, null, null, {
      ...NO_FILTER,
      fileTypes: ['md'],
    });
    expect(set).toEqual(new Set(['a']));
  });

  it('filter: clusters facet keeps only matching nodes', () => {
    const mixed = [
      mkNode({ id: 'a', cluster: 0 }),
      mkNode({ id: 'b', cluster: 1 }),
    ];
    const set = computeEmphasis(mixed, [], null, null, null, {
      ...NO_FILTER,
      clusters: [1],
    });
    expect(set).toEqual(new Set(['b']));
  });

  it('filter: minDegree facet keeps only nodes at/above the floor', () => {
    const mixed = [
      mkNode({ id: 'a', degree: 0 }),
      mkNode({ id: 'b', degree: 3 }),
    ];
    const set = computeEmphasis(mixed, [], null, null, null, {
      ...NO_FILTER,
      minDegree: 2,
    });
    expect(set).toEqual(new Set(['b']));
  });

  it('filter: minDegree ignores synthetic topic-hub edges', () => {
    const mixed = [
      mkNode({ id: 'topic-only', degree: 1 }),
      mkNode({ id: 'connected', degree: 2 }),
      mkNode({ id: 'peer', degree: 1 }),
      mkNode({ id: 'topic:shared', kind: 'topic', fileType: 'other', degree: 2 }),
    ];
    const mixedEdges = [
      mkEdge('topic-only', 'topic:shared', 0.5, 'topic'),
      mkEdge('connected', 'topic:shared', 0.5, 'topic'),
      mkEdge('connected', 'peer', 0.8, 'reference'),
    ];
    const set = computeEmphasis(mixed, mixedEdges, null, null, null, {
      ...NO_FILTER,
      minDegree: 1,
    });
    expect(set).toEqual(new Set(['connected', 'peer']));
  });

  // --- regression: link-strength (minEdgeWeight) filter must also dim nodes ---
  it('filter: minEdgeWeight-only filter returns a non-null set (regression)', () => {
    // a-b and c-d clear the 0.5 floor; b-c and d-e don't. e has no
    // qualifying edge at all, so it must be excluded from the emphasis set.
    const weightNodes = [
      mkNode({ id: 'a' }),
      mkNode({ id: 'b' }),
      mkNode({ id: 'c' }),
      mkNode({ id: 'd' }),
      mkNode({ id: 'e' }),
    ];
    const weightEdges = [
      mkEdge('a', 'b', 0.8),
      mkEdge('b', 'c', 0.2),
      mkEdge('c', 'd', 0.6),
      mkEdge('d', 'e', 0.1),
    ];
    const set = computeEmphasis(weightNodes, weightEdges, null, null, null, {
      ...NO_FILTER,
      minEdgeWeight: 0.5,
    });
    expect(set).not.toBeNull();
    expect(set).toEqual(new Set(['a', 'b', 'c', 'd']));
  });

  it('filter: minEdgeWeight boundary is inclusive (weight === floor qualifies)', () => {
    const set = computeEmphasis(
      [mkNode({ id: 'a' }), mkNode({ id: 'b' })],
      [mkEdge('a', 'b', 0.5)],
      null,
      null,
      null,
      { ...NO_FILTER, minEdgeWeight: 0.5 },
    );
    expect(set).toEqual(new Set(['a', 'b']));
  });

  it('filter: minEdgeWeight composes with other facets via AND', () => {
    const mixed = [
      mkNode({ id: 'a', fileType: 'md' }),
      mkNode({ id: 'b', fileType: 'pdf' }),
    ];
    // a-b clears the weight floor, but b fails the fileTypes facet.
    const set = computeEmphasis(mixed, [mkEdge('a', 'b', 0.9)], null, null, null, {
      ...NO_FILTER,
      fileTypes: ['md'],
      minEdgeWeight: 0.5,
    });
    expect(set).toEqual(new Set(['a']));
  });

  it('filter: edgeKinds keeps nodes incident to an allowed kind', () => {
    const set = computeEmphasis(
      [mkNode({ id: 'a' }), mkNode({ id: 'b' }), mkNode({ id: 'c' })],
      [mkEdge('a', 'b', 0.9, 'reference'), mkEdge('b', 'c', 0.9, 'semantic')],
      null,
      null,
      null,
      { ...NO_FILTER, edgeKinds: ['reference'] },
    );
    expect(set).toEqual(new Set(['a', 'b']));
  });

  it('filter: one relationship must satisfy both kind and minimum strength', () => {
    const set = computeEmphasis(
      ['a', 'b', 'c', 'd'].map(id => mkNode({ id })),
      [
        mkEdge('a', 'b', 0.5, 'instrument'),
        mkEdge('a', 'b', 0.9, 'tempo'),
        mkEdge('c', 'd', 0.8, 'instrument'),
      ],
      null,
      null,
      null,
      { ...NO_FILTER, edgeKinds: ['instrument'], minEdgeWeight: 0.8 },
    );
    expect(set).toEqual(new Set(['c', 'd']));
  });

  it.each([
    { facet: 'tempo', filter: { bpmRange: [127, 129] as [number, number] } },
    { facet: 'key', filter: { musicKey: 'D minor' } },
  ])('filter: $facet follows filename and folder tags before detector estimates', ({ filter }) => {
    const conflictingAudio: DocNode['audio'] = {
      version: 2, durationSeconds: 4, analyzedSeconds: 4, instruments: [], notes: [],
      tempo: { bpm: 96, confidence: 0.9 }, key: { tonic: 0, mode: 'major', strength: 0.9 },
    };
    const mixed = [
      mkNode({ id: 'file', fileType: 'audio', path: '140bpm_Gmajor/Piano_128bpm_Dm.wav', audio: conflictingAudio }),
      mkNode({ id: 'folder', fileType: 'audio', path: '128bpm_Dm/clip.wav', audio: conflictingAudio }),
      mkNode({ id: 'estimated', fileType: 'audio', audio: { ...conflictingAudio, tempo: { bpm: 128, confidence: 0.9 }, key: { tonic: 2, mode: 'minor', strength: 0.9 } } }),
      mkNode({ id: 'different', fileType: 'audio', audio: conflictingAudio }),
    ];
    expect(computeEmphasis(mixed, [], null, null, null, { ...NO_FILTER, ...filter }))
      .toEqual(new Set(['file', 'folder', 'estimated']));
    expect(conflictingAudio.tempo?.bpm).toBe(96);
    expect(conflictingAudio.key?.tonic).toBe(0);
  });

  it('filter: explicit tempo and key tags work before estimates are available', () => {
    const mixed = [
      mkNode({ id: 'pending', fileType: 'audio', path: 'Piano_128bpm_Dm.wav' }),
      mkNode({ id: 'no-estimates', fileType: 'audio', path: '128bpm_Dm/clip.wav', audio: { version: 2, durationSeconds: 4, analyzedSeconds: 4, instruments: [], notes: [] } }),
      mkNode({ id: 'unknown', fileType: 'audio' }),
      mkNode({ id: 'document', fileType: 'md', path: 'Piano_128bpm_Dm.md' }),
    ];
    expect(computeEmphasis(mixed, [], null, null, null, {
      ...NO_FILTER, bpmRange: [127, 129], musicKey: 'D minor',
    })).toEqual(new Set(['pending', 'no-estimates']));
  });

  it.each(['D♯ minor', 'D# minor', 'E♭ minor', 'Eb minor'])(
    'filter: %s matches enharmonic keys while keeping major and minor distinct', musicKey => {
      const analysis: DocNode['audio'] = { version: 2, durationSeconds: 4, analyzedSeconds: 4, instruments: [], notes: [] };
      const mixed = [
        mkNode({ id: 'sharp', fileType: 'audio', path: 'Pad_D#m.wav', audio: analysis }),
        mkNode({ id: 'flat', fileType: 'audio', path: 'Pad_Ebm.wav', audio: analysis }),
        mkNode({ id: 'estimated', fileType: 'audio', audio: { ...analysis, key: { tonic: 3, mode: 'minor', strength: 0.9 } } }),
        mkNode({ id: 'major', fileType: 'audio', path: 'Pad_Ebmajor.wav', audio: analysis }),
        mkNode({ id: 'other', fileType: 'audio', path: 'Pad_Em.wav', audio: analysis }),
      ];
      expect(computeEmphasis(mixed, [], null, null, null, { ...NO_FILTER, musicKey }))
        .toEqual(new Set(['sharp', 'flat', 'estimated']));
    },
  );

  it('filter: modifiedWithinDays drops old and undated docs', () => {
    const now = 1_000_000_000_000;
    const set = computeEmphasis(
      [
        mkNode({ id: 'fresh', lastModified: now - 2 * 86_400_000 }),
        mkNode({ id: 'old', lastModified: now - 40 * 86_400_000 }),
        mkNode({ id: 'unknown' }),
      ],
      [],
      null,
      null,
      null,
      { ...NO_FILTER, modifiedWithinDays: 7 },
      now,
    );
    expect(set).toEqual(new Set(['fresh']));
  });

  it('search ∩ filter: search hits that fail the filter drop out', () => {
    const set = computeEmphasis(
      [mkNode({ id: 'a', fileType: 'md' }), mkNode({ id: 'b', fileType: 'pdf' })],
      [],
      null,
      null,
      ['a', 'b'],
      { ...NO_FILTER, fileTypes: ['md'] },
    );
    expect(set).toEqual(new Set(['a']));
  });
});

describe('loop or one-shot filter', () => {
  const clip = (id: string, path: string, durationSeconds: number): DocNode =>
    mkNode({ id, path, fileType: 'audio', audio: { version: 2, durationSeconds, analyzedSeconds: durationSeconds, instruments: [], notes: [] } as MusicAnalysis });
  const nodes = [clip('l', 'Drum Loops/a.wav', 8), clip('o', 'Kits/kick.wav', 0.5), clip('u', 'Kits/pad.wav', 9), mkNode({ id: 'doc' })];
  it('keeps only clips of the picked shape', () => {
    expect(nodesMatchingFilter(nodes, [], { ...NO_FILTER, clipShape: 'loop' })).toEqual(new Set(['l']));
    expect(nodesMatchingFilter(nodes, [], { ...NO_FILTER, clipShape: 'one-shot' })).toEqual(new Set(['o']));
    expect(isFilterActive({ ...NO_FILTER, clipShape: null })).toBe(false);
  });
});

describe('part filter', () => {
  const clip = (id: string, confirmedInstruments: string[]): DocNode =>
    mkNode({ id, fileType: 'audio', audio: { version: 2, durationSeconds: 8, analyzedSeconds: 8, instruments: [], notes: [], confirmedInstruments } as MusicAnalysis });
  const nodes = [clip('v', ['voice']), clip('m', ['piano', 'drums']), clip('d', ['drums']), mkNode({ id: 'doc' })];
  it('keeps clips whose sounds cover the picked stem', () => {
    expect(nodesMatchingFilter(nodes, [], { ...NO_FILTER, stem: 'drums' })).toEqual(new Set(['m', 'd']));
    expect(nodesMatchingFilter(nodes, [], { ...NO_FILTER, stem: 'vocals' })).toEqual(new Set(['v']));
    expect(isFilterActive({ ...NO_FILTER, stem: null })).toBe(false);
  });
});

describe('sounds filter', () => {
  const clip = (id: string, confirmedInstruments: string[]): DocNode =>
    mkNode({
      id,
      fileType: 'audio',
      audio: { version: 2, durationSeconds: 8, analyzedSeconds: 8, instruments: [], notes: [], confirmedInstruments } as MusicAnalysis,
    });
  const nodes = [clip('v', ['voice']), clip('s', ['synth', 'drums']), clip('d', ['drums']), mkNode({ id: 'doc' })];

  it('matches clips with any of the picked sounds', () => {
    const matched = nodesMatchingFilter(nodes, [], { ...NO_FILTER, sounds: ['voice', 'synth'] });
    expect([...(matched ?? [])].sort()).toEqual(['s', 'v']);
  });

  it('drops documents without audio and counts an empty pick as off', () => {
    expect(nodesMatchingFilter(nodes, [], { ...NO_FILTER, sounds: ['drums'] })).toEqual(new Set(['s', 'd']));
    expect(isFilterActive({ ...NO_FILTER, sounds: [] })).toBe(false);
    expect(nodesMatchingFilter(nodes, [], { ...NO_FILTER, sounds: [] })).toBeNull();
  });

  it('honours a later rejection of a confirmed sound', () => {
    const rejected = clip('r', ['voice']);
    rejected.audio!.soundReviews = [{ dimension: 'source', labelId: 'voice', decision: 'rejected', scope: 'track', at: 'now', evidenceRunId: 'x' }];
    expect(nodesMatchingFilter([rejected], [], { ...NO_FILTER, sounds: ['voice'] })).toEqual(new Set());
  });
});

describe('saved character-style compatibility', () => {
  it('keeps the old character facet AND the existing Sounds facet', () => {
    const clip = (id: string, character: string[], sources: string[]) => mkNode({
      id, fileType: 'audio', audio: {
        version: 2, durationSeconds: 8, analyzedSeconds: 8, instruments: [], notes: [],
        confirmedInstruments: sources,
        confirmedDjTags: { source: [], production: [], character },
      },
    });
    const nodes = [clip('both', ['warm'], ['voice']), clip('character-only', ['warm'], ['drums']), clip('sound-only', ['bright'], ['voice'])];
    expect(nodesMatchingFilter(nodes, [], { ...NO_FILTER, style: 'warm' })).toEqual(new Set(['both', 'character-only']));
    expect(nodesMatchingFilter(nodes, [], { ...NO_FILTER, style: 'warm', sounds: ['voice'] })).toEqual(new Set(['both']));
  });
});

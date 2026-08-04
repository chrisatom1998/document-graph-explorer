import { describe, expect, it } from 'vitest';
import {
  buildUsdaStage,
  nodeRadius,
  primName,
  usdString,
  type UsdEdgeInput,
  type UsdNodeInput,
  type UsdStageInput,
} from './usdExport';

function makeNode(overrides: Partial<UsdNodeInput> = {}): UsdNodeInput {
  return {
    id: 'abc123',
    kind: 'document',
    title: 'Doc Title',
    fileType: 'md',
    cluster: 0,
    degree: 4,
    status: 'ok',
    wordCount: 100,
    topics: ['alpha'],
    entities: ['Acme'],
    keywords: ['kw'],
    position: [1, 2, 3],
    color: [0.2, 0.4, 0.6],
    ...overrides,
  };
}

function makeStage(overrides: Partial<UsdStageInput> = {}): UsdStageInput {
  return {
    nodes: [makeNode()],
    edges: [],
    clusterNames: { 0: 'Alpha Cluster' },
    createdAt: '2026-08-04T00:00:00.000Z',
    ...overrides,
  };
}

describe('usdString', () => {
  it('escapes quotes, backslashes, and newlines', () => {
    expect(usdString('say "hi"\\now\nline')).toBe('"say \\"hi\\"\\\\now\\nline"');
  });

  it('strips control characters but keeps spaces and hyphens', () => {
    expect(usdString('a\u0000b\u0007c - d')).toBe('"abc - d"');
  });
});

describe('primName', () => {
  it('prefixes ids that start with a digit and sanitizes punctuation', () => {
    const taken = new Set<string>();
    expect(primName('Doc', '9f2a/xyz.md', taken)).toBe('Doc_9f2a_xyz_md');
  });

  it('resolves collisions with a numeric suffix', () => {
    const taken = new Set<string>();
    const a = primName('Doc', 'samesameSAME', taken);
    const b = primName('Doc', 'samesameSAME', taken);
    expect(a).not.toBe(b);
    expect(b).toMatch(/_2$/);
  });
});

describe('nodeRadius', () => {
  it('grows with degree and is capped', () => {
    expect(nodeRadius(0)).toBeCloseTo(0.9);
    expect(nodeRadius(4)).toBeGreaterThan(nodeRadius(1));
    expect(nodeRadius(10_000)).toBeCloseTo(2.5);
  });
});

describe('buildUsdaStage', () => {
  it('emits a valid header with defaultPrim and generator metadata', () => {
    const usda = buildUsdaStage(makeStage());
    expect(usda.startsWith('#usda 1.0')).toBe(true);
    expect(usda).toContain('defaultPrim = "Corpus"');
    expect(usda).toContain('string generator = "document-graph-explorer"');
    expect(usda).toContain('string createdAt = "2026-08-04T00:00:00.000Z"');
  });

  it('writes each node as a Sphere with position, color, and docGraph attrs', () => {
    const usda = buildUsdaStage(makeStage());
    expect(usda).toContain('def Sphere "Doc_abc123"');
    expect(usda).toContain('double3 xformOp:translate = (1, 2, 3)');
    expect(usda).toContain('color3f[] primvars:displayColor = [(0.2, 0.4, 0.6)]');
    expect(usda).toContain('custom string docGraph:title = "Doc Title"');
    expect(usda).toContain('custom string[] docGraph:topics = ["alpha"]');
    expect(usda).toContain('custom string[] docGraph:entities = ["Acme"]');
    expect(usda).toContain('custom int docGraph:wordCount = 100');
  });

  it('groups nodes under named cluster Xforms and emits hulls', () => {
    const usda = buildUsdaStage(
      makeStage({
        nodes: [
          makeNode({ id: 'a1', cluster: 0, position: [0, 0, 0] }),
          makeNode({ id: 'b2', cluster: 0, position: [4, 0, 0] }),
          makeNode({ id: 'c3', cluster: -1 }),
        ],
      }),
    );
    expect(usda).toContain('def Xform "Cluster_0"');
    expect(usda).toContain('custom string docGraph:clusterName = "Alpha Cluster"');
    expect(usda).toContain('def Xform "Unclustered"');
    // Hull at centroid (2,0,0), radius = max distance (2) + padding (2)
    expect(usda).toContain('def Sphere "Hull_0"');
    expect(usda).toContain('double3 xformOp:translate = (2, 0, 0)');
    expect(usda).toContain('double radius = 4');
    expect(usda).toContain('custom int docGraph:memberCount = 2');
    // No hull for the unclustered bucket
    expect(usda).not.toContain('Hull_-1');
  });

  it('groups edges by kind into BasisCurves with parallel metadata arrays', () => {
    const edges: UsdEdgeInput[] = [
      { source: 'a1', target: 'b2', kind: 'semantic', weight: 0.75, evidence: ['cos 0.75'] },
      { source: 'b2', target: 'a1', kind: 'reference', weight: 1, evidence: ['links to "a"'] },
    ];
    const usda = buildUsdaStage(
      makeStage({
        nodes: [
          makeNode({ id: 'a1', position: [0, 0, 0] }),
          makeNode({ id: 'b2', position: [1, 1, 1] }),
        ],
        edges,
      }),
    );
    expect(usda).toContain('def BasisCurves "Edges_semantic"');
    expect(usda).toContain('def BasisCurves "Edges_reference"');
    expect(usda).toContain('int[] curveVertexCounts = [2]');
    expect(usda).toContain('point3f[] points = [(0, 0, 0), (1, 1, 1)]');
    expect(usda).toContain('custom float[] docGraph:weights = [0.75]');
    expect(usda).toContain('custom string[] docGraph:evidence = ["cos 0.75"]');
    // Evidence with quotes must be escaped
    expect(usda).toContain('["links to \\"a\\""]');
  });

  it('drops edges whose endpoints have no exported position', () => {
    const usda = buildUsdaStage(
      makeStage({
        edges: [
          { source: 'abc123', target: 'missing', kind: 'semantic', weight: 0.5, evidence: [] },
        ],
      }),
    );
    expect(usda).not.toContain('Edges_semantic');
  });

  it('emits the graphView variantSet with both variants', () => {
    const usda = buildUsdaStage(makeStage());
    expect(usda).toContain('variantSet "graphView" = {');
    expect(usda).toContain('"detailed" {');
    expect(usda).toContain('"summary" {');
    // Overs must be multi-line: the USD text parser rejects single-line prim bodies.
    expect(usda).toContain(
      'over "ClusterHulls"\n            {\n                token visibility = "inherited"\n            }',
    );
  });

  it('balances braces', () => {
    const usda = buildUsdaStage(
      makeStage({
        nodes: [makeNode(), makeNode({ id: 'zz9', cluster: 2 })],
        edges: [
          { source: 'abc123', target: 'zz9', kind: 'keyword', weight: 0.4, evidence: ['kw'] },
        ],
      }),
    );
    const open = (usda.match(/{/g) ?? []).length;
    const close = (usda.match(/}/g) ?? []).length;
    expect(open).toBe(close);
  });
});

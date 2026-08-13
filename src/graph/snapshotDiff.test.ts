import { describe, expect, it } from 'vitest';
import type { DocNode, Edge } from '../model/types';
import { diffGraphs, formatDiffSummary, type GraphSlice } from './snapshotDiff';

function doc(id: string, path: string): DocNode {
  return {
    id,
    kind: 'document',
    title: path.split('/').pop() ?? path,
    path,
    fileType: 'md',
    topics: [],
    entities: [],
    keywords: [],
    wordCount: 10,
    cluster: 0,
    degree: 0,
    status: 'ok',
  } as DocNode;
}

function topic(id: string): DocNode {
  return { ...doc(id, id), kind: 'topic' } as DocNode;
}

function edge(source: string, target: string, kind: Edge['kind'] = 'semantic'): Edge {
  return { id: `${source}->${target}:${kind}`, source, target, kind, weight: 0.5, evidence: [] };
}

function slice(nodes: DocNode[], edges: Edge[] = []): GraphSlice {
  return { nodes, edges };
}

describe('diffGraphs', () => {
  it('reports identical graphs as no changes', () => {
    const s = slice([doc('a', 'x/a.md'), doc('b', 'x/b.md')], [edge('a', 'b')]);
    const d = diffGraphs(s, s);
    expect(d).toMatchObject({ addedDocs: 0, removedDocs: 0, updatedDocs: 0, addedEdges: 0, removedEdges: 0 });
    expect(formatDiffSummary(d)).toBe('No changes');
  });

  it('counts plain additions and removals', () => {
    const before = slice([doc('a', 'x/a.md'), doc('b', 'x/b.md')]);
    const after = slice([doc('a', 'x/a.md'), doc('c', 'x/c.md'), doc('d', 'x/d.md')]);
    const d = diffGraphs(before, after);
    expect(d.addedDocs).toBe(2);
    expect(d.removedDocs).toBe(1);
    expect(d.updatedDocs).toBe(0);
    expect(d.docsBefore).toBe(2);
    expect(d.docsAfter).toBe(3);
  });

  it('pairs an edited file (new content id, same path) as one update', () => {
    const before = slice([doc('a-v1', 'x/a.md'), doc('b', 'x/b.md')]);
    const after = slice([doc('a-v2', 'x/a.md'), doc('b', 'x/b.md')]);
    const d = diffGraphs(before, after);
    expect(d).toMatchObject({ addedDocs: 0, removedDocs: 0, updatedDocs: 1 });
    expect(d.updatedIds).toEqual(['a-v2']);
    expect(d.addedIds).toEqual([]);
    expect(d.removedLabels).toEqual([]);
  });

  it('an edited doc that kept its connections contributes zero edge churn', () => {
    const before = slice(
      [doc('a-v1', 'x/a.md'), doc('b', 'x/b.md')],
      [edge('a-v1', 'b')],
    );
    const after = slice(
      [doc('a-v2', 'x/a.md'), doc('b', 'x/b.md')],
      [edge('a-v2', 'b')],
    );
    const d = diffGraphs(before, after);
    expect(d.addedEdges).toBe(0);
    expect(d.removedEdges).toBe(0);
  });

  it('counts genuinely new and dropped connections, ignoring direction', () => {
    const before = slice(
      [doc('a', 'x/a.md'), doc('b', 'x/b.md'), doc('c', 'x/c.md')],
      [edge('a', 'b')],
    );
    const after = slice(
      [doc('a', 'x/a.md'), doc('b', 'x/b.md'), doc('c', 'x/c.md')],
      [edge('b', 'a'), edge('a', 'c')],
    );
    const d = diffGraphs(before, after);
    expect(d.addedEdges).toBe(1); // a-c is new; b-a is a-b reversed
    expect(d.removedEdges).toBe(0);
  });

  it('ignores topic nodes in document counts', () => {
    const before = slice([doc('a', 'x/a.md'), topic('t1')]);
    const after = slice([doc('a', 'x/a.md'), topic('t2')]);
    const d = diffGraphs(before, after);
    expect(d).toMatchObject({ addedDocs: 0, removedDocs: 0, docsBefore: 1, docsAfter: 1 });
  });

  it('formats a mixed diff readably', () => {
    const before = slice(
      [doc('a-v1', 'x/a.md'), doc('b', 'x/b.md'), doc('gone', 'x/gone.md')],
      [edge('b', 'gone')],
    );
    const after = slice(
      [doc('a-v2', 'x/a.md'), doc('b', 'x/b.md'), doc('new', 'x/new.md')],
      [edge('b', 'new')],
    );
    const d = diffGraphs(before, after);
    expect(formatDiffSummary(d)).toBe('+1 doc, −1 doc, 1 updated, +1/−1 connections');
  });
});

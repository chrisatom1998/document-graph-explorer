import { describe, expect, it } from 'vitest';
import { buildLinkIndex, resolveLinkTarget } from './linkResolver';
import type { DocNode } from '../model/types';

function doc(id: string, extra: Partial<DocNode> = {}): DocNode {
  return {
    id,
    kind: 'document',
    title: `Doc ${id}`,
    fileType: 'md',
    topics: [],
    entities: [],
    keywords: [],
    wordCount: 10,
    cluster: 0,
    degree: 0,
    status: 'ok',
    ...extra,
  };
}

describe('buildLinkIndex + resolveLinkTarget', () => {
  it('resolves a link by normalized basename (with extension)', () => {
    const index = buildLinkIndex([
      doc('a', { path: 'notes/setup.md' }),
      doc('b', { path: 'notes/other.md' }),
    ]);
    expect(resolveLinkTarget('setup.md', index)).toBe('a');
    expect(resolveLinkTarget('./setup.md', index)).toBe('a');
    expect(resolveLinkTarget('notes/setup.md', index)).toBe('a');
    expect(resolveLinkTarget('SETUP.MD', index)).toBe('a'); // case-insensitive
  });

  it('strips #fragment and ?query before matching', () => {
    const index = buildLinkIndex([doc('a', { path: 'guide.md' })]);
    expect(resolveLinkTarget('guide.md#section-2', index)).toBe('a');
    expect(resolveLinkTarget('guide.md?v=2', index)).toBe('a');
  });

  it('falls back to a title match for wikilinks without an extension', () => {
    const index = buildLinkIndex([doc('a', { path: 'notes/setup.md', title: 'Setup Guide' })]);
    expect(resolveLinkTarget('Setup Guide', index)).toBe('a');
    expect(resolveLinkTarget('setup guide', index)).toBe('a'); // case-insensitive
  });

  it('external URLs never resolve, even if they happen to share a basename', () => {
    const index = buildLinkIndex([doc('a', { path: 'setup.md' })]);
    expect(resolveLinkTarget('https://example.com/setup.md', index)).toBeNull();
    expect(resolveLinkTarget('mailto:a@example.com', index)).toBeNull();
    expect(resolveLinkTarget('//cdn.example.com/setup.md', index)).toBeNull();
  });

  it('returns null for empty input and for targets matching no document', () => {
    const index = buildLinkIndex([doc('a', { path: 'setup.md' })]);
    expect(resolveLinkTarget('', index)).toBeNull();
    expect(resolveLinkTarget('   ', index)).toBeNull();
    expect(resolveLinkTarget('nowhere.md', index)).toBeNull();
  });

  it('topic nodes are excluded from the index (only documents resolve)', () => {
    const index = buildLinkIndex([
      doc('a', { path: 'setup.md' }),
      doc('topic:x', { kind: 'topic', title: 'setup.md' }),
    ]);
    // the document at 'a' still resolves; the topic node's id is never
    // returned in its place even though its title collides
    expect(resolveLinkTarget('setup.md', index)).toBe('a');
  });

  it('first-doc-wins when two documents share a normalized basename', () => {
    const index = buildLinkIndex([
      doc('a', { path: 'v1/readme.md' }),
      doc('b', { path: 'v2/readme.md' }),
    ]);
    expect(resolveLinkTarget('readme.md', index)).toBe('a');
  });
});

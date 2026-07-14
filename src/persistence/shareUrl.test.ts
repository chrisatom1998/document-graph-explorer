import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DocNode, Edge, GraphExport } from '../model/types';
import {
  MAX_SHARE_COMPRESSED_BYTES,
  MAX_SHARE_DECODED_BYTES,
  MAX_SHARE_FRAGMENT_CHARS,
  SHARE_FRAGMENT_PREFIX,
  SHARE_RAW_TAG,
  ShareUrlError,
  createShareGraph,
  createShareUrl,
  decodeShareFragment,
  encodeShareFragment,
  extractShareFragment,
  hasShareFragment,
} from './shareUrl';

function node(id: string, extra: Partial<DocNode> = {}): DocNode {
  return {
    id,
    kind: 'document',
    title: `Document ${id}`,
    fileType: 'md',
    topics: ['café', '研究'],
    entities: ['München GmbH'],
    keywords: ['résumé'],
    wordCount: 120,
    cluster: 2,
    degree: 1,
    status: 'ok',
    ...extra,
  };
}

function graph(): GraphExport {
  const firstId = 'content-hash-and-path-a';
  const secondId = 'content-hash-and-path-b';
  const edge: Edge = {
    id: `${firstId}->${secondId}:semantic`,
    source: firstId,
    target: secondId,
    kind: 'semantic',
    weight: 0.82,
    evidence: ['shared topic: naïve Bayes'],
  };
  return {
    version: 1,
    createdAt: '2026-07-13T12:00:00.000Z',
    generator: 'knowledge-nebula',
    includeEmbeddings: true,
    clusterNames: { 2: 'Résumé & 研究' },
    nodes: [
      node(firstId, {
        title: 'Résumé — 東京',
        path: 'C:\\Users\\secret-user\\Private\\résumé.md',
        folderKey: 'C:\\Users\\secret-user\\Private',
        lastModified: 1_782_500_000_000,
        summary: 'Unicode survives: café, 東京, 🚀',
      }),
      node(secondId, { title: 'München notes' }),
    ],
    edges: [edge],
    embeddings: {
      [firstId]: 'QUFBQUFBQUFBQUFB',
      [secondId]: 'QkJCQkJCQkJCQkJC',
    },
  };
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
}

async function gzipForTest(bytes: Uint8Array): Promise<Uint8Array> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const stream = new Blob([copy.buffer])
    .stream()
    .pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('portable share-link graph', () => {
  it('redacts local-only fields and remaps every node and edge id', () => {
    const source = {
      ...graph(),
      corpusId: 'private-corpus-id',
      documentText: 'full private document text',
      settings: { apiKey: 'secret-key' },
      handle: { name: 'private-folder' },
    };
    const shared = createShareGraph(source);
    const serialized = JSON.stringify(shared);

    expect(shared.nodes.map((item) => item.id)).toEqual(['n0', 'n1']);
    expect(shared.edges).toEqual([
      expect.objectContaining({ id: 'e0', source: 'n0', target: 'n1' }),
    ]);
    expect(shared.nodes[0]).toEqual(
      expect.objectContaining({
        title: 'Résumé — 東京',
        summary: 'Unicode survives: café, 東京, 🚀',
        topics: ['café', '研究'],
      }),
    );
    expect('path' in shared.nodes[0]).toBe(false);
    expect('folderKey' in shared.nodes[0]).toBe(false);
    expect('lastModified' in shared.nodes[0]).toBe(false);
    expect(shared.includeEmbeddings).toBe(false);
    expect(shared.embeddings).toBeUndefined();
    expect(serialized).not.toContain('content-hash-and-path');
    expect(serialized).not.toContain('secret-user');
    expect(serialized).not.toContain('private-corpus-id');
    expect(serialized).not.toContain('full private document text');
    expect(serialized).not.toContain('secret-key');
    expect(serialized).not.toContain('private-folder');
  });

  it('round-trips gzip JSON and Unicode through a full URL', async () => {
    const expected = createShareGraph(graph());
    const fragment = await encodeShareFragment(graph());
    expect(fragment.startsWith(SHARE_FRAGMENT_PREFIX)).toBe(true);
    expect(fragment.startsWith(`${SHARE_FRAGMENT_PREFIX}${SHARE_RAW_TAG}`)).toBe(false);

    const decoded = await decodeShareFragment(`https://example.test/app/${fragment}`);
    expect(decoded).toEqual(expected);
    expect(decoded?.nodes[0].title).toBe('Résumé — 東京');
  });

  it('builds a clean URL without query state or corpus ids', async () => {
    const url = await createShareUrl(
      graph(),
      'https://example.test/app/?corpus=private-id&eval=retrieval#old',
    );
    expect(url).toMatch(/^https:\/\/example\.test\/app\/#graph=v1\./u);
    expect(url).not.toContain('?');
    expect(url).not.toContain('private-id');
  });

  it('uses an explicitly tagged raw fallback when compression streams are unavailable', async () => {
    vi.stubGlobal('CompressionStream', undefined);
    vi.stubGlobal('DecompressionStream', undefined);

    const fragment = await encodeShareFragment(graph());
    expect(fragment.startsWith(`${SHARE_FRAGMENT_PREFIX}${SHARE_RAW_TAG}`)).toBe(true);
    await expect(decodeShareFragment(fragment)).resolves.toEqual(createShareGraph(graph()));
  });

  it('extracts startup fragments without treating unrelated hashes as shares', () => {
    expect(extractShareFragment('https://example.test/#graph=v1.abc')).toBe('#graph=v1.abc');
    expect(hasShareFragment('#graph=v2.abc')).toBe(true);
    expect(extractShareFragment('#settings')).toBeNull();
    expect(hasShareFragment('https://example.test/')).toBe(false);
  });

  it('returns null when no share directive exists and rejects malformed directives', async () => {
    await expect(decodeShareFragment('#settings')).resolves.toBeNull();
    await expect(decodeShareFragment('#graph=v2.abc')).rejects.toMatchObject({
      code: 'unsupported',
    });
    await expect(decodeShareFragment(SHARE_FRAGMENT_PREFIX)).rejects.toMatchObject({
      code: 'malformed',
    });
    await expect(
      decodeShareFragment(`${SHARE_FRAGMENT_PREFIX}${SHARE_RAW_TAG}%%%`),
    ).rejects.toMatchObject({ code: 'malformed' });
    await expect(
      decodeShareFragment(`${SHARE_FRAGMENT_PREFIX}${SHARE_RAW_TAG}${bytesToBase64Url(new TextEncoder().encode('{bad json'))}`),
    ).rejects.toMatchObject({ code: 'malformed' });
    await expect(
      decodeShareFragment(`${SHARE_FRAGMENT_PREFIX}${bytesToBase64Url(new Uint8Array([1, 2, 3]))}`),
    ).rejects.toMatchObject({ code: 'malformed' });
  });

  it('re-sanitizes and redacts hand-crafted raw share payloads', async () => {
    const crafted = graph() as GraphExport & {
      corpusId?: string;
      documentText?: string;
    };
    crafted.corpusId = 'should-not-survive';
    crafted.documentText = 'private full text';
    const bytes = new TextEncoder().encode(JSON.stringify(crafted));
    const fragment = `${SHARE_FRAGMENT_PREFIX}${SHARE_RAW_TAG}${bytesToBase64Url(bytes)}`;

    const decoded = await decodeShareFragment(fragment);
    const serialized = JSON.stringify(decoded);
    expect(decoded?.nodes.map((item) => item.id)).toEqual(['n0', 'n1']);
    expect(serialized).not.toContain('secret-user');
    expect(serialized).not.toContain('should-not-survive');
    expect(serialized).not.toContain('private full text');
    expect(decoded?.embeddings).toBeUndefined();
  });

  it('rejects fragments and encoded byte payloads beyond their limits', async () => {
    const tooLong = `${SHARE_FRAGMENT_PREFIX}${'A'.repeat(MAX_SHARE_FRAGMENT_CHARS)}`;
    await expect(decodeShareFragment(tooLong)).rejects.toMatchObject({ code: 'too_large' });

    const tooManyBytes = new Uint8Array(MAX_SHARE_COMPRESSED_BYTES + 1);
    const encoded = bytesToBase64Url(tooManyBytes);
    const fragment = `${SHARE_FRAGMENT_PREFIX}${SHARE_RAW_TAG}${encoded}`;
    await expect(decodeShareFragment(fragment)).rejects.toMatchObject({ code: 'too_large' });
  });

  it('aborts bounded decompression when gzip expands beyond 2 MiB', async () => {
    const oversizedJson = JSON.stringify({
      version: 1,
      nodes: [],
      edges: [],
      padding: 'x'.repeat(MAX_SHARE_DECODED_BYTES + 1),
    });
    const compressed = await gzipForTest(new TextEncoder().encode(oversizedJson));
    expect(compressed.byteLength).toBeLessThan(MAX_SHARE_COMPRESSED_BYTES);
    const fragment = `${SHARE_FRAGMENT_PREFIX}${bytesToBase64Url(compressed)}`;

    await expect(decodeShareFragment(fragment)).rejects.toMatchObject({ code: 'too_large' });
  });

  it('surfaces a typed invalid-graph error before encoding', async () => {
    const invalid = { version: 1, nodes: [], edges: [] };
    const error = await encodeShareFragment(invalid).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ShareUrlError);
    expect(error).toMatchObject({ code: 'invalid_graph' });
  });
});

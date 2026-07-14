import type { DocNode, Edge, GraphExport } from '../model/types';
import { sanitizeGraphExport } from './validateImport';

/** Portable, backend-free graph links. URL fragments are never sent to the host. */
export const SHARE_FRAGMENT_PREFIX = '#graph=v1.';
export const SHARE_RAW_TAG = 'raw.';

/** 48 KiB becomes roughly 64 KiB after base64url encoding. */
export const MAX_SHARE_COMPRESSED_BYTES = 48 * 1024;
/** Prefix/tag slack above the approximately 64 KiB encoded payload. */
export const MAX_SHARE_FRAGMENT_CHARS = 64 * 1024 + 64;
/** Hard post-decompression ceiling, enforced while the stream is read. */
export const MAX_SHARE_DECODED_BYTES = 2 * 1024 * 1024;

export type ShareUrlErrorCode =
  | 'invalid_graph'
  | 'malformed'
  | 'too_large'
  | 'unsupported';

export class ShareUrlError extends Error {
  readonly code: ShareUrlErrorCode;

  constructor(code: ShareUrlErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ShareUrlError';
    this.code = code;
  }
}

function compactId(index: number): string {
  return `n${index.toString(36)}`;
}

/**
 * Build the intentionally limited graph that may leave the device in a URL.
 *
 * The regular GraphExport format can include path-shaped metadata, mtimes and
 * document vectors. Share links never do. Content-derived node/edge ids are
 * also replaced so links cannot be used to correlate the same local document
 * across separate exports.
 */
export function createShareGraph(input: unknown): GraphExport {
  let source: GraphExport;
  try {
    source = sanitizeGraphExport(input);
  } catch (error) {
    throw new ShareUrlError('invalid_graph', 'This graph cannot be shared.', { cause: error });
  }

  const idMap = new Map<string, string>();
  source.nodes.forEach((node, index) => idMap.set(node.id, compactId(index)));

  const nodes: DocNode[] = source.nodes.map((node, index) => {
    const shared: DocNode = {
      id: compactId(index),
      kind: node.kind,
      title: node.title,
      fileType: node.fileType,
      topics: [...node.topics],
      entities: [...node.entities],
      keywords: [...node.keywords],
      wordCount: node.wordCount,
      cluster: node.cluster,
      degree: node.degree,
      status: node.status,
    };
    if (node.summary !== undefined) shared.summary = node.summary;
    if (node.warning !== undefined) shared.warning = node.warning;
    return shared;
  });

  const edges: Edge[] = source.edges.map((edge, index) => ({
    id: `e${index.toString(36)}`,
    source: idMap.get(edge.source)!,
    target: idMap.get(edge.target)!,
    kind: edge.kind,
    weight: edge.weight,
    evidence: [...edge.evidence],
  }));

  return {
    version: 1,
    createdAt: source.createdAt,
    generator: 'knowledge-nebula',
    includeEmbeddings: false,
    clusterNames: { ...(source.clusterNames ?? {}) },
    nodes,
    edges,
  };
}

function compressionStreamsAvailable(): boolean {
  return (
    typeof CompressionStream === 'function' &&
    typeof DecompressionStream === 'function'
  );
}

function bytesToBase64Url(bytes: Uint8Array): string {
  if (typeof btoa !== 'function') {
    throw new ShareUrlError('unsupported', 'This browser cannot create share links.');
  }

  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, Math.min(bytes.length, offset + chunkSize));
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
}

function base64UrlToBytes(value: string): Uint8Array {
  if (
    value.length === 0 ||
    value.length % 4 === 1 ||
    !/^[A-Za-z0-9_-]+$/u.test(value)
  ) {
    throw new ShareUrlError('malformed', 'The shared graph link is malformed.');
  }
  if (typeof atob !== 'function') {
    throw new ShareUrlError('unsupported', 'This browser cannot open share links.');
  }

  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  let binary: string;
  try {
    binary = atob(padded);
  } catch (error) {
    throw new ShareUrlError('malformed', 'The shared graph link is malformed.', {
      cause: error,
    });
  }

  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function ownedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function readStreamBounded(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
  tooLargeMessage: string,
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new ShareUrlError('too_large', tooLargeMessage);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([ownedArrayBuffer(bytes)])
    .stream()
    .pipeThrough(new CompressionStream('gzip'));
  return readStreamBounded(
    stream,
    MAX_SHARE_COMPRESSED_BYTES,
    'This graph is too large for a share link. Export JSON instead.',
  );
}

async function gunzipBounded(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream !== 'function') {
    throw new ShareUrlError(
      'unsupported',
      'This browser cannot decompress shared graph links.',
    );
  }
  try {
    const stream = new Blob([ownedArrayBuffer(bytes)])
      .stream()
      .pipeThrough(new DecompressionStream('gzip'));
    return await readStreamBounded(
      stream,
      MAX_SHARE_DECODED_BYTES,
      'The shared graph expands beyond the safe size limit.',
    );
  } catch (error) {
    if (error instanceof ShareUrlError) throw error;
    throw new ShareUrlError('malformed', 'The shared graph could not be decompressed.', {
      cause: error,
    });
  }
}

/** Encode a sanitized graph as a complete location.hash value. */
export async function encodeShareFragment(input: unknown): Promise<string> {
  const graph = createShareGraph(input);
  const decoded = new TextEncoder().encode(JSON.stringify(graph));
  if (decoded.byteLength > MAX_SHARE_DECODED_BYTES) {
    throw new ShareUrlError(
      'too_large',
      'This graph is too large for a share link. Export JSON instead.',
    );
  }

  let encodedBytes: Uint8Array;
  let tag = '';
  if (compressionStreamsAvailable()) {
    encodedBytes = await gzip(decoded);
  } else {
    // Explicitly tagged so a decoder never mistakes raw JSON for gzip data.
    encodedBytes = decoded;
    tag = SHARE_RAW_TAG;
  }

  if (encodedBytes.byteLength > MAX_SHARE_COMPRESSED_BYTES) {
    throw new ShareUrlError(
      'too_large',
      'This graph is too large for a share link. Export JSON instead.',
    );
  }

  const fragment = `${SHARE_FRAGMENT_PREFIX}${tag}${bytesToBase64Url(encodedBytes)}`;
  if (fragment.length > MAX_SHARE_FRAGMENT_CHARS) {
    throw new ShareUrlError(
      'too_large',
      'This graph is too large for a share link. Export JSON instead.',
    );
  }
  return fragment;
}

/** Return the explicit #graph fragment from either a hash or a full URL. */
export function extractShareFragment(value: string): string | null {
  const hashIndex = value.indexOf('#');
  if (hashIndex < 0) return null;
  const hash = value.slice(hashIndex);
  return hash.startsWith('#graph=') ? hash : null;
}

export function hasShareFragment(value: string): boolean {
  return extractShareFragment(value) !== null;
}

/**
 * Decode and sanitize an incoming share fragment. Returns null when the URL
 * has no graph directive; an explicit but invalid/unsupported directive
 * throws so startup can show an error instead of restoring unrelated data.
 */
export async function decodeShareFragment(value: string): Promise<GraphExport | null> {
  const fragment = extractShareFragment(value);
  if (fragment === null) return null;
  if (!fragment.startsWith(SHARE_FRAGMENT_PREFIX)) {
    throw new ShareUrlError('unsupported', 'This shared graph version is not supported.');
  }
  if (fragment.length > MAX_SHARE_FRAGMENT_CHARS) {
    throw new ShareUrlError('too_large', 'The shared graph link exceeds the safe size limit.');
  }

  let token = fragment.slice(SHARE_FRAGMENT_PREFIX.length);
  const raw = token.startsWith(SHARE_RAW_TAG);
  if (raw) token = token.slice(SHARE_RAW_TAG.length);

  const encoded = base64UrlToBytes(token);
  if (encoded.byteLength > MAX_SHARE_COMPRESSED_BYTES) {
    throw new ShareUrlError('too_large', 'The shared graph link exceeds the safe size limit.');
  }

  let decoded: Uint8Array;
  if (raw) {
    decoded = encoded;
    if (decoded.byteLength > MAX_SHARE_DECODED_BYTES) {
      throw new ShareUrlError('too_large', 'The shared graph exceeds the safe size limit.');
    }
  } else {
    decoded = await gunzipBounded(encoded);
  }

  let parsed: unknown;
  try {
    const json = new TextDecoder('utf-8', { fatal: true }).decode(decoded);
    parsed = JSON.parse(json) as unknown;
  } catch (error) {
    throw new ShareUrlError('malformed', 'The shared graph does not contain valid JSON.', {
      cause: error,
    });
  }

  // Re-sanitize untrusted URL data, then re-apply the stricter share schema
  // so hand-crafted links cannot smuggle paths, mtimes or embeddings through.
  try {
    return createShareGraph(sanitizeGraphExport(parsed));
  } catch (error) {
    if (error instanceof ShareUrlError) {
      throw new ShareUrlError('malformed', 'The shared graph data is invalid.', { cause: error });
    }
    throw error;
  }
}

/** Build a copyable URL, deliberately dropping all query state/corpus ids. */
export async function createShareUrl(input: unknown, baseHref?: string): Promise<string> {
  const href =
    baseHref ??
    (typeof window !== 'undefined' ? window.location.href : undefined);
  if (!href) {
    throw new ShareUrlError('unsupported', 'A public app URL is required to create a link.');
  }

  let url: URL;
  try {
    url = new URL(href);
  } catch (error) {
    throw new ShareUrlError('malformed', 'The share-link base URL is invalid.', { cause: error });
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ShareUrlError('malformed', 'Share links require an HTTP or HTTPS app URL.');
  }

  const fragment = await encodeShareFragment(input);
  url.username = '';
  url.password = '';
  url.search = '';
  url.hash = fragment.slice(1);
  return url.toString();
}

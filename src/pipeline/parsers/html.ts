/**
 * WORKER-SAFE HTML → visible-text parser. No DOMParser (unavailable in
 * workers): script/style/head are stripped via regex, block-level tags
 * become newlines, remaining tags become spaces, common entities decoded.
 */

import type { LinkRef } from '../../model/types';
import { cleanFilename, decodeText, type ParserResult } from './txt';

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function fromCodePointSafe(code: number): string {
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex: string) => fromCodePointSafe(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec: string) => fromCodePointSafe(parseInt(dec, 10)))
    .replace(/&([a-zA-Z]+);/g, (m, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? m);
}

function stripTags(fragment: string): string {
  return decodeEntities(fragment.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

// tags whose boundaries imply a line break in the visible text
const BLOCK_TAGS =
  'p|div|br|li|ul|ol|h[1-6]|tr|table|thead|tbody|section|article|aside|nav|header|footer|blockquote|pre|hr|dt|dd|figcaption';
const BLOCK_TAG_RX = new RegExp(`</?(?:${BLOCK_TAGS})\\b[^>]*/?>`, 'gi');

function headerValue(headers: string, name: string): string {
  const unfolded = headers.replace(/\r?\n[ \t]+/g, ' ');
  const re = new RegExp(`^${name}\\s*:\\s*(.*)$`, 'im');
  return re.exec(unfolded)?.[1]?.trim() ?? '';
}

function splitHeaders(raw: string): { headers: string; body: string } | null {
  const match = /\r?\n\r?\n/.exec(raw);
  if (!match || match.index === undefined) return null;
  return { headers: raw.slice(0, match.index), body: raw.slice(match.index + match[0].length) };
}

function contentTypeOf(headers: string): string {
  return headerValue(headers, 'Content-Type').split(';')[0].trim().toLowerCase();
}

function boundaryOf(headers: string): string | null {
  const contentType = headerValue(headers, 'Content-Type');
  const quoted = /boundary\s*=\s*"([^"]+)"/i.exec(contentType);
  if (quoted) return quoted[1];
  const bare = /boundary\s*=\s*([^\s;]+)/i.exec(contentType);
  return bare ? bare[1] : null;
}

function decodeQuotedPrintable(input: string): string {
  const soft = input.replace(/=\r?\n/g, '');
  const bytes: number[] = [];
  for (let i = 0; i < soft.length; i += 1) {
    if (soft[i] === '=' && i + 2 < soft.length && /^[0-9A-Fa-f]{2}$/.test(soft.slice(i + 1, i + 3))) {
      bytes.push(parseInt(soft.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(soft.charCodeAt(i) & 0xff);
    }
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(bytes));
}

function decodeBase64Text(input: string): string {
  const cleaned = input.replace(/\s+/g, '');
  try {
    const bin = atob(cleaned);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  } catch {
    return input;
  }
}

function decodeTransferEncoding(body: string, encoding: string): string {
  const enc = encoding.toLowerCase();
  if (enc === 'base64') return decodeBase64Text(body);
  if (enc === 'quoted-printable') return decodeQuotedPrintable(body);
  return body;
}

function unwrapMhtml(raw: string): string {
  const preamble = splitHeaders(raw);
  if (!preamble) return raw;
  const boundary = boundaryOf(preamble.headers);
  const topType = contentTypeOf(preamble.headers);
  if (!boundary) {
    if (topType === 'text/html' || topType === 'application/xhtml+xml') {
      return decodeTransferEncoding(
        preamble.body,
        headerValue(preamble.headers, 'Content-Transfer-Encoding'),
      );
    }
    return raw;
  }

  const parts = raw.split(`--${boundary}`);
  let html: string | null = null;
  let textFallback: string | null = null;
  for (let i = 1; i < parts.length; i += 1) {
    let part = parts[i];
    if (part.startsWith('--')) break;
    part = part.replace(/^\r?\n/, '').replace(/\r?\n$/, '');
    const parsed = splitHeaders(part);
    if (!parsed) continue;
    const type = contentTypeOf(parsed.headers);
    const decoded = decodeTransferEncoding(
      parsed.body.replace(/\r?\n$/, ''),
      headerValue(parsed.headers, 'Content-Transfer-Encoding'),
    );
    if (type === 'text/html' || type === 'application/xhtml+xml') {
      html = decoded;
      break;
    }
    if (!textFallback && type.startsWith('text/')) textFallback = decoded;
  }
  return html ?? textFallback ?? raw;
}

function shouldUnwrapMhtml(raw: string, name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'mhtml' || ext === 'mht') return true;
  const head = raw.slice(0, 4096);
  return /MIME-Version\s*:/i.test(head) && /Content-Type\s*:\s*multipart\//i.test(head);
}

export function parseHtml(bytes: ArrayBuffer, name: string): ParserResult {
  let raw = decodeText(bytes);
  if (shouldUnwrapMhtml(raw, name)) raw = unwrapMhtml(raw);

  // <title> lives inside <head>, so capture it before stripping head
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title\s*>/i.exec(raw);

  let html = raw
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style\s*>/gi, ' ')
    .replace(/<noscript\b[\s\S]*?<\/noscript\s*>/gi, ' ')
    .replace(/<head\b[\s\S]*?<\/head\s*>/gi, ' ');

  // collect <a href> targets before tags are stripped — otherwise the URLs
  // are lost and the link is unrecoverable when viewing the document. The
  // href-only pass feeds reference edges and must match ANY <a href> (even a
  // malformed/unclosed one); a second pass that requires a closing </a> pairs
  // each URL with its anchor text for the reader's labelled link list.
  const linkTargets: string[] = [];
  for (const m of html.matchAll(/<a\b[^>]*\shref\s*=\s*("([^"]*)"|'([^']*)'|([^\s">]+))/gi)) {
    const url = decodeEntities((m[2] ?? m[3] ?? m[4] ?? '').trim());
    if (url && !url.startsWith('#')) linkTargets.push(url); // skip in-page anchors
  }
  const docLinks: LinkRef[] = [];
  const A_RE = /<a\b[^>]*\shref\s*=\s*("([^"]*)"|'([^']*)'|([^\s">]+))[^>]*>([\s\S]*?)<\/a\s*>/gi;
  for (const m of html.matchAll(A_RE)) {
    const url = decodeEntities((m[2] ?? m[3] ?? m[4] ?? '').trim());
    if (!url || url.startsWith('#')) continue;
    docLinks.push({ text: stripTags(m[5]), url });
  }

  // collect headings for structure/search; node titles come from document
  // metadata (<title>) or the filename, not visible body headings.
  const headings: string[] = [];
  for (const match of html.matchAll(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1\s*>/gi)) {
    const text = stripTags(match[2]);
    if (text) headings.push(text);
  }

  // block-level tag boundaries → newline, remaining tags → space
  html = html.replace(BLOCK_TAG_RX, '\n').replace(/<[^>]*>/g, ' ');

  let text = decodeEntities(html);
  // collapse whitespace but preserve line breaks
  text = text.replace(/[ \t\r\f\v]+/g, ' ');
  text = text
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const docTitle = titleMatch ? stripTags(titleMatch[1]) : '';

  return {
    title: docTitle || cleanFilename(name),
    text,
    headings,
    mdLinkTargets: linkTargets,
    docLinks,
    status: 'ok',
  };
}

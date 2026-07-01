/**
 * Worker-safe Markdown parser.
 *
 * Keep this dependency-light: several remark/micromark browser bundles resolve
 * a DOM-based entity decoder at module load time, which crashes inside Web
 * Workers (`document is not defined`) and leaves ingest stuck in parsing.
 */

import { cleanFilename, decodeText, type ParserResult } from './txt';

const ATX_HEADING_RE = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/;
const SETEXT_HEADING_RE = /^\s{0,3}(=+|-+)\s*$/;
const DEFINITION_RE = /^\s{0,3}\[([^\]]+)]:\s*(<[^>]+>|\S+)/;
const INLINE_LINK_RE = /!?\[[^\]]*]\(\s*(<[^>]+>|[^)\s]+)(?:\s+['"][^'"]*['"])?\s*\)/g;
const REFERENCE_LINK_RE = /!?\[[^\]]+]\[([^\]]*)]/g;
const COLLAPSE_MARKERS_RE = /[*_~`]+/g;

function cleanHeading(text: string): string {
  return text
    .replace(/\s+#+\s*$/, '')
    .replace(COLLAPSE_MARKERS_RE, '')
    .trim();
}

function stripUrlBrackets(url: string): string {
  const trimmed = url.trim();
  return trimmed.startsWith('<') && trimmed.endsWith('>') ? trimmed.slice(1, -1) : trimmed;
}

function collectLinks(raw: string, definitions: Map<string, string>): string[] {
  const targets: string[] = [];
  for (const match of raw.matchAll(INLINE_LINK_RE)) {
    targets.push(stripUrlBrackets(match[1]));
  }
  for (const match of raw.matchAll(REFERENCE_LINK_RE)) {
    const key = match[1].trim().toLowerCase();
    const url = definitions.get(key);
    if (url) targets.push(url);
  }
  return targets;
}

function textLine(line: string): string {
  if (DEFINITION_RE.test(line)) return '';
  return line
    .replace(/^\s{0,3}#{1,6}\s+/, '')
    .replace(/^\s{0,3}>\s?/, '')
    .replace(/^\s*([-+*]|\d+[.)])\s+/, '')
    .replace(/^\s{0,3}(```|~~~).*$/, '')
    .replace(/\|/g, ' ')
    .replace(/!\[([^\]]*)]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)]\[[^\]]*]/g, '$1')
    .replace(/\[([^\]]+)]/g, '$1')
    .replace(COLLAPSE_MARKERS_RE, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseMarkdown(bytes: ArrayBuffer, name: string): ParserResult {
  const raw = decodeText(bytes);
  const lines = raw.replace(/\r\n?/g, '\n').split('\n');
  const definitions = new Map<string, string>();

  for (const line of lines) {
    const match = DEFINITION_RE.exec(line);
    if (!match) continue;
    definitions.set(match[1].trim().toLowerCase(), stripUrlBrackets(match[2]));
  }

  let title = '';
  const headings: string[] = [];
  const textBlocks: string[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const atx = ATX_HEADING_RE.exec(line);
    if (atx) {
      const heading = cleanHeading(atx[2]);
      if (heading) {
        headings.push(heading);
        if (!title && atx[1].length === 1) title = heading;
      }
      textBlocks.push(heading);
      continue;
    }

    const next = lines[i + 1];
    if (next && SETEXT_HEADING_RE.test(next) && line.trim()) {
      const heading = cleanHeading(line);
      if (heading) {
        headings.push(heading);
        if (!title && next.trim().startsWith('=')) title = heading;
      }
      textBlocks.push(heading);
      i += 1;
      continue;
    }

    const text = textLine(line);
    if (text) textBlocks.push(text);
  }

  return {
    title: title || headings[0] || cleanFilename(name),
    text: textBlocks.join('\n'),
    headings,
    mdLinkTargets: [...definitions.values(), ...collectLinks(raw, definitions)],
    status: 'ok',
  };
}

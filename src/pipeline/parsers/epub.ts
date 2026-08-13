import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';
import { cleanFilename, type ParserResult } from './txt';

const MAX_ZIP_ENTRY_BYTES = 40 * 1024 * 1024;

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  preserveOrder: true,
  textNodeName: '#text',
  attributeNamePrefix: '@_',
  trimValues: false,
});

type XmlNode = Record<string, unknown>;

function parseXml(xml: string): XmlNode[] {
  const parsed = xmlParser.parse(xml) as unknown;
  return Array.isArray(parsed) ? (parsed as XmlNode[]) : [];
}

function nodeName(node: XmlNode): string {
  return Object.keys(node).find((k) => k !== ':@') ?? '';
}

function children(node: XmlNode): XmlNode[] {
  const name = nodeName(node);
  const value = node[name];
  return Array.isArray(value) ? (value as XmlNode[]) : [];
}

function attrs(node: XmlNode): Record<string, string> {
  const raw = node[':@'];
  return raw && typeof raw === 'object' ? (raw as Record<string, string>) : {};
}

function attr(node: XmlNode, localName: string): string | undefined {
  const all = attrs(node);
  return all[`@_${localName}`] ?? Object.entries(all).find(([k]) => k.endsWith(`:${localName}`))?.[1];
}

function textValue(node: XmlNode): string {
  const value = node['#text'];
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

function walk(nodes: XmlNode[], visit: (node: XmlNode, name: string) => void): void {
  for (const node of nodes) {
    const name = nodeName(node);
    if (!name) continue;
    visit(node, name);
    walk(children(node), visit);
  }
}

function elements(nodes: XmlNode[], names: ReadonlySet<string>): XmlNode[] {
  const out: XmlNode[] = [];
  walk(nodes, (node, name) => {
    if (names.has(name)) out.push(node);
  });
  return out;
}

function collectText(nodes: XmlNode[]): string {
  const parts: string[] = [];
  const visit = (node: XmlNode): void => {
    const name = nodeName(node);
    if (name === '#text') {
      parts.push(textValue(node));
    } else {
      for (const child of children(node)) visit(child);
    }
  };
  for (const node of nodes) visit(node);
  return parts.join('');
}

function declaredUncompressedSize(entry: JSZip.JSZipObject): number | undefined {
  const size = (entry as unknown as { _data?: { uncompressedSize?: unknown } })._data
    ?.uncompressedSize;
  return typeof size === 'number' && Number.isFinite(size) ? size : undefined;
}

async function zipText(zip: JSZip, path: string): Promise<string | null> {
  const entry = zip.file(path);
  if (!entry) return null;
  const declared = declaredUncompressedSize(entry);
  if (declared !== undefined && declared > MAX_ZIP_ENTRY_BYTES) {
    return null;
  }
  const text = await entry.async('text');
  return text.length > MAX_ZIP_ENTRY_BYTES ? null : text;
}

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

const BLOCK_TAGS =
  'p|div|br|li|ul|ol|h[1-6]|tr|table|thead|tbody|section|article|aside|nav|header|footer|blockquote|pre|hr|dt|dd|figcaption';
const BLOCK_TAG_RX = new RegExp(`</?(?:${BLOCK_TAGS})\\b[^>]*/?>`, 'gi');

function extractHtmlTextAndHeadings(rawHtml: string): { text: string; headings: string[] } {
  let html = rawHtml
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style\s*>/gi, ' ')
    .replace(/<noscript\b[\s\S]*?<\/noscript\s*>/gi, ' ')
    .replace(/<head\b[\s\S]*?<\/head\s*>/gi, ' ');

  const headings: string[] = [];
  for (const match of html.matchAll(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1\s*>/gi)) {
    const text = stripTags(match[2]);
    if (text) headings.push(text);
  }

  html = html.replace(BLOCK_TAG_RX, '\n').replace(/<[^>]*>/g, ' ');

  let text = decodeEntities(html);
  text = text.replace(/[ \t\r\f\v]+/g, ' ');
  text = text
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { text, headings };
}

function resolveZipPath(baseDir: string, target: string): string {
  if (/^[a-z]+:/i.test(target) || target.startsWith('/')) return target;
  const stack = baseDir.split('/').filter(Boolean);
  for (const part of target.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  return stack.join('/');
}

export async function parseEpub(bytes: ArrayBuffer, name: string): Promise<ParserResult> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch (err) {
    return {
      title: cleanFilename(name),
      text: '',
      headings: [],
      mdLinkTargets: [],
      docLinks: [],
      status: 'unreadable',
      warning: 'Invalid ZIP file',
    };
  }

  const containerXml = await zipText(zip, 'META-INF/container.xml');
  if (!containerXml) {
    return {
      title: cleanFilename(name),
      text: '',
      headings: [],
      mdLinkTargets: [],
      docLinks: [],
      status: 'unreadable',
      warning: 'Missing META-INF/container.xml',
    };
  }

  const containerTree = parseXml(containerXml);
  const rootfiles = elements(containerTree, new Set(['rootfile']));
  let opfPath = '';
  for (const rf of rootfiles) {
    const fullPath = attr(rf, 'full-path');
    if (fullPath) {
      opfPath = fullPath;
      break;
    }
  }

  if (!opfPath) {
    return {
      title: cleanFilename(name),
      text: '',
      headings: [],
      mdLinkTargets: [],
      docLinks: [],
      status: 'unreadable',
      warning: 'No OPF file found in container.xml',
    };
  }

  const opfXml = await zipText(zip, opfPath);
  if (!opfXml) {
    return {
      title: cleanFilename(name),
      text: '',
      headings: [],
      mdLinkTargets: [],
      docLinks: [],
      status: 'unreadable',
      warning: 'Missing OPF file',
    };
  }

  const opfTree = parseXml(opfXml);
  const baseDir = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/')) : '';

  // Extract title
  let title = cleanFilename(name);
  const dcTitles = elements(opfTree, new Set(['dc:title']));
  if (dcTitles.length > 0) {
    const t = collectText(children(dcTitles[0])).trim();
    if (t) title = t;
  }

  // Find manifest items
  const manifestItems = new Map<string, string>();
  const items = elements(opfTree, new Set(['item']));
  for (const item of items) {
    const id = attr(item, 'id');
    const href = attr(item, 'href');
    if (id && href) {
      manifestItems.set(id, href);
    }
  }

  // Find spine order
  const spineItemRefs = elements(opfTree, new Set(['itemref']));
  const chapterPaths: string[] = [];
  for (const itemref of spineItemRefs) {
    const idref = attr(itemref, 'idref');
    if (idref && manifestItems.has(idref)) {
      const href = manifestItems.get(idref)!;
      chapterPaths.push(resolveZipPath(baseDir, href));
    }
  }

  if (chapterPaths.length === 0) {
    return {
      title,
      text: '',
      headings: [],
      mdLinkTargets: [],
      docLinks: [],
      status: 'ok',
    };
  }

  const allHeadings: string[] = [];
  const textParts: string[] = [];

  for (const path of chapterPaths) {
    const htmlText = await zipText(zip, path);
    if (!htmlText) continue;
    const { text, headings } = extractHtmlTextAndHeadings(htmlText);
    if (text) {
      textParts.push(text);
    }
    allHeadings.push(...headings);
  }

  return {
    title,
    text: textParts.join('\n\n').trim(),
    headings: allHeadings,
    mdLinkTargets: [],
    docLinks: [],
    status: 'ok',
  };
}

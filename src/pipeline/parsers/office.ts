/**
 * Office Open XML parser (.docx/.pptx/.xlsx). These formats are ZIP
 * containers with XML parts; JSZip handles the package layer and
 * fast-xml-parser keeps the XML traversal worker-safe.
 */

import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';
import type { FileType, LinkRef, NodeStatus } from '../../model/types';
import { cleanFilename, type ParserResult } from './txt';

type XmlNode = Record<string, unknown>;

// Zip-bomb hardening: a crafted .docx/.pptx/.xlsx can declare a tiny
// compressed part that inflates to gigabytes, exhausting tab memory long
// before the caller sees any output. 40 MB is generous for any legitimate
// Office XML part (even a huge spreadsheet's sharedStrings.xml) while still
// bounding the worst case.
const MAX_ZIP_ENTRY_BYTES = 40 * 1024 * 1024;
// Slide count cap for pptx — mirrors the per-part cap's intent for decks
// with an implausible number of slides (each slide is its own zip entry, so
// the per-entry cap alone doesn't bound the total slide count).
const MAX_PPTX_SLIDES = 300;
// Same idea for xlsx worksheets — each sheet is a separate inflated XML
// part, so the per-entry cap alone doesn't bound total sheet count.
const MAX_XLSX_SHEETS = 200;

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  preserveOrder: true,
  textNodeName: '#text',
  attributeNamePrefix: '@_',
  trimValues: false,
});

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
    } else if (name === 'w:t' || name === 'a:t' || name === 't') {
      const value = children(node).map(textValue).join('');
      if (value) parts.push(value);
    } else if (name === 'w:tab') {
      parts.push('\t');
    } else if (name === 'w:br') {
      parts.push('\n');
    } else {
      for (const child of children(node)) visit(child);
    }
  };
  for (const node of nodes) visit(node);
  return parts.join('');
}

function normalizeLines(lines: string[]): string {
  return lines
    .map((line) => line.replace(/[ \t\r\f\v]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function numericSort(a: string, b: string): number {
  const na = Number(a.match(/(\d+)(?=\.[^.]+$)/)?.[1] ?? 0);
  const nb = Number(b.match(/(\d+)(?=\.[^.]+$)/)?.[1] ?? 0);
  return na - nb || a.localeCompare(b);
}

/**
 * JSZip records each entry's uncompressed size from the central directory
 * while parsing the archive layout — BEFORE `.async()` actually inflates
 * anything — so this is available for a cheap pre-check. `_data` isn't part
 * of JSZip's public d.ts (undocumented internal), so it's read defensively:
 * if a future JSZip version doesn't expose it, `declared` is just
 * `undefined` and this falls through to the post-decompress length check
 * in zipText below instead of throwing.
 */
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
    // Oversized part — treat like a missing one; callers already handle a
    // missing part by falling back to "unreadable"/empty text.
    return null;
  }
  const text = await entry.async('text');
  // Belt-and-suspenders: also reject on the actual decompressed length, in
  // case the declared-size pre-check above wasn't available (e.g. a JSZip
  // version without the internal field, or a zip that lies about size in
  // its central directory). Truncating mid-XML would produce silently
  // corrupt parse results; treat oversized parts as missing instead.
  return text.length > MAX_ZIP_ENTRY_BYTES ? null : text;
}

async function readCoreTitle(zip: JSZip): Promise<string> {
  const xml = await zipText(zip, 'docProps/core.xml');
  if (!xml) return '';
  const titles = elements(parseXml(xml), new Set(['dc:title']));
  return titles
    .map((title) => collectText(children(title)).replace(/\s+/g, ' ').trim())
    .find(Boolean) ?? '';
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

async function readRels(
  zip: JSZip,
  path: string,
  baseDir: string,
  resolveInternalTargets = true,
): Promise<Map<string, string>> {
  const xml = await zipText(zip, path);
  const rels = new Map<string, string>();
  if (!xml) return rels;
  for (const rel of elements(parseXml(xml), new Set(['Relationship']))) {
    const id = attr(rel, 'Id');
    const target = attr(rel, 'Target');
    if (!id || !target) continue;
    const mode = attr(rel, 'TargetMode');
    rels.set(
      id,
      mode === 'External' || !resolveInternalTargets ? target : resolveZipPath(baseDir, target),
    );
  }
  return rels;
}

function result(
  name: string,
  title: string,
  text: string,
  headings: string[],
  docLinks: LinkRef[],
  status: NodeStatus = 'ok',
  warning?: string,
): ParserResult {
  return {
    title: title || headings[0] || cleanFilename(name),
    text,
    headings,
    mdLinkTargets: docLinks.map((l) => l.url),
    docLinks,
    status,
    warning,
  };
}

function emptyResult(name: string, warning: string): ParserResult {
  return result(name, cleanFilename(name), '', [], [], 'unreadable', warning);
}

function docxParagraphText(paragraph: XmlNode): string {
  return collectText(children(paragraph));
}

function docxParagraphStyle(paragraph: XmlNode): string {
  const styles = elements(children(paragraph), new Set(['w:pStyle']));
  return styles.map((s) => attr(s, 'val') ?? '').find(Boolean) ?? '';
}

async function parseDocx(zip: JSZip, name: string): Promise<ParserResult> {
  const documentXml = await zipText(zip, 'word/document.xml');
  if (!documentXml) return emptyResult(name, 'No Word document body found');
  const coreTitle = await readCoreTitle(zip);
  const rels = await readRels(zip, 'word/_rels/document.xml.rels', 'word', false);
  const tree = parseXml(documentXml);
  const headings: string[] = [];
  const lines: string[] = [];
  const docLinks: LinkRef[] = [];

  for (const paragraph of elements(tree, new Set(['w:p']))) {
    const text = docxParagraphText(paragraph).replace(/\s+/g, ' ').trim();
    if (!text) continue;
    lines.push(text);
    const style = docxParagraphStyle(paragraph).toLowerCase();
    if (/^heading[1-6]$/.test(style) || /^title$/.test(style)) headings.push(text);

    for (const link of elements(children(paragraph), new Set(['w:hyperlink']))) {
      const id = attr(link, 'id');
      const url = id ? rels.get(id) : undefined;
      const label = collectText(children(link)).replace(/\s+/g, ' ').trim();
      if (url && label) docLinks.push({ text: label, url });
    }
  }

  const text = normalizeLines(lines);
  return text
    ? result(name, coreTitle || cleanFilename(name), text, headings, docLinks)
    : emptyResult(name, 'No readable Word text found');
}

function pptxRunLinks(paragraph: XmlNode, rels: Map<string, string>): LinkRef[] {
  const out: LinkRef[] = [];
  for (const run of elements(children(paragraph), new Set(['a:r']))) {
    const label = collectText(children(run)).replace(/\s+/g, ' ').trim();
    if (!label) continue;
    const hlinks = elements(children(run), new Set(['a:hlinkClick', 'a:hlinkMouseOver']));
    for (const hlink of hlinks) {
      const id = attr(hlink, 'id');
      const url = id ? rels.get(id) : undefined;
      if (url) out.push({ text: label, url });
    }
  }
  return out;
}

async function parsePptx(zip: JSZip, name: string): Promise<ParserResult> {
  const coreTitle = await readCoreTitle(zip);
  const allSlidePaths = Object.keys(zip.files)
    .filter((p) => /^ppt\/slides\/slide\d+\.xml$/i.test(p))
    .sort(numericSort);
  const slidePaths = allSlidePaths.slice(0, MAX_PPTX_SLIDES);
  const truncated = allSlidePaths.length > MAX_PPTX_SLIDES;
  if (slidePaths.length === 0) return emptyResult(name, 'No PowerPoint slides found');

  const headings: string[] = [];
  const lines: string[] = [];
  const docLinks: LinkRef[] = [];

  for (let i = 0; i < slidePaths.length; i += 1) {
    const path = slidePaths[i];
    const xml = await zipText(zip, path);
    if (!xml) continue;
    const file = path.split('/').pop() ?? '';
    const rels = await readRels(zip, `ppt/slides/_rels/${file}.rels`, 'ppt/slides', false);
    const paragraphs = elements(parseXml(xml), new Set(['a:p']));
    const slideLines = paragraphs
      .map((p) => collectText(children(p)).replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    if (slideLines.length === 0) continue;
    headings.push(slideLines[0]);
    lines.push(`Slide ${i + 1}: ${slideLines[0]}`, ...slideLines.slice(1));
    for (const paragraph of paragraphs) docLinks.push(...pptxRunLinks(paragraph, rels));
  }

  const text = normalizeLines(lines);
  if (!text) return emptyResult(name, 'No readable PowerPoint text found');
  return truncated
    ? result(
        name,
        coreTitle || cleanFilename(name),
        text,
        headings,
        docLinks,
        'partial',
        `Only the first ${MAX_PPTX_SLIDES} slides were indexed`,
      )
    : result(name, coreTitle || cleanFilename(name), text, headings, docLinks);
}

async function sharedStrings(zip: JSZip): Promise<string[]> {
  const xml = await zipText(zip, 'xl/sharedStrings.xml');
  if (!xml) return [];
  return elements(parseXml(xml), new Set(['si'])).map((si) =>
    collectText(children(si)).replace(/\s+/g, ' ').trim(),
  );
}

async function workbookSheets(zip: JSZip): Promise<{ name: string; path: string }[]> {
  const workbookXml = await zipText(zip, 'xl/workbook.xml');
  if (!workbookXml) return [];
  const rels = await readRels(zip, 'xl/_rels/workbook.xml.rels', 'xl');
  return elements(parseXml(workbookXml), new Set(['sheet']))
    .map((sheet) => {
      const name = attr(sheet, 'name') ?? 'Sheet';
      const id = attr(sheet, 'id');
      const path = id ? rels.get(id) : undefined;
      return path ? { name, path } : null;
    })
    .filter((s): s is { name: string; path: string } => s !== null);
}

function cellValue(cell: XmlNode, strings: string[]): string {
  const type = attr(cell, 't');
  if (type === 'inlineStr') {
    return elements(children(cell), new Set(['is']))
      .map((n) => collectText(children(n)))
      .join('')
      .trim();
  }
  const v = elements(children(cell), new Set(['v'])).map((n) => collectText(children(n))).join('');
  if (!v) return '';
  if (type === 's') return strings[Number(v)] ?? '';
  if (type === 'b') return v === '1' ? 'TRUE' : 'FALSE';
  return v;
}

async function parseXlsx(zip: JSZip, name: string): Promise<ParserResult> {
  const coreTitle = await readCoreTitle(zip);
  const allSheets = await workbookSheets(zip);
  if (allSheets.length === 0) return emptyResult(name, 'No Excel worksheets found');
  const sheets = allSheets.slice(0, MAX_XLSX_SHEETS);
  const truncated = allSheets.length > MAX_XLSX_SHEETS;
  const strings = await sharedStrings(zip);
  const headings = sheets.map((s) => s.name);
  const lines: string[] = [];

  for (const sheet of sheets) {
    const xml = await zipText(zip, sheet.path);
    if (!xml) continue;
    lines.push(`Sheet: ${sheet.name}`);
    for (const row of elements(parseXml(xml), new Set(['row']))) {
      const values = elements(children(row), new Set(['c']))
        .map((cell) => cellValue(cell, strings))
        .map((v) => v.replace(/\s+/g, ' ').trim())
        .filter(Boolean);
      if (values.length > 0) lines.push(values.join(' | '));
    }
  }

  const text = normalizeLines(lines);
  if (!text) return emptyResult(name, 'No readable Excel cell text found');
  return truncated
    ? result(
        name,
        coreTitle || cleanFilename(name),
        text,
        headings,
        [],
        'partial',
        `Only the first ${MAX_XLSX_SHEETS} worksheets were indexed`,
      )
    : result(name, coreTitle || cleanFilename(name), text, headings, []);
}

export async function parseOffice(
  bytes: ArrayBuffer,
  name: string,
  fileType: Extract<FileType, 'docx' | 'pptx' | 'xlsx'>,
): Promise<ParserResult> {
  const zip = await JSZip.loadAsync(bytes);
  switch (fileType) {
    case 'docx':
      return parseDocx(zip, name);
    case 'pptx':
      return parsePptx(zip, name);
    case 'xlsx':
      return parseXlsx(zip, name);
  }
  throw new Error(`Unsupported Office type: ${String(fileType)}`);
}

/**
 * Maps a filename to its pipeline FileType by extension (spec §4.2).
 * Returns null for unsupported types — the caller sends those to the
 * "ignored" tray instead of silently dropping them.
 */

import { isCodeBasename, isCodeExtension } from '../pipeline/codeLanguage';
import type { FileType } from '../model/types';
import { posixBasename } from '../util/posixPath';
import { repoArtifactReason } from './repoArtifacts';
import { looksLikeText } from './textSniffer';

const EXT_MAP: Record<string, FileType> = {
  txt: 'txt',
  log: 'txt',
  md: 'md',
  mdx: 'md',
  rmd: 'md',
  qmd: 'md',
  pdf: 'pdf',
  html: 'html',
  htm: 'html',
  json: 'json',
  ipynb: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  csv: 'csv',
  docx: 'docx',
  docm: 'docx',
  pptx: 'pptx',
  pptm: 'pptx',
  xlsx: 'xlsx',
  xlsm: 'xlsx',
  epub: 'other',
  rtf: 'other',
  odt: 'other',
  ods: 'other',
  odp: 'other',
  odg: 'other',
  markdown: 'md',
  mdown: 'md',
  mkd: 'md',
  mdtext: 'md',
  mdtxt: 'md',
  workbook: 'md',
  tsv: 'csv',
  psv: 'csv',
  tab: 'csv',
  jsonl: 'json',
  ndjson: 'json',
  geojson: 'json',
  jsonld: 'json',
  xml: 'code',
  svg: 'html',
  xhtml: 'html',
  mhtml: 'html',
  mht: 'html',
};

const KNOWN_BINARY_EXTS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'mp3', 'mp4', 'mov', 'avi', 
  'zip', 'tar', 'gz', 'exe', 'dll', 'so', 'dylib', 'wasm', 'o', 
  'a', 'lib', 'bin', 'dat', 'db', 'sqlite'
]);

function extensionOf(name: string): string {
  const base = posixBasename(name);
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return '';
  return base.slice(dot + 1).toLowerCase();
}

export function routeFile(name: string): FileType | null {
  const base = posixBasename(name);
  if (repoArtifactReason(base)) return null;
  // Special source basenames (Dockerfile, CMakeLists.txt, go.mod) win over
  // a trailing extension so a Makefile isn't dropped and CMakeLists.txt is
  // code rather than plain text.
  if (isCodeBasename(base)) return 'code';
  const ext = extensionOf(base);
  if (!ext) return null;
  return EXT_MAP[ext] ?? (isCodeExtension(ext) ? 'code' : null);
}

/**
 * Name-only gate used before bytes are available. Known types and
 * sniffable unknowns (LICENSE, *.rules) are kept; lockfiles and known
 * binaries are not.
 */
export function isIngestCandidate(name: string): boolean {
  if (routeFile(name)) return true;
  const base = posixBasename(name);
  if (repoArtifactReason(base)) return false;
  const ext = extensionOf(base);
  if (ext && KNOWN_BINARY_EXTS.has(ext)) return false;
  return true;
}

export function routeFileWithSniff(name: string, bytes: ArrayBuffer): FileType | null {
  const type = routeFile(name);
  if (type) return type;

  const ext = extensionOf(name);
  if (ext && KNOWN_BINARY_EXTS.has(ext)) {
    return null;
  }

  if (looksLikeText(bytes)) {
    return 'txt';
  }

  return null;
}

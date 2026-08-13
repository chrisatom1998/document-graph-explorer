/**
 * Maps a filename to its pipeline FileType by extension (spec §4.2).
 * Returns null for unsupported types — the caller sends those to the
 * "ignored" tray instead of silently dropping them.
 */

import { isCodeBasename, isCodeExtension } from '../pipeline/codeLanguage';
import type { FileType } from '../model/types';
import { posixBasename } from '../util/posixPath';
import { repoArtifactReason } from './repoArtifacts';

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
};

export function routeFile(name: string): FileType | null {
  const base = posixBasename(name);
  if (repoArtifactReason(base)) return null;
  // Special source basenames (Dockerfile, CMakeLists.txt, go.mod) win over
  // a trailing extension so a Makefile isn't dropped and CMakeLists.txt is
  // code rather than plain text.
  if (isCodeBasename(base)) return 'code';
  const dot = base.lastIndexOf('.');
  // no extension, or a dotfile like ".gitignore", or a trailing dot
  if (dot <= 0 || dot === base.length - 1) return null;
  const ext = base.slice(dot + 1).toLowerCase();
  return EXT_MAP[ext] ?? (isCodeExtension(ext) ? 'code' : null);
}

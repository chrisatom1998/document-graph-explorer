/**
 * Maps a filename to its pipeline FileType by extension (spec §4.2).
 * Returns null for unsupported types — the caller sends those to the
 * "ignored" tray instead of silently dropping them.
 */

import type { FileType } from '../model/types';

const EXT_MAP: Record<string, FileType> = {
  txt: 'txt',
  log: 'txt',
  md: 'md',
  mdx: 'md',
  pdf: 'pdf',
  html: 'html',
  htm: 'html',
  // code/config stretch types — treated as plain text with a per-extension type badge (spec §4.2)
  json: 'json',
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
  const dot = name.lastIndexOf('.');
  // no extension, or a dotfile like ".gitignore", or a trailing dot
  if (dot <= 0 || dot === name.length - 1) return null;
  const ext = name.slice(dot + 1).toLowerCase();
  return EXT_MAP[ext] ?? null;
}

/**
 * Maps a filename to its pipeline FileType by extension (spec §4.2).
 * Returns null for unsupported types — the caller sends those to the
 * "ignored" tray instead of silently dropping them.
 */

import type { FileType } from '../model/types';
import { posixBasename } from '../util/posixPath';
import { repoArtifactReason } from './repoArtifacts';

const EXT_MAP: Record<string, FileType> = {
  txt: 'txt',
  log: 'txt',
  md: 'md',
  mdx: 'md',
  pdf: 'pdf',
  html: 'html',
  htm: 'html',
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
  // Source code — parsed for imports/symbols, rendered as monospaced text.
  ts: 'code',
  tsx: 'code',
  mts: 'code',
  cts: 'code',
  js: 'code',
  jsx: 'code',
  mjs: 'code',
  cjs: 'code',
  py: 'code',
  pyi: 'code',
  go: 'code',
  rs: 'code',
  java: 'code',
  kt: 'code',
  kts: 'code',
  c: 'code',
  h: 'code',
  cc: 'code',
  cpp: 'code',
  cxx: 'code',
  hh: 'code',
  hpp: 'code',
  hxx: 'code',
  cs: 'code',
  swift: 'code',
  rb: 'code',
  php: 'code',
  scala: 'code',
  sh: 'code',
  bash: 'code',
  zsh: 'code',
  sql: 'code',
  lua: 'code',
  r: 'code',
  dart: 'code',
  vue: 'code',
  svelte: 'code',
  css: 'code',
  scss: 'code',
  less: 'code',
  xml: 'code',
  toml: 'code',
  graphql: 'code',
  gql: 'code',
  proto: 'code',
  tf: 'code',
  zig: 'code',
  nim: 'code',
};

/** Extensionless build/tool files that still deserve a node. */
const SPECIAL_BASENAMES: Record<string, FileType> = {
  dockerfile: 'code',
  containerfile: 'code',
  makefile: 'code',
  gnumakefile: 'code',
  rakefile: 'code',
  gemfile: 'code',
  justfile: 'code',
  procfile: 'code',
  vagrantfile: 'code',
  brewfile: 'code',
};

export function routeFile(name: string): FileType | null {
  const base = posixBasename(name);
  if (repoArtifactReason(base)) return null;
  const special = SPECIAL_BASENAMES[base.toLowerCase()];
  if (special) return special;
  const dot = base.lastIndexOf('.');
  // no extension, or a dotfile like ".gitignore", or a trailing dot
  if (dot <= 0 || dot === base.length - 1) return null;
  const ext = base.slice(dot + 1).toLowerCase();
  return EXT_MAP[ext] ?? null;
}

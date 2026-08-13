/**
 * Filename → programming-language identity for source documents.
 *
 * Ingest still stores `fileType: 'code'` (filters, USD export, cache schema
 * stay stable). The UI uses this map so a selected Python file reads as
 * "python" rather than the generic "code" bucket, and so newly routed
 * extensions share one list with the parser's language families.
 */

import type { DocNode, FileType } from '../model/types';
import { posixBasename } from '../util/posixPath';

export type CodeFamily =
  | 'js'
  | 'python'
  | 'go'
  | 'rust'
  | 'c'
  | 'java'
  | 'ruby'
  | 'php'
  | 'css'
  | 'csharp'
  | 'shell'
  | 'lua'
  | 'dart'
  | 'haskell'
  | 'other';

export interface CodeLanguage {
  /** Stable id (`typescript`, `python`). */
  id: string;
  /** Reader / viewer label (`TypeScript`, `Python`). */
  label: string;
  /** Chip and selected-name suffix (`ts`, `py`, `js`). */
  short: string;
  family: CodeFamily;
  mime?: string;
}

interface LangDef extends CodeLanguage {
  exts?: string[];
  basenames?: string[];
}

const LANGUAGES: LangDef[] = [
  { id: 'typescript', label: 'TypeScript', short: 'ts', family: 'js', mime: 'text/plain', exts: ['ts', 'mts', 'cts'] },
  { id: 'tsx', label: 'TSX', short: 'tsx', family: 'js', mime: 'text/plain', exts: ['tsx'] },
  { id: 'javascript', label: 'JavaScript', short: 'js', family: 'js', mime: 'text/javascript', exts: ['js', 'mjs', 'cjs'] },
  { id: 'jsx', label: 'JSX', short: 'jsx', family: 'js', mime: 'text/javascript', exts: ['jsx'] },
  { id: 'vue', label: 'Vue', short: 'vue', family: 'js', mime: 'text/plain', exts: ['vue'] },
  { id: 'svelte', label: 'Svelte', short: 'svelte', family: 'js', mime: 'text/plain', exts: ['svelte'] },
  { id: 'astro', label: 'Astro', short: 'astro', family: 'js', mime: 'text/plain', exts: ['astro'] },
  {
    id: 'python',
    label: 'Python',
    short: 'py',
    family: 'python',
    mime: 'text/x-python',
    exts: ['py', 'pyi', 'pyw', 'pyx', 'pxd', 'pxi'],
    basenames: ['snakefile', 'pipfile'],
  },
  { id: 'go', label: 'Go', short: 'go', family: 'go', mime: 'text/x-go', exts: ['go'], basenames: ['go.mod', 'go.work'] },
  { id: 'rust', label: 'Rust', short: 'rs', family: 'rust', mime: 'text/x-rust', exts: ['rs'] },
  {
    id: 'c',
    label: 'C',
    short: 'c',
    family: 'c',
    mime: 'text/x-c',
    exts: ['c', 'h'],
  },
  {
    id: 'cpp',
    label: 'C++',
    short: 'cpp',
    family: 'c',
    mime: 'text/x-c++',
    exts: ['cc', 'cpp', 'cxx', 'hh', 'hpp', 'hxx', 'ipp', 'tpp'],
  },
  { id: 'objc', label: 'Obj-C / MATLAB', short: 'm', family: 'c', mime: 'text/x-objectivec', exts: ['m', 'mm'] },
  { id: 'csharp', label: 'C#', short: 'cs', family: 'csharp', mime: 'text/plain', exts: ['cs'] },
  { id: 'fsharp', label: 'F#', short: 'fs', family: 'other', mime: 'text/plain', exts: ['fs', 'fsi', 'fsx'] },
  { id: 'java', label: 'Java', short: 'java', family: 'java', mime: 'text/x-java-source', exts: ['java'] },
  { id: 'kotlin', label: 'Kotlin', short: 'kt', family: 'java', mime: 'text/plain', exts: ['kt', 'kts'] },
  { id: 'scala', label: 'Scala', short: 'scala', family: 'java', mime: 'text/plain', exts: ['scala', 'sc'] },
  { id: 'groovy', label: 'Groovy', short: 'groovy', family: 'java', mime: 'text/plain', exts: ['groovy', 'gradle'], basenames: ['jenkinsfile'] },
  { id: 'swift', label: 'Swift', short: 'swift', family: 'other', mime: 'text/plain', exts: ['swift'] },
  {
    id: 'ruby',
    label: 'Ruby',
    short: 'rb',
    family: 'ruby',
    mime: 'text/x-ruby',
    exts: ['rb', 'rake', 'gemspec', 'podspec'],
    basenames: ['rakefile', 'gemfile', 'vagrantfile', 'brewfile', 'podfile', 'fastfile', 'guardfile', 'capfile', 'thorfile', 'berksfile', 'dangerfile'],
  },
  { id: 'php', label: 'PHP', short: 'php', family: 'php', mime: 'text/x-php', exts: ['php', 'phtml'] },
  {
    id: 'shell',
    label: 'Shell',
    short: 'sh',
    family: 'shell',
    mime: 'text/x-shellscript',
    exts: ['sh', 'bash', 'zsh', 'ksh', 'fish'],
  },
  { id: 'powershell', label: 'PowerShell', short: 'ps1', family: 'shell', mime: 'text/plain', exts: ['ps1', 'psm1', 'psd1'] },
  { id: 'batch', label: 'Batch', short: 'bat', family: 'other', mime: 'text/plain', exts: ['bat', 'cmd'] },
  { id: 'sql', label: 'SQL', short: 'sql', family: 'other', mime: 'text/plain', exts: ['sql', 'pgsql', 'psql', 'mysql'] },
  { id: 'lua', label: 'Lua', short: 'lua', family: 'lua', mime: 'text/plain', exts: ['lua'] },
  { id: 'r', label: 'R', short: 'r', family: 'other', mime: 'text/plain', exts: ['r'] },
  { id: 'dart', label: 'Dart', short: 'dart', family: 'dart', mime: 'text/plain', exts: ['dart'] },
  { id: 'css', label: 'CSS', short: 'css', family: 'css', mime: 'text/css', exts: ['css'] },
  { id: 'scss', label: 'SCSS', short: 'scss', family: 'css', mime: 'text/x-scss', exts: ['scss'] },
  { id: 'less', label: 'Less', short: 'less', family: 'css', mime: 'text/plain', exts: ['less'] },
  { id: 'sass', label: 'Sass', short: 'sass', family: 'css', mime: 'text/plain', exts: ['sass'] },
  { id: 'stylus', label: 'Stylus', short: 'styl', family: 'css', mime: 'text/plain', exts: ['styl'] },
  { id: 'xml', label: 'XML', short: 'xml', family: 'other', mime: 'application/xml', exts: ['xml', 'xsl', 'xsd', 'plist'] },
  { id: 'toml', label: 'TOML', short: 'toml', family: 'other', mime: 'application/toml', exts: ['toml'] },
  { id: 'ini', label: 'INI', short: 'ini', family: 'other', mime: 'text/plain', exts: ['ini', 'cfg', 'conf', 'properties'] },
  { id: 'jsonc', label: 'JSONC', short: 'jsonc', family: 'other', mime: 'text/plain', exts: ['jsonc', 'json5'] },
  { id: 'graphql', label: 'GraphQL', short: 'graphql', family: 'other', mime: 'text/plain', exts: ['graphql', 'gql'] },
  { id: 'protobuf', label: 'Protobuf', short: 'proto', family: 'other', mime: 'text/plain', exts: ['proto'] },
  { id: 'terraform', label: 'Terraform', short: 'tf', family: 'other', mime: 'text/plain', exts: ['tf', 'tfvars', 'hcl'] },
  { id: 'zig', label: 'Zig', short: 'zig', family: 'other', mime: 'text/plain', exts: ['zig'] },
  { id: 'nim', label: 'Nim', short: 'nim', family: 'other', mime: 'text/plain', exts: ['nim', 'nims'] },
  { id: 'elixir', label: 'Elixir', short: 'ex', family: 'other', mime: 'text/plain', exts: ['ex', 'exs'] },
  { id: 'erlang', label: 'Erlang', short: 'erl', family: 'other', mime: 'text/plain', exts: ['erl', 'hrl'] },
  { id: 'haskell', label: 'Haskell', short: 'hs', family: 'haskell', mime: 'text/plain', exts: ['hs', 'lhs'] },
  { id: 'ocaml', label: 'OCaml', short: 'ml', family: 'other', mime: 'text/plain', exts: ['ml', 'mli'] },
  { id: 'clojure', label: 'Clojure', short: 'clj', family: 'other', mime: 'text/plain', exts: ['clj', 'cljs', 'cljc', 'edn'] },
  { id: 'lisp', label: 'Lisp', short: 'lisp', family: 'other', mime: 'text/plain', exts: ['lisp', 'cl', 'el', 'scm', 'rkt'] },
  { id: 'julia', label: 'Julia', short: 'jl', family: 'other', mime: 'text/plain', exts: ['jl'] },
  { id: 'perl', label: 'Perl', short: 'pl', family: 'other', mime: 'text/plain', exts: ['pl', 'pm'] },
  { id: 'elm', label: 'Elm', short: 'elm', family: 'other', mime: 'text/plain', exts: ['elm'] },
  { id: 'crystal', label: 'Crystal', short: 'cr', family: 'other', mime: 'text/plain', exts: ['cr'] },
  { id: 'gleam', label: 'Gleam', short: 'gleam', family: 'other', mime: 'text/plain', exts: ['gleam'] },
  { id: 'solidity', label: 'Solidity', short: 'sol', family: 'other', mime: 'text/plain', exts: ['sol'] },
  { id: 'nix', label: 'Nix', short: 'nix', family: 'other', mime: 'text/plain', exts: ['nix'] },
  { id: 'cmake', label: 'CMake', short: 'cmake', family: 'other', mime: 'text/plain', exts: ['cmake'], basenames: ['cmakelists.txt'] },
  { id: 'make', label: 'Makefile', short: 'make', family: 'other', mime: 'text/plain', exts: ['mk'], basenames: ['makefile', 'gnumakefile'] },
  { id: 'docker', label: 'Docker', short: 'docker', family: 'other', mime: 'text/plain', basenames: ['dockerfile', 'containerfile'] },
  { id: 'just', label: 'Just', short: 'just', family: 'other', mime: 'text/plain', basenames: ['justfile'] },
  { id: 'procfile', label: 'Procfile', short: 'procfile', family: 'other', mime: 'text/plain', basenames: ['procfile'] },
  { id: 'starlark', label: 'Starlark', short: 'bzl', family: 'other', mime: 'text/plain', exts: ['bzl', 'star', 'bazel'], basenames: ['build', 'workspace', 'build.bazel', 'workspace.bazel', 'module.bazel'] },
  { id: 'assembly', label: 'Assembly', short: 'asm', family: 'other', mime: 'text/plain', exts: ['asm', 's'] },
  { id: 'fortran', label: 'Fortran', short: 'f90', family: 'other', mime: 'text/plain', exts: ['f', 'for', 'f90', 'f95', 'f03', 'f08'] },
  { id: 'pascal', label: 'Pascal', short: 'pas', family: 'other', mime: 'text/plain', exts: ['pas', 'pp'] },
  { id: 'ada', label: 'Ada', short: 'ada', family: 'other', mime: 'text/plain', exts: ['ada', 'adb', 'ads'] },
  { id: 'd', label: 'D', short: 'd', family: 'other', mime: 'text/plain', exts: ['d'] },
  { id: 'odin', label: 'Odin', short: 'odin', family: 'other', mime: 'text/plain', exts: ['odin'] },
  { id: 'vlang', label: 'V / Verilog', short: 'v', family: 'other', mime: 'text/plain', exts: ['v'] },
  { id: 'verilog', label: 'Verilog', short: 'sv', family: 'other', mime: 'text/plain', exts: ['sv', 'svh', 'vhd', 'vhdl'] },
  { id: 'cuda', label: 'CUDA', short: 'cu', family: 'c', mime: 'text/plain', exts: ['cu', 'cuh'] },
  { id: 'wasm', label: 'WebAssembly', short: 'wat', family: 'other', mime: 'text/plain', exts: ['wat'] },
  { id: 'prisma', label: 'Prisma', short: 'prisma', family: 'other', mime: 'text/plain', exts: ['prisma'] },
  { id: 'thrift', label: 'Thrift', short: 'thrift', family: 'other', mime: 'text/plain', exts: ['thrift'] },
  { id: 'cue', label: 'Cue', short: 'cue', family: 'other', mime: 'text/plain', exts: ['cue'] },
  { id: 'coffee', label: 'CoffeeScript', short: 'coffee', family: 'js', mime: 'text/plain', exts: ['coffee'] },
  { id: 'rescript', label: 'ReScript', short: 'res', family: 'other', mime: 'text/plain', exts: ['res', 'resi', 're', 'rei'] },
  { id: 'template', label: 'Template', short: 'tmpl', family: 'other', mime: 'text/plain', exts: ['pug', 'jade', 'ejs', 'hbs', 'mustache', 'njk', 'twig', 'erb', 'haml', 'slim', 'jinja', 'j2'] },
  { id: 'latex', label: 'LaTeX', short: 'tex', family: 'other', mime: 'text/x-tex', exts: ['tex', 'sty', 'cls', 'bib'] },
  { id: 'rst', label: 'reStructuredText', short: 'rst', family: 'other', mime: 'text/plain', exts: ['rst'] },
  { id: 'asciidoc', label: 'AsciiDoc', short: 'adoc', family: 'other', mime: 'text/plain', exts: ['adoc', 'asciidoc'] },
  { id: 'org', label: 'Org', short: 'org', family: 'other', mime: 'text/plain', exts: ['org'] },
  { id: 'awk', label: 'AWK', short: 'awk', family: 'shell', mime: 'text/plain', exts: ['awk'] },
  { id: 'tcl', label: 'Tcl', short: 'tcl', family: 'other', mime: 'text/plain', exts: ['tcl'] },
  { id: 'ahk', label: 'AutoHotkey', short: 'ahk', family: 'other', mime: 'text/plain', exts: ['ahk'] },
  { id: 'applescript', label: 'AppleScript', short: 'applescript', family: 'other', mime: 'text/plain', exts: ['applescript'] },
  { id: 'vb', label: 'Visual Basic', short: 'vb', family: 'other', mime: 'text/plain', exts: ['vb', 'vbs', 'bas'] },
  { id: 'sbt', label: 'sbt', short: 'sbt', family: 'java', mime: 'text/plain', exts: ['sbt'] },
  { id: 'earthfile', label: 'Earthfile', short: 'earthfile', family: 'other', mime: 'text/plain', basenames: ['earthfile'] },
  { id: 'caddyfile', label: 'Caddyfile', short: 'caddy', family: 'other', mime: 'text/plain', basenames: ['caddyfile'] },
  { id: 'meson', label: 'Meson', short: 'meson', family: 'other', mime: 'text/plain', basenames: ['meson.build'] },
  { id: 'mojo', label: 'Mojo', short: 'mojo', family: 'python', mime: 'text/plain', exts: ['mojo'] },
  { id: 'purescript', label: 'PureScript', short: 'purs', family: 'haskell', mime: 'text/plain', exts: ['purs'] },
  { id: 'sml', label: 'Standard ML', short: 'sml', family: 'other', mime: 'text/plain', exts: ['sml', 'sig'] },
  { id: 'fennel', label: 'Fennel', short: 'fnl', family: 'other', mime: 'text/plain', exts: ['fnl'] },
  { id: 'hy', label: 'Hy', short: 'hy', family: 'other', mime: 'text/plain', exts: ['hy'] },
  { id: 'lean', label: 'Lean', short: 'lean', family: 'other', mime: 'text/plain', exts: ['lean'] },
  { id: 'agda', label: 'Agda', short: 'agda', family: 'other', mime: 'text/plain', exts: ['agda'] },
  { id: 'idris', label: 'Idris', short: 'idr', family: 'other', mime: 'text/plain', exts: ['idr'] },
  { id: 'glsl', label: 'GLSL', short: 'glsl', family: 'other', mime: 'text/plain', exts: ['glsl', 'vert', 'frag', 'geom', 'comp'] },
  { id: 'hlsl', label: 'HLSL', short: 'hlsl', family: 'other', mime: 'text/plain', exts: ['hlsl', 'fx'] },
  { id: 'wgsl', label: 'WGSL', short: 'wgsl', family: 'other', mime: 'text/plain', exts: ['wgsl'] },
  { id: 'metal', label: 'Metal', short: 'metal', family: 'c', mime: 'text/plain', exts: ['metal'] },
  { id: 'opencl', label: 'OpenCL', short: 'ocl', family: 'c', mime: 'text/plain', exts: ['ocl', 'opencl'] },
  { id: 'vyper', label: 'Vyper', short: 'vy', family: 'other', mime: 'text/plain', exts: ['vy'] },
  { id: 'move', label: 'Move', short: 'move', family: 'other', mime: 'text/plain', exts: ['move'] },
  { id: 'cairo', label: 'Cairo', short: 'cairo', family: 'other', mime: 'text/plain', exts: ['cairo'] },
  { id: 'bicep', label: 'Bicep', short: 'bicep', family: 'other', mime: 'text/plain', exts: ['bicep'] },
  { id: 'flatbuffers', label: 'FlatBuffers', short: 'fbs', family: 'other', mime: 'text/plain', exts: ['fbs'] },
  { id: 'capnp', label: 'Cap\'n Proto', short: 'capnp', family: 'other', mime: 'text/plain', exts: ['capnp'] },
  { id: 'avro', label: 'Avro Schema', short: 'avsc', family: 'other', mime: 'text/plain', exts: ['avsc'] },
  { id: 'raml', label: 'RAML', short: 'raml', family: 'other', mime: 'text/plain', exts: ['raml'] },
  { id: 'sas', label: 'SAS', short: 'sas', family: 'other', mime: 'text/plain', exts: ['sas'] },
  { id: 'stata', label: 'Stata', short: 'do', family: 'other', mime: 'text/plain', exts: ['do', 'ado'] },
  { id: 'spss', label: 'SPSS', short: 'sps', family: 'other', mime: 'text/plain', exts: ['sps'] },
  { id: 'ninja', label: 'Ninja Build', short: 'ninja', family: 'other', mime: 'text/plain', exts: ['ninja'], basenames: ['build.ninja'] },
  { id: 'taskfile', label: 'Taskfile', short: 'task', family: 'other', mime: 'text/plain', basenames: ['taskfile.yml', 'taskfile.yaml'] },
  { id: 'liquid', label: 'Liquid', short: 'liquid', family: 'other', mime: 'text/plain', exts: ['liquid'] },
  { id: 'typst', label: 'Typst', short: 'typ', family: 'other', mime: 'text/plain', exts: ['typ'] },
];

const BY_EXT = new Map<string, CodeLanguage>();
const BY_BASENAME = new Map<string, CodeLanguage>();

function publicLang(def: LangDef): CodeLanguage {
  return { id: def.id, label: def.label, short: def.short, family: def.family, mime: def.mime };
}

for (const def of LANGUAGES) {
  const lang = publicLang(def);
  // First registration wins so later languages cannot steal an extension
  // already claimed (e.g. OpenCL must not overwrite Lisp's `.cl`).
  for (const ext of def.exts ?? []) {
    if (!BY_EXT.has(ext)) BY_EXT.set(ext, lang);
  }
  for (const base of def.basenames ?? []) {
    if (!BY_BASENAME.has(base)) BY_BASENAME.set(base, lang);
  }
}

const FILE_TYPE_LABELS: Record<FileType, string> = {
  md: 'Markdown',
  txt: 'Plain Text',
  pdf: 'PDF',
  html: 'HTML',
  json: 'JSON',
  yaml: 'YAML',
  csv: 'CSV',
  docx: 'Word',
  pptx: 'PowerPoint',
  xlsx: 'Excel',
  code: 'Source',
  other: 'Document',
};

/** True when the ingest router should treat this extension as source code. */
export function isCodeExtension(ext: string): boolean {
  return BY_EXT.has(ext.toLowerCase());
}

/** True when this extensionless / special basename is source code. */
export function isCodeBasename(base: string): boolean {
  return BY_BASENAME.has(base.toLowerCase());
}

export function codeLanguageOf(name: string): CodeLanguage | null {
  const base = posixBasename(name);
  if (!base) return null;
  const special = BY_BASENAME.get(base.toLowerCase());
  if (special) return special;
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return null;
  return BY_EXT.get(base.slice(dot + 1).toLowerCase()) ?? null;
}

export function codeLanguageForNode(node: Pick<DocNode, 'fileType' | 'path' | 'title'>): CodeLanguage | null {
  if (node.fileType !== 'code') return null;
  return codeLanguageOf(node.path ?? node.title);
}

/** Chip text: `ts` / `py` for code, otherwise the FileType (`md`, `pdf`). */
export function fileTypeChip(node: Pick<DocNode, 'fileType' | 'path' | 'title'>): string {
  return codeLanguageForNode(node)?.short ?? node.fileType;
}

/** Human type label for the reader / viewer (`TypeScript`, `Markdown`). */
export function fileTypeLabel(node: Pick<DocNode, 'fileType' | 'path' | 'title'>): string {
  return codeLanguageForNode(node)?.label ?? FILE_TYPE_LABELS[node.fileType] ?? 'Document';
}

/**
 * Selected-document name: keep the stored title (used for linking) and
 * append the short language so `Util.ts` and `Util.py` don't look identical.
 */
export function selectedDocumentTitle(node: Pick<DocNode, 'fileType' | 'path' | 'title'>): string {
  const lang = codeLanguageForNode(node);
  if (!lang) return node.title;
  const suffix = ` · ${lang.short}`;
  const lower = node.title.toLowerCase();
  if (lower.endsWith(suffix.toLowerCase()) || lower.endsWith(`.${lang.short}`)) return node.title;
  return `${node.title}${suffix}`;
}

/**
 * Source-code parser: decode as text, pull import/include specifiers (for
 * reference edges) and top-level symbol names (headings + extra entities).
 * Worker-safe (no DOM). Language is inferred from the filename only.
 */

import type { LinkRef } from '../../model/types';
import { posixBasename } from '../../util/posixPath';
import { cleanFilename, decodeText, type ParserResult } from './txt';

const MAX_HEADINGS = 24;
const MAX_IMPORTS = 80;

type CodeFamily = 'js' | 'python' | 'go' | 'rust' | 'c' | 'java' | 'ruby' | 'php' | 'css' | 'other';

function familyOf(name: string): CodeFamily {
  const base = posixBasename(name).toLowerCase();
  const ext = base.includes('.') ? base.slice(base.lastIndexOf('.') + 1) : base;
  if (['ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs', 'vue', 'svelte'].includes(ext)) return 'js';
  if (ext === 'py' || ext === 'pyi') return 'python';
  if (ext === 'go') return 'go';
  if (ext === 'rs') return 'rust';
  if (['c', 'h', 'cc', 'cpp', 'cxx', 'hh', 'hpp', 'hxx'].includes(ext)) return 'c';
  if (['java', 'kt', 'kts', 'scala'].includes(ext)) return 'java';
  if (ext === 'rb' || base === 'rakefile' || base === 'gemfile') return 'ruby';
  if (ext === 'php') return 'php';
  if (ext === 'css' || ext === 'scss' || ext === 'less') return 'css';
  return 'other';
}

const JS_FROM_RE =
  /\b(?:import|export)\s+(?:type\s+)?(?:[^'"\n]{0,200}?\sfrom\s+)?['"]([^'"]{1,512})['"]/g;
const JS_REQUIRE_RE = /\b(?:require|import)\s*\(\s*['"]([^'"]{1,512})['"]\s*\)/g;
const PY_FROM_RE = /^[ \t]*from[ \t]+(\.*[A-Za-z_][\w.]*)[ \t]+import\b/gm;
const PY_IMPORT_RE = /^[ \t]*import[ \t]+([A-Za-z_][\w.]*(?:[ \t]*,[ \t]*[A-Za-z_][\w.]*)*)/gm;
const GO_SINGLE_RE = /^import[ \t]+(?:[A-Za-z_]\w*[ \t]+)?"([^"]{1,512})"/gm;
const C_INCLUDE_RE = /^[ \t]*#[ \t]*include[ \t]+"([^"]{1,512})"/gm;
const RUBY_REL_RE = /\brequire_relative[ \t]+['"]([^'"]{1,512})['"]/g;
const PHP_REQUIRE_RE = /\b(?:require|include)(?:_once)?[ \t]*(?:\(?[ \t]*)['"]([^'"]{1,512})['"]/g;
const CSS_IMPORT_RE = /@(?:import|use|forward)\s+(?:url\()?['"]([^'"]{1,512})['"]/g;
const RUST_MOD_RE = /^[ \t]*(?:pub[ \t]+)?mod[ \t]+([A-Za-z_][\w]*)\s*;/gm;
const RUST_USE_RE = /^[ \t]*(?:pub[ \t]+)?use[ \t]+((?:crate|super|self)::[^;]+);/gm;
const JAVA_IMPORT_RE = /^[ \t]*import[ \t]+(?:static[ \t]+)?([A-Za-z_][\w.]*(?:\.\*)?)[ \t]*;/gm;

const SYMBOL_RE =
  /\b(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\*?|class|interface|type|enum|struct)\s+([A-Za-z_][\w]*)/g;
const PY_DEF_RE = /^[ \t]*(?:async[ \t]+)?(?:def|class)[ \t]+([A-Za-z_][\w]*)/gm;
const GO_FUNC_RE = /^func[ \t]+(?:\([^)]+\)[ \t]+)?([A-Za-z_][\w]*)/gm;
const RUST_FN_RE = /^[ \t]*(?:pub(?:\([^)]+\))?[ \t]+)?(?:async[ \t]+)?(?:fn|struct|enum|trait|type)[ \t]+([A-Za-z_][\w]*)/gm;

function pushUnique(list: string[], value: string, cap: number): void {
  if (!value || list.includes(value) || list.length >= cap) return;
  list.push(value);
}

function isSkippableBare(spec: string): boolean {
  const s = spec.trim();
  if (!s) return true;
  if (/^(node|bun|deno|std|jsr):/i.test(s)) return true;
  if (/^(https?:|mailto:|data:)/i.test(s)) return true;
  return false;
}

/** Convert a Python relative import (`.foo`, `..bar`) into a ./ ../ specifier. */
export function pythonRelativeToSpecifier(mod: string): string {
  const match = /^(\.+)(.*)$/.exec(mod);
  if (!match) return mod.replace(/\./g, '/');
  const dots = match[1].length;
  const rest = match[2].replace(/\./g, '/');
  if (dots <= 1) return rest ? `./${rest}` : '.';
  const up = Array.from({ length: dots - 1 }, () => '..').join('/');
  return rest ? `${up}/${rest}` : up;
}

function collectJs(text: string, targets: string[]): void {
  for (const re of [JS_FROM_RE, JS_REQUIRE_RE]) {
    re.lastIndex = 0;
    for (const match of text.matchAll(re)) {
      const spec = match[1].trim();
      if (isSkippableBare(spec)) continue;
      if (!spec.startsWith('.') && !spec.startsWith('/') && !spec.includes('/')) continue;
      pushUnique(targets, spec, MAX_IMPORTS);
    }
  }
}

function collectPython(text: string, targets: string[]): void {
  PY_FROM_RE.lastIndex = 0;
  for (const match of text.matchAll(PY_FROM_RE)) {
    const mod = match[1];
    if (mod.startsWith('.')) pushUnique(targets, pythonRelativeToSpecifier(mod), MAX_IMPORTS);
    else pushUnique(targets, mod.replace(/\./g, '/'), MAX_IMPORTS);
  }
  PY_IMPORT_RE.lastIndex = 0;
  for (const match of text.matchAll(PY_IMPORT_RE)) {
    for (const part of match[1].split(',')) {
      const mod = part.trim().split(/\s+/)[0];
      if (!mod) continue;
      pushUnique(targets, mod.replace(/\./g, '/'), MAX_IMPORTS);
    }
  }
}

function collectGo(text: string, targets: string[]): void {
  GO_SINGLE_RE.lastIndex = 0;
  for (const match of text.matchAll(GO_SINGLE_RE)) {
    const spec = match[1].trim();
    if (spec.startsWith('.') || spec.includes('/')) pushUnique(targets, spec, MAX_IMPORTS);
  }
  const block = /import\s*\(([\s\S]*?)\)/g;
  for (const match of text.matchAll(block)) {
    for (const inner of match[1].matchAll(/"([^"]{1,512})"/g)) {
      const spec = inner[1].trim();
      if (spec.startsWith('.') || spec.includes('/')) pushUnique(targets, spec, MAX_IMPORTS);
    }
  }
}

function collectRust(text: string, targets: string[]): void {
  RUST_MOD_RE.lastIndex = 0;
  for (const match of text.matchAll(RUST_MOD_RE)) {
    pushUnique(targets, `./${match[1]}`, MAX_IMPORTS);
  }
  RUST_USE_RE.lastIndex = 0;
  for (const match of text.matchAll(RUST_USE_RE)) {
    const body = match[1].replace(/\{[\s\S]*\}/g, '').replace(/\s/g, '');
    const parts = body.split('::').filter((p) => p && p !== 'crate' && p !== 'super' && p !== 'self' && p !== '*');
    if (parts.length === 0) continue;
    if (match[1].includes('super::')) pushUnique(targets, `../${parts.join('/')}`, MAX_IMPORTS);
    else pushUnique(targets, parts.join('/'), MAX_IMPORTS);
  }
}

function collectJava(text: string, targets: string[]): void {
  JAVA_IMPORT_RE.lastIndex = 0;
  for (const match of text.matchAll(JAVA_IMPORT_RE)) {
    const spec = match[1].replace(/\.\*$/, '');
    if (!spec) continue;
    pushUnique(targets, spec.replace(/\./g, '/'), MAX_IMPORTS);
  }
}

function collectSymbols(text: string, family: CodeFamily): string[] {
  const names: string[] = [];
  const add = (re: RegExp) => {
    re.lastIndex = 0;
    for (const match of text.matchAll(re)) pushUnique(names, match[1], MAX_HEADINGS);
  };
  if (family === 'python') add(PY_DEF_RE);
  else if (family === 'go') add(GO_FUNC_RE);
  else if (family === 'rust') add(RUST_FN_RE);
  else add(SYMBOL_RE);
  return names;
}

export function extractCodeImports(text: string, name: string): string[] {
  const family = familyOf(name);
  const targets: string[] = [];
  if (family === 'js') collectJs(text, targets);
  else if (family === 'python') collectPython(text, targets);
  else if (family === 'go') collectGo(text, targets);
  else if (family === 'rust') collectRust(text, targets);
  else if (family === 'c') {
    C_INCLUDE_RE.lastIndex = 0;
    for (const match of text.matchAll(C_INCLUDE_RE)) pushUnique(targets, match[1].trim(), MAX_IMPORTS);
  } else if (family === 'java') collectJava(text, targets);
  else if (family === 'ruby') {
    RUBY_REL_RE.lastIndex = 0;
    for (const match of text.matchAll(RUBY_REL_RE)) pushUnique(targets, `./${match[1].trim()}`, MAX_IMPORTS);
  } else if (family === 'php') {
    PHP_REQUIRE_RE.lastIndex = 0;
    for (const match of text.matchAll(PHP_REQUIRE_RE)) {
      const spec = match[1].trim();
      if (spec.startsWith('.') || spec.startsWith('/')) pushUnique(targets, spec, MAX_IMPORTS);
    }
  } else if (family === 'css') {
    CSS_IMPORT_RE.lastIndex = 0;
    for (const match of text.matchAll(CSS_IMPORT_RE)) pushUnique(targets, match[1].trim(), MAX_IMPORTS);
  }
  return targets;
}

export function parseCode(bytes: ArrayBuffer, name: string): ParserResult {
  const text = decodeText(bytes);
  const imports = extractCodeImports(text, name);
  const headings = collectSymbols(text, familyOf(name));
  const docLinks: LinkRef[] = imports.map((url) => ({ text: url, url }));
  return {
    title: cleanFilename(name),
    text,
    headings,
    mdLinkTargets: imports,
    docLinks,
    status: 'ok',
  };
}

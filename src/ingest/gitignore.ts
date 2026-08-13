/**
 * A focused .gitignore matcher for folder / repo drops.
 *
 * Covers the patterns real repositories actually use: comments, negation,
 * directory-only trailing slashes, anchored leading slashes, `*` / `?` / `**`,
 * and last-match-wins. Character classes are treated literally enough to be
 * safe; this is not a full git implementation.
 */

import { posixJoin, posixNormalize } from '../util/posixPath';

export interface GitIgnoreRule {
  negative: boolean;
  directoryOnly: boolean;
  /** Directory that contained the .gitignore, relative to the dropped root. */
  baseDir: string;
  /** True when the pattern has no slash (matches in any subdirectory). */
  unanchored: boolean;
  /** Pattern text (post !, trailing /, leading / stripped), pre-glob-compile. */
  pattern: string;
  regex: RegExp;
}

export function parseGitignore(text: string, baseDir: string): GitIgnoreRule[] {
  const base = posixNormalize(baseDir);
  const rules: GitIgnoreRule[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = stripTrailingUnescapedSpaces(rawLine);
    if (!line || line.startsWith('#')) continue;
    let body = line;
    let negative = false;
    if (body.startsWith('!')) {
      negative = true;
      body = body.slice(1);
    }
    if (!body) continue;
    let directoryOnly = false;
    if (body.endsWith('/')) {
      directoryOnly = true;
      body = body.slice(0, -1);
    }
    let unanchored = true;
    if (body.startsWith('/')) {
      unanchored = false;
      body = body.slice(1);
    } else if (body.includes('/')) {
      unanchored = false;
    }
    body = body.replace(/\\([ #!])/g, '$1');
    if (!body) continue;
    rules.push({
      negative,
      directoryOnly,
      baseDir: base,
      unanchored,
      pattern: body,
      regex: globToRegExp(body),
    });
  }
  return rules;
}

/**
 * Last matching rule wins at each level; negation un-ignores. Mirrors real
 * git: a directory excluded by a rule that matches the directory itself
 * cannot be re-included by a deeper negation (`dist/` + `!dist/keep.md`
 * still ignores `dist/keep.md`) — only a rule that stops short of matching
 * the directory itself (`dist/*`) leaves room for a later per-file negation.
 * So each ancestor is resolved bottom-up; once one is ignored, nothing below
 * it can flip that back.
 */
export function pathIsGitIgnored(
  relativePath: string,
  isDirectory: boolean,
  rules: readonly GitIgnoreRule[],
): boolean {
  const path = posixNormalize(relativePath);
  if (!path) return false;
  const segments = path.split('/');
  let ignored = false;
  let current = '';
  for (let i = 0; i < segments.length; i += 1) {
    current = current ? `${current}/${segments[i]}` : segments[i];
    if (ignored) continue; // ancestor already excluded; no rule can re-include a descendant
    const isFinal = i === segments.length - 1;
    ignored = selfMatchIgnored(current, isFinal ? isDirectory : true, rules);
  }
  return ignored;
}

/** Whether `path` itself (not its descendants) matches an ignore rule. */
function selfMatchIgnored(path: string, isDirectory: boolean, rules: readonly GitIgnoreRule[]): boolean {
  let ignored = false;
  for (const rule of rules) {
    const local = stripBase(path, rule.baseDir);
    if (local === null) continue;
    if (rule.directoryOnly && !isDirectory) continue;
    const matches = matchCandidates(local, rule.unanchored).some((candidate) => rule.regex.test(candidate));
    if (!matches) continue;
    ignored = !rule.negative;
  }
  return ignored;
}

/**
 * True when a negation rule could un-ignore some path under `dirPath` — used
 * to decide whether a default-ignored directory (node_modules, dist, …) is
 * still worth walking instead of skipping outright for performance.
 */
export function hasUnignoreUnder(dirPath: string, rules: readonly GitIgnoreRule[]): boolean {
  const dir = posixNormalize(dirPath);
  if (!dir) return false;
  const target = dir.toLowerCase();
  for (const rule of rules) {
    if (!rule.negative) continue;
    if (rule.unanchored) return true; // could match at any depth, including under dir
    // Case-insensitive like the match regexes (git core.ignorecase=true): a
    // negation written as `!Dist/keep.md` must still keep an on-disk `dist/`
    // walkable, since pathIsGitIgnored would un-ignore the file inside it.
    const scope = (rule.baseDir ? posixJoin(rule.baseDir, rule.pattern) : rule.pattern).toLowerCase();
    if (scope === target || scope.startsWith(`${target}/`)) return true;
  }
  return false;
}

function stripBase(path: string, baseDir: string): string | null {
  if (!baseDir) return path;
  if (path === baseDir) return '';
  if (path.startsWith(`${baseDir}/`)) return path.slice(baseDir.length + 1);
  return null;
}

function matchCandidates(local: string, unanchored: boolean): string[] {
  if (!local) return [];
  if (!unanchored) return [local];
  const segments = local.split('/');
  const out = [local];
  for (let i = 0; i < segments.length; i += 1) {
    out.push(segments.slice(i).join('/'));
  }
  return out;
}

function stripTrailingUnescapedSpaces(line: string): string {
  let end = line.length;
  while (end > 0 && line[end - 1] === ' ' && (end < 2 || line[end - 2] !== '\\')) {
    end -= 1;
  }
  return line.slice(0, end);
}

function globToRegExp(pattern: string): RegExp {
  let out = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];
    if (ch === '*' && pattern[i + 1] === '*') {
      const next = pattern[i + 2];
      if (next === '/' || next === undefined) {
        out += next === '/' ? '(?:.*/)?': '.*';
        i += next === '/' ? 2 : 1;
        continue;
      }
      out += '.*';
      i += 1;
      continue;
    }
    if (ch === '*') {
      out += '[^/]*';
      continue;
    }
    if (ch === '?') {
      out += '[^/]';
      continue;
    }
    if (ch === '.' || ch === '+' || ch === '(' || ch === ')' || ch === '{' || ch === '}' ||
        ch === '[' || ch === ']' || ch === '^' || ch === '$' || ch === '|' || ch === '\\') {
      out += `\\${ch}`;
      continue;
    }
    out += ch;
  }
  return new RegExp(`^${out}$`, 'i');
}

export function mergeGitIgnoreRules(
  ancestor: readonly GitIgnoreRule[],
  localText: string | null,
  baseDir: string,
): GitIgnoreRule[] {
  if (!localText) return [...ancestor];
  return [...ancestor, ...parseGitignore(localText, baseDir)];
}

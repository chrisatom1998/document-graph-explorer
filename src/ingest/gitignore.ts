/**
 * A focused .gitignore matcher for folder / repo drops.
 *
 * Covers the patterns real repositories actually use: comments, negation,
 * directory-only trailing slashes, anchored leading slashes, `*` / `?` / `**`,
 * and last-match-wins. Character classes are treated literally enough to be
 * safe; this is not a full git implementation.
 */

import { posixNormalize } from '../util/posixPath';

export interface GitIgnoreRule {
  negative: boolean;
  directoryOnly: boolean;
  /** Directory that contained the .gitignore, relative to the dropped root. */
  baseDir: string;
  /** True when the pattern has no slash (matches in any subdirectory). */
  unanchored: boolean;
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
      regex: globToRegExp(body),
    });
  }
  return rules;
}

/** Last matching rule wins; negation un-ignores. */
export function pathIsGitIgnored(
  relativePath: string,
  isDirectory: boolean,
  rules: readonly GitIgnoreRule[],
): boolean {
  const path = posixNormalize(relativePath);
  if (!path) return false;
  let ignored = false;
  for (const rule of rules) {
    if (!pathMatchesRule(path, isDirectory, rule)) continue;
    ignored = !rule.negative;
  }
  return ignored;
}

function pathMatchesRule(path: string, isDirectory: boolean, rule: GitIgnoreRule): boolean {
  const local = stripBase(path, rule.baseDir);
  if (local === null) return false;
  const selfMatches = matchCandidates(local, rule.unanchored).some((candidate) => rule.regex.test(candidate));
  if (selfMatches && (!rule.directoryOnly || isDirectory)) return true;
  // A rule matching a parent directory ignores everything beneath it, but a
  // negation only un-ignores the directory entry itself (so the walk can
  // descend); children stay ignored until a rule names them, as in git.
  if (rule.negative) return false;
  return parentDirs(local).some((dir) =>
    matchCandidates(dir, rule.unanchored).some((candidate) => rule.regex.test(candidate)),
  );
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

function parentDirs(path: string): string[] {
  const parts = path.split('/');
  const dirs: string[] = [];
  for (let i = 1; i < parts.length; i += 1) {
    dirs.push(parts.slice(0, i).join('/'));
  }
  return dirs;
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

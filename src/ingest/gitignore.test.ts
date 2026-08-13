import { describe, expect, it } from 'vitest';
import { hasUnignoreUnder, parseGitignore, pathIsGitIgnored } from './gitignore';

describe('parseGitignore + pathIsGitIgnored', () => {
  it('ignores comments, blank lines, and matches unanchored globs in any folder', () => {
    const rules = parseGitignore('# keep\n\n*.log\nsecret/\n', '');
    expect(pathIsGitIgnored('debug.log', false, rules)).toBe(true);
    expect(pathIsGitIgnored('src/debug.log', false, rules)).toBe(true);
    expect(pathIsGitIgnored('secret', true, rules)).toBe(true);
    expect(pathIsGitIgnored('secret/key.txt', false, rules)).toBe(true);
    expect(pathIsGitIgnored('secret', false, rules)).toBe(false);
    expect(pathIsGitIgnored('src/app.ts', false, rules)).toBe(false);
  });

  it('treats a leading slash as relative to the gitignore directory', () => {
    const rules = parseGitignore('/build\n', '');
    expect(pathIsGitIgnored('build', true, rules)).toBe(true);
    expect(pathIsGitIgnored('pkg/build', true, rules)).toBe(false);
  });

  it('cannot re-include a file whose parent directory is fully excluded', () => {
    // Real git: `dist/` excludes the directory itself, so a deeper negation
    // can't reach inside it — matches "It is not possible to re-include a
    // file if a parent directory of that file is excluded."
    const rules = parseGitignore('dist/\n!dist/keep.md\n', '');
    expect(pathIsGitIgnored('dist/out.js', false, rules)).toBe(true);
    expect(pathIsGitIgnored('dist/keep.md', false, rules)).toBe(true);
  });

  it('lets a later negation un-ignore a path when the directory itself is not excluded', () => {
    // `dist/*` only matches direct contents, not the `dist` entry itself, so
    // the directory stays walkable and a specific negation can re-include it.
    const rules = parseGitignore('dist/*\n!dist/keep.md\n', '');
    expect(pathIsGitIgnored('dist', true, rules)).toBe(false);
    expect(pathIsGitIgnored('dist/out.js', false, rules)).toBe(true);
    expect(pathIsGitIgnored('dist/keep.md', false, rules)).toBe(false);
  });

  it('scopes nested gitignore rules to that directory', () => {
    const root = parseGitignore('*.tmp\n', '');
    const nested = [...root, ...parseGitignore('local/\n', 'pkg')];
    expect(pathIsGitIgnored('scratch.tmp', false, nested)).toBe(true);
    expect(pathIsGitIgnored('pkg/local', true, nested)).toBe(true);
    expect(pathIsGitIgnored('other/local', true, nested)).toBe(false);
  });

  it('matches ** across directories', () => {
    const rules = parseGitignore('**/generated/*\n', '');
    expect(pathIsGitIgnored('src/generated/out.ts', false, rules)).toBe(true);
    expect(pathIsGitIgnored('generated/out.ts', false, rules)).toBe(true);
    expect(pathIsGitIgnored('src/app.ts', false, rules)).toBe(false);
  });

  it('matches case-insensitively like git with core.ignorecase=true', () => {
    // Repos written on macOS/Windows routinely mix pattern and on-disk case.
    const rules = parseGitignore('*.PDF\nDist/\nNode_Modules/\n', '');
    expect(pathIsGitIgnored('file.pdf', false, rules)).toBe(true);
    expect(pathIsGitIgnored('docs/REPORT.pdf', false, rules)).toBe(true);
    expect(pathIsGitIgnored('dist', true, rules)).toBe(true);
    expect(pathIsGitIgnored('dist/app.js', false, rules)).toBe(true);
    expect(pathIsGitIgnored('node_modules', true, rules)).toBe(true);
    // and the reverse: lowercase pattern, uppercase path
    const lower = parseGitignore('*.pdf\nbuild/\n', '');
    expect(pathIsGitIgnored('FILE.PDF', false, lower)).toBe(true);
    expect(pathIsGitIgnored('Build', true, lower)).toBe(true);
  });

  it('negations un-ignore case-insensitively, including the walk-skip probe', () => {
    // `dist/*` leaves the directory itself walkable; the differently-cased
    // negation must both un-ignore the file and keep hasUnignoreUnder from
    // letting the scanner skip the default-ignored `dist` outright.
    const rules = parseGitignore('dist/*\n!Dist/keep.md\n', '');
    expect(pathIsGitIgnored('dist/out.js', false, rules)).toBe(true);
    expect(pathIsGitIgnored('dist/keep.md', false, rules)).toBe(false);
    expect(hasUnignoreUnder('dist', rules)).toBe(true);
  });
});

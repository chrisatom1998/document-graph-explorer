import { describe, expect, it } from 'vitest';
import { posixJoin, posixNormalize, posixResolveFrom, stripKnownExtension } from './posixPath';

describe('posix path helpers', () => {
  it('normalizes slashes and resolves relative specifiers', () => {
    expect(posixNormalize('src\\\\auth\\\\session.ts')).toBe('src/auth/session.ts');
    expect(posixJoin('src/auth', './token')).toBe('src/auth/token');
    expect(posixResolveFrom('src/auth/session.ts', './token')).toBe('src/auth/token');
    expect(posixResolveFrom('src/auth/session.ts', '../types')).toBe('src/types');
    expect(posixResolveFrom('src/auth/session.ts', '/docs/guide.md')).toBe('docs/guide.md');
    expect(stripKnownExtension('session.ts')).toBe('session');
  });
});

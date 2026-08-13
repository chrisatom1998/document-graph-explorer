import { describe, expect, it } from 'vitest';
import { extractCodeImports, parseCode, pythonRelativeToSpecifier } from './code';

function bytes(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer;
}

describe('pythonRelativeToSpecifier', () => {
  it('maps dotted relative imports onto ./ and ../ paths', () => {
    expect(pythonRelativeToSpecifier('.foo')).toBe('./foo');
    expect(pythonRelativeToSpecifier('..bar')).toBe('../bar');
    expect(pythonRelativeToSpecifier('...pkg.util')).toBe('../../pkg/util');
    expect(pythonRelativeToSpecifier('mypkg.utils')).toBe('mypkg/utils');
  });
});

describe('extractCodeImports', () => {
  it('collects JS/TS relative imports and skips bare packages', () => {
    const src = `
      import React from 'react';
      import type { Session } from './session';
      export { token } from '../auth/token';
      const helpers = require('./helpers');
      void import('./lazy');
    `;
    expect(extractCodeImports(src, 'app.ts')).toEqual([
      './session',
      '../auth/token',
      './helpers',
      './lazy',
    ]);
  });

  it('collects Python from/import including relatives', () => {
    const src = `
from .helpers import load
from ..auth.session import Session
import os, mypkg.utils
`;
    expect(extractCodeImports(src, 'svc.py')).toEqual([
      './helpers',
      '../auth/session',
      'os',
      'mypkg/utils',
    ]);
  });

  it('collects Go local imports and quoted C includes', () => {
    expect(extractCodeImports('import "./pkg/util"\nimport "fmt"\n', 'main.go')).toEqual([
      './pkg/util',
    ]);
    expect(extractCodeImports('#include "local.h"\n#include <stdio.h>\n', 'main.c')).toEqual([
      'local.h',
    ]);
  });
});

describe('parseCode', () => {
  it('keeps source text, titles from the filename, and symbols as headings', () => {
    const parsed = parseCode(
      bytes(`
export function loadSession() {}
export class AuthClient {}
import { token } from './token';
`),
      'session.ts',
    );
    expect(parsed.title).toBe('Session');
    expect(parsed.mdLinkTargets).toEqual(['./token']);
    expect(parsed.headings).toEqual(['loadSession', 'AuthClient']);
    expect(parsed.docLinks).toEqual([{ text: './token', url: './token' }]);
    expect(parsed.text).toContain('export function loadSession');
    expect(parsed.status).toBe('ok');
  });
});

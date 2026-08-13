import { describe, expect, it } from 'vitest';
import { extractCodeImports, extractCodeSymbols, parseCode, pythonRelativeToSpecifier } from './code';

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
    expect(extractCodeImports('#import "Session.h"\n', 'Session.m')).toEqual(['Session.h']);
  });

  it('collects C# usings, Dart relative imports, and shell sources', () => {
    expect(extractCodeImports('using System;\nusing MyApp.Auth;\n', 'Program.cs')).toEqual([
      'System',
      'MyApp/Auth',
    ]);
    expect(extractCodeImports("import './session.dart';\nimport 'package:flutter/material.dart';\n", 'main.dart')).toEqual([
      './session.dart',
    ]);
    expect(extractCodeImports('source ./helpers.sh\n. ./lib.sh\n', 'setup.sh')).toEqual([
      './helpers.sh',
      './lib.sh',
    ]);
    expect(
      extractCodeImports('ls . ./lib.sh\ncp . ./backup\nfoo; . ./lib.sh\n  source ./helpers.sh\n', 'setup.sh'),
    ).toEqual(['./lib.sh', './helpers.sh']);
  });

  it('keeps Lua relative require paths intact and slashes dotted modules', () => {
    const src = `
      require('./foo')
      require('../bar')
      require('./lib/util.lua')
      require('socket.http')
      require('plain')
    `;
    expect(extractCodeImports(src, 'init.lua')).toEqual([
      './foo',
      '../bar',
      './lib/util.lua',
      'socket/http',
    ]);
  });

  it('treats Astro files as the JS import family', () => {
    expect(extractCodeImports("import Layout from '../Layout.astro';\n", 'Page.astro')).toEqual([
      '../Layout.astro',
    ]);
  });
});

describe('extractCodeSymbols', () => {
  it('re-derives defined symbols from source text (cache backfill path)', () => {
    expect(
      extractCodeSymbols('export function loadSession() {}\nexport class AuthClient {}\n', 'x.ts'),
    ).toEqual(['loadSession', 'AuthClient']);
    expect(extractCodeSymbols('def refresh_token_flow():\n    pass\n', 'auth.py')).toEqual([
      'refresh_token_flow',
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

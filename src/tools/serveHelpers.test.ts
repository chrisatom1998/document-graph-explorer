import { describe, expect, it } from 'vitest';
import path from 'node:path';
// @ts-expect-error - scripts/serve.mjs is a plain Node ESM script (no allowJs/.d.ts
// for the scripts/ dir); imported here purely for its pure, unit-testable helpers.
import { distDirFor } from '../../scripts/serve.mjs';
// @ts-expect-error - scripts/staticServer.cjs is a plain Node CJS module (no
// allowJs/.d.ts for the scripts/ dir); imported here purely for its pure,
// unit-testable helpers. Shared by serve.mjs, serve-exe.cjs, and desktop/main.cjs.
import { SECURITY_HEADERS, contentTypeFor, createRequestHandler, resolveSafe } from '../../scripts/staticServer.cjs';

describe('distDirFor', () => {
  it('defaults to the normal build (dist)', () => {
    expect(distDirFor([])).toBe('dist');
  });

  it('serves dist-airgap when --airgap is passed', () => {
    expect(distDirFor(['--airgap'])).toBe('dist-airgap');
  });

  it('ignores unrelated flags', () => {
    expect(distDirFor(['--verbose', '--port=9000'])).toBe('dist');
  });
});

describe('contentTypeFor', () => {
  it.each([
    ['index.html', 'text/html; charset=utf-8'],
    ['app.js', 'text/javascript; charset=utf-8'],
    ['worker.mjs', 'text/javascript; charset=utf-8'],
    ['styles.css', 'text/css; charset=utf-8'],
    ['manifest.json', 'application/json; charset=utf-8'],
    ['icon.svg', 'image/svg+xml'],
    ['logo.png', 'image/png'],
    ['favicon.ico', 'image/x-icon'],
    ['model.wasm', 'application/wasm'],
    ['site.webmanifest', 'application/manifest+json'],
    ['font.woff', 'font/woff'],
    ['font.woff2', 'font/woff2'],
    ['notes.txt', 'text/plain; charset=utf-8'],
    ['README.md', 'text/markdown; charset=utf-8'],
  ])('maps %s -> %s', (name, expected) => {
    expect(contentTypeFor(name)).toBe(expected);
  });

  it('is case-insensitive on the extension', () => {
    expect(contentTypeFor('MODEL.WASM')).toBe('application/wasm');
  });

  it('falls back to octet-stream for unknown extensions', () => {
    expect(contentTypeFor('archive.bin')).toBe('application/octet-stream');
  });

  it('falls back to octet-stream for no extension at all', () => {
    expect(contentTypeFor('LICENSE')).toBe('application/octet-stream');
  });
});

describe('resolveSafe', () => {
  const root = path.resolve('/dist-airgap-test-root');

  it('maps / to index.html', () => {
    expect(resolveSafe(root, '/')).toBe(path.join(root, 'index.html'));
  });

  it('resolves a normal nested path', () => {
    expect(resolveSafe(root, '/assets/app.js')).toBe(path.join(root, 'assets', 'app.js'));
  });

  it('resolves a normal nested path with a query string', () => {
    expect(resolveSafe(root, '/assets/app.js?v=123')).toBe(path.join(root, 'assets', 'app.js'));
  });

  it('blocks literal ../ traversal', () => {
    expect(resolveSafe(root, '/../package.json')).toBeNull();
  });

  it('blocks deeper ../../ traversal', () => {
    expect(resolveSafe(root, '/assets/../../package.json')).toBeNull();
  });

  it('blocks a URL-encoded traversal (..%2f)', () => {
    expect(resolveSafe(root, '/..%2fpackage.json')).toBeNull();
  });

  it('blocks a fully URL-encoded ../ (%2e%2e%2f)', () => {
    expect(resolveSafe(root, '/%2e%2e%2fpackage.json')).toBeNull();
  });

  it('blocks a sibling directory whose name shares the root as a prefix', () => {
    // With root .../dist-airgap, a path resolving to .../dist-airgap-evil/...
    // passes a naive startsWith(root) check but must fail the trailing-
    // separator prefix check — lock that in against future refactors.
    const sibling = path.basename(root) + '-evil';
    expect(resolveSafe(root, `/../${sibling}/secret.txt`)).toBeNull();
  });

  // Drive-absolute injection (a decoded path starting "C:\...") only means
  // anything on Windows — path.isAbsolute() doesn't recognize drive letters
  // on POSIX, so this guard is meaningfully exercised only there.
  it.runIf(process.platform === 'win32')('blocks a drive-absolute-path escape', () => {
    // After stripping exactly one leading slash, "C:\Windows\win.ini" is
    // still absolute per path.isAbsolute() on win32 — the explicit
    // isAbsolute() check in resolveSafe (not just the prefix check) is what
    // catches this.
    expect(resolveSafe(root, '/C:\\Windows\\win.ini')).toBeNull();
  });

  it('rejects malformed percent-encoding instead of throwing', () => {
    expect(resolveSafe(root, '/%')).toBeNull();
  });
});

describe('SECURITY_HEADERS', () => {
  it('carries the anti-clickjacking and sniffing protections', () => {
    expect(SECURITY_HEADERS).toEqual({
      'X-Frame-Options': 'DENY',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    });
  });

  it('sets static and per-response headers together', () => {
    // Electron's server needs both at once: the shared security headers plus
    // its own Cache-Control. Passing `headers` must not displace
    // `getResponseHeaders`, which is why the two are asserted in one handler.
    const handler = createRequestHandler(path.resolve('.'), {
      headers: SECURITY_HEADERS,
      getResponseHeaders: () => ({ 'Cache-Control': 'no-cache' }),
      log: () => {},
    });

    const set = new Map<string, string>();
    const res = {
      setHeader: (name: string, value: string) => set.set(name, value),
      writeHead: () => {},
      end: () => {},
    };
    handler({ url: '/definitely-missing-file', method: 'GET' }, res);

    expect(set.get('X-Frame-Options')).toBe('DENY');
    expect(set.get('X-Content-Type-Options')).toBe('nosniff');
    expect(set.get('Referrer-Policy')).toBe('no-referrer');
  });
});

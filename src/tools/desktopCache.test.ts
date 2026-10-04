import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);

function loadDesktop(previousVersion?: string) {
  const clearCache = vi.fn().mockResolvedValue(undefined);
  const writeFileSync = vi.fn();
  let responseHeaders: (target: string) => Record<string, string>;
  const exported = { exports: {} as {
    refreshCacheForVersion: () => Promise<void>;
    startStaticServer: () => Promise<string>;
  } };
  runInNewContext(readFileSync('desktop/main.cjs', 'utf8') +
    '\nmodule.exports = { refreshCacheForVersion, startStaticServer };', {
    module: exported,
    __dirname: path.resolve('desktop'),
    console,
    require: (id: string) => {
      if (id === 'electron') return {
        app: {
          requestSingleInstanceLock: () => false, quit() {}, on() {},
          getVersion: () => '2.0.0', getPath: () => '/test-user-data',
        },
        session: { defaultSession: { clearCache } },
      };
      if (id === 'node:fs') return {
        readFileSync: () => {
          if (previousVersion === undefined) throw new Error('Missing marker');
          return previousVersion;
        },
        writeFileSync,
      };
      if (id === '../scripts/staticServer.cjs') return {
        hasIndexHtml: () => true,
        createRequestHandler: (_root: string, options: { getResponseHeaders: typeof responseHeaders }) => {
          responseHeaders = options.getResponseHeaders;
          return () => {};
        },
      };
      if (id === 'node:http') return {
        createServer: () => ({
          once() {}, listen(_port: number, _host: string, callback: () => void) { callback(); },
          address: () => ({ port: 47182 }),
        }),
      };
      return require(id);
    },
  });
  return {
    ...exported.exports,
    clearCache,
    writeFileSync,
    headers: (file: string) => responseHeaders(path.resolve('dist', file)),
  };
}

describe('desktop HTTP cache', () => {
  it('revalidates public resources while preserving immutable hashed bundles', async () => {
    const desktop = loadDesktop();
    await desktop.startStaticServer();
    for (const file of ['index.html', 'ocr/worker.min.js', 'ocr/core/tesseract-core-lstm.wasm.js',
      'models/Xenova/bge-small-en-v1.5/config.json', 'demo/manifest.json', 'demo/example.pdf']) {
      expect(desktop.headers(file)['Cache-Control']).toBe('no-cache');
    }
    expect(desktop.headers('assets/app-AbCd1234.js')['Cache-Control']).toContain('immutable');
    expect(desktop.headers('assets-other/script.js')['Cache-Control']).toBe('no-cache');
  });

  it.each([undefined, '1.0.0'])('invalidates existing HTTP resources for version %s', async (version) => {
    const desktop = loadDesktop(version);
    await desktop.refreshCacheForVersion();
    expect(desktop.clearCache).toHaveBeenCalledOnce();
    expect(desktop.writeFileSync).toHaveBeenCalledWith(
      path.join('/test-user-data', 'http-cache-version'), '2.0.0',
    );
  });

  it('preserves the HTTP cache when restarting the same release', async () => {
    const desktop = loadDesktop('2.0.0');
    await desktop.refreshCacheForVersion();
    expect(desktop.clearCache).not.toHaveBeenCalled();
    expect(desktop.writeFileSync).not.toHaveBeenCalled();
  });

  it('does not mark an unsuccessful invalidation as migrated', async () => {
    const desktop = loadDesktop('1.0.0');
    desktop.clearCache.mockRejectedValue(new Error('Cache busy'));
    await expect(desktop.refreshCacheForVersion()).rejects.toThrow('Cache busy');
    expect(desktop.writeFileSync).not.toHaveBeenCalled();
  });
});

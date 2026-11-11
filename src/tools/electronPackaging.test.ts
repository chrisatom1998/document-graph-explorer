import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { resolveBinaryPath } = require('../../scripts/harden-fuses.cjs') as {
  resolveBinaryPath: (context: {
    appOutDir: string;
    electronPlatformName: string;
    packager: { appInfo: { productFilename: string }; executableName?: string };
  }) => string;
};

describe('electron-builder packaging', () => {
  it('includes staticServer.cjs required by desktop/main.cjs', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
      build: { files: string[] };
    };
    expect(pkg.build.files).toContain('scripts/staticServer.cjs');
  });
});

describe('harden-fuses afterPack binary path', () => {
  // electron-builder names the mac bundle and Windows exe after productName,
  // but the Linux executable after the (lower-cased) package name.
  const packager = {
    appInfo: { productFilename: 'Document Graph Explorer' },
    executableName: 'document-graph-explorer',
  };
  const target = (electronPlatformName: string) =>
    resolveBinaryPath({ appOutDir: 'out', electronPlatformName, packager });

  it('uses the packager executable name on Linux', () => {
    expect(target('linux')).toBe(join('out', 'document-graph-explorer'));
  });

  it('keeps the product-named .app bundle on macOS', () => {
    expect(target('darwin')).toBe(join('out', 'Document Graph Explorer.app'));
  });

  it('keeps the product-named .exe on Windows', () => {
    expect(target('win32')).toBe(join('out', 'Document Graph Explorer.exe'));
  });
});

describe('Docker packaging', () => {
  it('keeps staged Windows downloads out of the Docker build context', () => {
    const dockerIgnore = readFileSync('.dockerignore', 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim());

    const downloadsRule = dockerIgnore.indexOf('docker/downloads/*');
    const placeholderRule = dockerIgnore.indexOf('!docker/downloads/.gitkeep');

    expect(downloadsRule).toBeGreaterThanOrEqual(0);
    expect(placeholderRule).toBeGreaterThan(downloadsRule);
  });
});

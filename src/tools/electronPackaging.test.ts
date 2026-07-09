import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('electron-builder packaging', () => {
  it('includes staticServer.cjs required by desktop/main.cjs', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
      build: { files: string[] };
    };
    expect(pkg.build.files).toContain('scripts/staticServer.cjs');
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

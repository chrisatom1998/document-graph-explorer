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

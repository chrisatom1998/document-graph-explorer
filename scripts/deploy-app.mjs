#!/usr/bin/env node
/**
 * Post-desktop-build deploy: copies the freshly built .app bundle to
 * /Applications/Document Graph Explorer.app so it shows up in Finder's Applications
 * folder, Launchpad, and Spotlight, and is always current.
 * Use macOS `ditto` so framework symlinks inside the bundle stay relative.
 */
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const SRC = join(import.meta.dirname, '..', 'release', 'mac-arm64', 'Document Graph Explorer.app');
const APPS_DIR = '/Applications';
const DEST = join(APPS_DIR, 'Document Graph Explorer.app');

if (!existsSync(SRC)) {
  console.error(`deploy-app: source not found — ${SRC}`);
  console.error('Run "npm run build:desktop" to produce the .app bundle first.');
  process.exit(1);
}

if (!existsSync(APPS_DIR)) {
  mkdirSync(APPS_DIR, { recursive: true });
}

// Remove stale copy before replacing so there are no leftover cruft files.
if (existsSync(DEST)) {
  rmSync(DEST, { recursive: true, force: true });
}

const copy = spawnSync('ditto', [SRC, DEST], { stdio: 'inherit' });
if (copy.status !== 0) {
  console.error(
    `deploy-app: could not write to ${APPS_DIR} — if this is a permissions error, run:\n` +
      `  sudo ditto "${SRC}" "${DEST}"`,
  );
  process.exit(copy.status ?? 1);
}

console.log(`✓  Document Graph Explorer.app → ${DEST}`);


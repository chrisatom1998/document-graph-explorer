/**
 * Files that look like source but should not become graph nodes when a
 * repository folder is dropped: lockfiles, sourcemaps, minified bundles.
 * Individually picked files still reach the coordinator, which reports the
 * same reason in the ignored tray.
 */

const LOCKFILE_NAMES = new Set([
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lock',
  'bun.lockb',
  'cargo.lock',
  'composer.lock',
  'gemfile.lock',
  'poetry.lock',
  'pdm.lock',
  'pipfile.lock',
  'go.sum',
  'flake.lock',
]);

const MINIFIED_RE = /\.(min|bundle)\.(js|mjs|cjs|css)$/i;

export function repoArtifactReason(name: string): string | null {
  const base = name.replace(/\\/g, '/').split('/').pop() ?? name;
  const lower = base.toLowerCase();
  if (LOCKFILE_NAMES.has(lower)) return 'lockfile';
  if (lower.endsWith('.map')) return 'source map';
  if (MINIFIED_RE.test(lower)) return 'generated bundle';
  return null;
}

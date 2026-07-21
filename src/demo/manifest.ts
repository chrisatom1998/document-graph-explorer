export const DEMO_MANIFEST_URL = '/demo/manifest.json';

/**
 * The desktop app keeps a stable origin across releases, and older builds
 * served public assets with a one-year immutable cache header. Always bypass
 * that cache for the unversioned manifest so an updated demo definition is
 * visible immediately after an app upgrade.
 */
export function fetchDemoManifest(): Promise<Response> {
  return fetch(DEMO_MANIFEST_URL, { cache: 'no-store' });
}

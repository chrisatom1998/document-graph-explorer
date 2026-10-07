/**
 * Open a portable share URL into the current tab.
 *
 * Startup and later hash changes share this path so a PWA or an already-open
 * tab actually loads the graph instead of ignoring the new fragment.
 */

import { useCorpusStore } from '../store/corpusStore';
import { useUiStore } from '../store/uiStore';
import { reportPersistenceUnavailable } from './cache';
import { initializeCorpusRepository } from './corpusRepository';
import { extractShareFragmentFromLocation } from './shareUrl';

export type ShareOpenResult = 'opened' | 'invalid' | 'none';

let applyGeneration = 0;
let lastOpenedFragment: string | null = null;

export function resetShareBootstrapForTests(): void {
  applyGeneration = 0;
  lastOpenedFragment = null;
}

function locationLike(loc?: { href: string; hash: string }): { href: string; hash: string } {
  return loc ?? { href: window.location.href, hash: window.location.hash };
}

/** Rewrite encoded / query / path-carried shares to a clean `#graph=` hash. */
export function normalizeShareLocation(
  fragment: string,
  loc: Pick<Location, 'pathname' | 'search' | 'hash'> = window.location,
  historyLike: Pick<History, 'replaceState'> = window.history,
): void {
  const pathname = loc.pathname.includes('%23graph=') || loc.pathname.includes('#graph=')
    ? '/'
    : loc.pathname || '/';
  const next = `${pathname}${fragment}`;
  const current = `${loc.pathname}${loc.search}${loc.hash}`;
  if (current === next) return;
  historyLike.replaceState(historyLike === window.history ? window.history.state : null, '', next);
}

export async function applyShareUrlFromLocation(
  loc?: { href: string; hash: string },
): Promise<ShareOpenResult> {
  const generation = ++applyGeneration;
  const resolved = locationLike(loc);
  const fragment = extractShareFragmentFromLocation(resolved);
  if (!fragment) {
    lastOpenedFragment = null;
    return 'none';
  }
  if (fragment === lastOpenedFragment && useCorpusStore.getState().mode === 'shared') {
    return 'opened';
  }

  if (!useCorpusStore.getState().initialized) {
    try {
      await initializeCorpusRepository();
    } catch (error) {
      reportPersistenceUnavailable(error);
    }
  }
  if (generation !== applyGeneration) return 'none';

  try {
    const { decodeShareFragment } = await import('./shareUrl');
    const shared = await decodeShareFragment(fragment);
    if (generation !== applyGeneration) return 'none';
    if (!shared) return 'none';

    const { importGraphExportData } = await import('./exportImport');
    await importGraphExportData(shared, 'shared');
    if (generation !== applyGeneration) return 'none';

    lastOpenedFragment = fragment;
    if (typeof window !== 'undefined' && loc === undefined) {
      normalizeShareLocation(fragment);
    }
    useUiStore
      .getState()
      .pushToast('Opened a shared graph — document contents remain on the owner’s device.', 'info');
    return 'opened';
  } catch (error) {
    if (generation !== applyGeneration) return 'none';
    lastOpenedFragment = fragment;
    useCorpusStore.getState().setEphemeral('Invalid shared graph', 'shared');
    useUiStore
      .getState()
      .pushToast(
        error instanceof Error ? error.message : 'This shared graph link is invalid.',
      );
    return 'invalid';
  }
}

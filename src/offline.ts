/**
 * Runtime Offline mode: a user-flippable, BEHAVIORAL counterpart to the
 * build-time airgap guarantee. isOffline() is true in airgap builds always,
 * and in normal builds when the Settings toggle is on. JS-level enforcement
 * only — the CSP-sealed `build:airgap` remains the security guarantee.
 */
import { AIRGAP } from './airgap';
import { useSettingsStore } from './store/settingsStore';

export const OFFLINE_MESSAGE =
  'Offline mode is on — AI features are disabled (no external network).';

export function isOffline(): boolean {
  return AIRGAP || useSettingsStore.getState().offlineMode;
}

/** Extract the URL string from any fetch input shape. */
function urlOf(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}

/**
 * True when the request would leave this origin. Parses with the same WHATWG
 * URL semantics fetch itself uses (trims whitespace, resolves relative and
 * protocol-relative forms, canonicalizes scheme/host), then compares true
 * origins — a substring check is spoofable (example.com.evil.com). Unparseable
 * input fails CLOSED (treated as external).
 */
function isExternal(input: RequestInfo | URL): boolean {
  const base = typeof location !== 'undefined' ? location.href : 'http://localhost/';
  let parsed: URL;
  try {
    parsed = new URL(urlOf(input), base);
  } catch {
    return true; // fail closed
  }
  if (parsed.protocol === 'blob:' || parsed.protocol === 'data:') return false;
  const origin = typeof location !== 'undefined' ? location.origin : new URL(base).origin;
  return parsed.origin !== origin;
}

let installed = false;

/**
 * Defense-in-depth: wrap fetch so that while offline, ANY cross-origin request
 * rejects before hitting the network — covering future code paths nobody
 * remembered to gate. Installed once at app startup (main.tsx).
 */
export function installOfflineFetchGuard(): void {
  if (installed && import.meta.env.MODE !== 'test') return;
  installed = true;
  const realFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    if (isOffline() && isExternal(input)) {
      const url = urlOf(input);
      return Promise.reject(
        new TypeError(`Offline mode: external request blocked (${url})`),
      );
    }
    return realFetch(input, init);
  }) as typeof fetch;
}

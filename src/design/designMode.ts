/**
 * Design explorations behind `?design=a|b|c`. Without the parameter nothing
 * here touches the page, so the shipped Resonance UI stays the default. The
 * choice lives on <html data-design> so each exploration's stylesheet can
 * scope every rule to it.
 */
import { create } from 'zustand';

export const DESIGNS = ['a', 'b', 'c'] as const;
export type DesignId = (typeof DESIGNS)[number];
/** `current` keeps the switcher on screen while showing the shipped UI. */
export type DesignChoice = DesignId | 'current';

export const DESIGN_PARAM = 'design';

export const DESIGN_INFO: Record<DesignChoice, { label: string; name: string }> = {
  current: { label: 'Current', name: 'Current UI' },
  a: { label: 'A', name: 'Night Session' },
  b: { label: 'B', name: 'Aura' },
  c: { label: 'C', name: 'For You' },
};

/** Graph backdrop per design: the 3D void, and the 2D map's outer and inner tones. */
export interface SceneTheme { void: string; flat: string; flatInner: string }
export const SCENE_THEMES: Record<DesignId, SceneTheme> = {
  a: { void: '#070707', flat: '#121212', flatInner: '#1c2a20' },
  b: { void: '#0d0a12', flat: '#16111c', flatInner: '#2a1c2c' },
  c: { void: '#0b0618', flat: '#140b24', flatInner: '#2a1440' },
};

/** The active design, for components that render differently per design. */
export const useDesignStore = create<{ design: DesignId | null }>(() => ({ design: null }));

export const DESIGN_CHOICES: readonly DesignChoice[] = ['current', ...DESIGNS];

function isDesignId(value: string): value is DesignId {
  return (DESIGNS as readonly string[]).includes(value);
}

/** The choice named in a query string, or null when the switcher is not requested. */
export function designFromSearch(search: string): DesignChoice | null {
  const raw = new URLSearchParams(search).get(DESIGN_PARAM);
  if (raw === null) return null;
  const value = raw.trim().toLowerCase();
  return isDesignId(value) ? value : 'current';
}

/** The same query string with the design choice set, other parameters untouched. */
export function searchWithDesign(search: string, choice: DesignChoice): string {
  const params = new URLSearchParams(search);
  params.set(DESIGN_PARAM, choice);
  return `?${params.toString()}`;
}

export function applyDesign(choice: DesignChoice | null, root: HTMLElement | undefined = globalThis.document?.documentElement): void {
  const design = choice && choice !== 'current' ? choice : null;
  useDesignStore.setState({ design });
  if (!root) return;
  if (design) root.dataset.design = design;
  else delete root.dataset.design;
}

/** Applies a choice and records it in the address bar so a reload or shared link keeps it. */
export function selectDesign(choice: DesignChoice): void {
  applyDesign(choice);
  if (typeof window === 'undefined') return;
  const url = `${window.location.pathname}${searchWithDesign(window.location.search, choice)}${window.location.hash}`;
  window.history.replaceState(window.history.state, '', url);
}

export function initialDesign(): DesignChoice | null {
  return typeof window === 'undefined' ? null : designFromSearch(window.location.search);
}

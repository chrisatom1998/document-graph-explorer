/**
 * Night Session is the workspace. `data-design="a"` on the document element
 * scopes its palette, and the graph backdrop uses the same tones.
 */
export const NIGHT_SCENE = { void: '#070707', flat: '#121212', flatInner: '#1c2a20' } as const;

export function applyDesign(root: HTMLElement | undefined = globalThis.document?.documentElement): void {
  if (root) root.dataset.design = 'a';
}

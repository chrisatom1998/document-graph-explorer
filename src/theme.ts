export type Theme = 'light' | 'dark';
export const THEME_KEY = 'knowledge-nebula-theme';
export function savedTheme(): Theme {
  try { return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light'; }
  catch { return 'light'; }
}
export function applyTheme(theme: Theme) {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.workspaceTheme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#171c1b' : '#f8f6f2');
  document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', theme);
}
// Set the palette before React loads the interface, avoiding a light flash.
applyTheme(savedTheme());

import { create } from 'zustand';
import { applyTheme, savedTheme, THEME_KEY, type Theme } from '../theme';
export const useThemeStore = create<{ theme: Theme; setTheme: (theme: Theme) => void }>(set => ({
  theme: savedTheme(),
  setTheme: theme => set({ theme }),
}));
useThemeStore.subscribe(({ theme }) => {
  applyTheme(theme);
  try { localStorage.setItem(THEME_KEY, theme); } catch { /* Keep the current choice when storage is unavailable. */ }
});

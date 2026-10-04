import { useThemeStore } from '../store/themeStore';

export default function ThemeToggle({ welcome = false }: { welcome?: boolean }) {
  const { theme, setTheme } = useThemeStore();
  return <button type="button" className={`workspace-settings theme-toggle${welcome ? ' theme-toggle--welcome' : ''}`}
    aria-label="Dark mode" aria-pressed={theme === 'dark'} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M20 14.2A8.6 8.6 0 0 1 9.8 4 8.7 8.7 0 1 0 20 14.2Z" /></svg>
    <span>Dark mode</span><span className="theme-toggle-state">{theme === 'dark' ? 'On' : 'Off'}</span>
  </button>;
}

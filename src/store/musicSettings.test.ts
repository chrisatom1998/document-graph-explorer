// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { loadPersistedSettings, STORAGE_KEY } from './settingsMigration';
import { useSettingsStore } from './settingsStore';
afterEach(() => { useSettingsStore.getState().setMusicAnalysisMode('full'); localStorage.clear(); });
it('defaults absent and invalid speed settings to Full', () => {
  localStorage.clear();expect(loadPersistedSettings().musicAnalysisMode).toBe('full');
  localStorage.setItem(STORAGE_KEY,JSON.stringify({musicAnalysisMode:'invalid'}));
  expect(loadPersistedSettings().musicAnalysisMode).toBe('full');
});
it('persists an explicit Fast choice for new uploads and reanalysis', () => {
  useSettingsStore.getState().setMusicAnalysisMode('fast');
  expect(loadPersistedSettings().musicAnalysisMode).toBe('fast');
});

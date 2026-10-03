// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { loadPersistedSettings, STORAGE_KEY } from './settingsMigration';
import { useSettingsStore } from './settingsStore';

afterEach(() => { useSettingsStore.getState().setGraphClarity('high'); localStorage.removeItem(STORAGE_KEY); });
describe('graph clarity preference', () => {
  it('upgrades existing and invalid settings to High without changing other preferences', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ musicAnalysisMode: 'fast', graphClarity: 'invalid' }));
    expect(loadPersistedSettings()).toMatchObject({ graphClarity: 'high', musicAnalysisMode: 'fast' });
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ musicAnalysisMode: 'fast' }));
    expect(loadPersistedSettings().graphClarity).toBe('high');
  });
  it.each(['ultra', 'performance', 'high'] as const)('persists the %s choice', clarity => {
    useSettingsStore.getState().setGraphClarity(clarity);
    expect(loadPersistedSettings().graphClarity).toBe(clarity);
  });
});

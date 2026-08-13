import { describe, expect, it } from 'vitest';
import { useSettingsStore } from '../store/settingsStore';
import { currentOcrLanguage, currentOcrMaxPages } from './ocrOptions';

describe('ocrOptions', () => {
  it('defaults to bundled English and 20 pages', () => {
    useSettingsStore.setState({ ocrLanguage: 'eng', ocrMaxPages: 20 });
    expect(currentOcrLanguage()).toBe('eng');
    expect(currentOcrMaxPages()).toBe(20);
  });

  it('pairs a non-English pack with English as fallback', () => {
    useSettingsStore.setState({ ocrLanguage: 'spa', ocrMaxPages: 40 });
    expect(currentOcrLanguage()).toBe('spa+eng');
    expect(currentOcrMaxPages()).toBe(40);
    useSettingsStore.setState({ ocrLanguage: 'eng', ocrMaxPages: 20 });
  });
});

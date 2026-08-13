import { OCR_MAX_PAGES } from '../config';
import { useSettingsStore, type OcrLanguageId, type OcrMaxPages } from '../store/settingsStore';

/** Languages the Settings picker offers. Only `eng` is bundled under public/ocr/lang/. */
export const OCR_LANGUAGE_OPTIONS: { id: OcrLanguageId; label: string; bundled: boolean }[] = [
  { id: 'eng', label: 'English', bundled: true },
  { id: 'spa', label: 'Spanish', bundled: false },
  { id: 'fra', label: 'French', bundled: false },
  { id: 'deu', label: 'German', bundled: false },
  { id: 'por', label: 'Portuguese', bundled: false },
  { id: 'ita', label: 'Italian', bundled: false },
  { id: 'nld', label: 'Dutch', bundled: false },
  { id: 'rus', label: 'Russian', bundled: false },
  { id: 'chi_sim', label: 'Chinese (Simplified)', bundled: false },
  { id: 'jpn', label: 'Japanese', bundled: false },
];

export const OCR_PAGE_OPTIONS: OcrMaxPages[] = [10, 20, 40, 80];

export function currentOcrMaxPages(): number {
  try {
    return useSettingsStore.getState().ocrMaxPages;
  } catch {
    return OCR_MAX_PAGES;
  }
}

/**
 * Tesseract language string. Non-English picks are requested as `lang+eng`
 * so mixed-script scans still get a Latin fallback when both packs exist.
 */
export function currentOcrLanguage(): string {
  try {
    const lang = useSettingsStore.getState().ocrLanguage;
    if (lang === 'eng') return 'eng';
    return `${lang}+eng`;
  } catch {
    return 'eng';
  }
}

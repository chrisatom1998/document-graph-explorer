import { cleanFilename, type ParserResult } from '../pipeline/parsers/txt';

/** Placeholder on a new clip until analysis publishes a result or a real error. */
export const PENDING_MUSIC_ANALYSIS_WARNING =
  'Music analysis is pending. You can also add your own musical relationships.';

/** Audio is never decoded as text or described as if its sound was analyzed. */
export function parseAudio(bytes: ArrayBuffer, name: string): ParserResult {
  if (!bytes.byteLength) throw new Error('This audio file is empty.');
  assertAudioContent(bytes);
  const title = cleanFilename(name);
  return {
    title, text: title, headings: [], mdLinkTargets: [], docLinks: [],
    status: 'ok',
    warning: PENDING_MUSIC_ANALYSIS_WARNING,
  };
}

/** AppleDouble sidecars can lose their leading dot when copied or extracted. */
export function assertAudioContent(bytes: ArrayBuffer): void {
  if (bytes.byteLength >= 8) {
    const view = new DataView(bytes);
    if (view.getUint32(0) === 0x00051607 && [0x00010000, 0x00020000].includes(view.getUint32(4))) {
      throw new Error('This is a Mac metadata file, not audio. Add the original WAV from your sample pack; renaming this file will not restore the sound.');
    }
  }
}

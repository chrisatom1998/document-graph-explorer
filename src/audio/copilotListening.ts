import type { DocNode } from '../model/types';
import { getOriginal } from '../persistence/originals';
import { copilotWave, TRANSCRIPTION_RATE } from './copilotWave';

export const LISTENING_MODEL = 'gpt-audio-1.5';
export const LISTENING_SECONDS = 10;
export const MAX_LISTENING_WAVE_BYTES = 44 + LISTENING_SECONDS * TRANSCRIPTION_RATE * 2;
export const MAX_LISTENING_REQUEST_BYTES = 48_000 + 5 * (4 * Math.ceil(MAX_LISTENING_WAVE_BYTES / 3));
export interface ListeningClip { ref: string; wav: string }
export interface ListeningCoverage { ref: string; startSeconds: number; durationSeconds: number }

/** Decode only after an explicit listening request; never upload original containers or filenames. */
export async function prepareListeningClips(nodes: DocNode[], signal: AbortSignal): Promise<ListeningClip[]> {
  const clips: ListeningClip[] = [];
  const { openMusicDecoder } = await import('./decodeMusic');
  for (const [index, node] of nodes.entries()) {
    signal.throwIfAborted();
    const original = await getOriginal(node.id);
    if (!original) throw Error('Add the original audio file again before listening to it.');
    signal.throwIfAborted();
    const decoder = await openMusicDecoder(original.blob, original.name, signal);
    try {
      const samples = await decoder.read(0, LISTENING_SECONDS, TRANSCRIPTION_RATE);
      signal.throwIfAborted();
      const wav = new Uint8Array(copilotWave(samples.subarray(0, LISTENING_SECONDS * TRANSCRIPTION_RATE)));
      // Small chunks avoid exceeding the JavaScript argument/stack limit.
      let binary = '';
      for (let i = 0; i < wav.length; i += 8192) binary += String.fromCharCode(...wav.subarray(i, i + 8192));
      clips.push({ ref: `Sample ${index + 1}`, wav: btoa(binary) });
    } finally { decoder.close(); }
  }
  return clips;
}

import { DASHENG_POLICY, DASHENG_SAMPLE_RATE } from './dashengAddon';
import { TAGGER_WINDOW_SECONDS, TaggerEvidence, taggerWindowStarts, type TaggerAnalysis } from './tagger';

/** The desktop Dasheng add-on's pass over a recording: the trained tagger's own windows (taggerWindowStarts), each read
 * at 16 kHz and scored whole. All windows or nothing: a failure throws and the caller keeps the other detectors. */
export async function dashengPass(
  duration: number,
  read: (start: number, seconds: number, sampleRate: number) => Promise<Float32Array>,
  score: (samples: Float32Array) => Promise<Record<string, number>>,
  options: { signal?: AbortSignal; onProgress?: (note: string) => void } = {},
): Promise<TaggerAnalysis | undefined> {
  const evidence = new TaggerEvidence(DASHENG_POLICY);
  for (const start of taggerWindowStarts(duration)) {
    options.signal?.throwIfAborted();
    const seconds = Math.min(TAGGER_WINDOW_SECONDS, duration - start);
    options.onProgress?.(`desktop Dasheng add-on: ${Math.floor(start)}–${Math.ceil(start + seconds)}s of ${Math.ceil(duration)}s`);
    const samples = await read(start, seconds, DASHENG_SAMPLE_RATE);
    options.signal?.throwIfAborted();
    if (!samples.length || samples.length < Math.round(seconds * DASHENG_SAMPLE_RATE) - 1) throw new Error('Audio window could not be fully decoded');
    evidence.add(await score(samples), { start, end: start + seconds });
  }
  return evidence.results();
}

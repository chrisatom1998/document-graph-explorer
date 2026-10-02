import { decodeMusicExcerpts, instrumentWindows, type MusicDecoder } from './decodeMusic';
import { jamendoSuggestions } from './jamendo';
import { InstrumentEvidence } from './instrumentEvidence';
import { INSTRUMENT_ANALYSIS_REVISION, type MusicAnalysis, type MusicAnalysisMode } from './musicTypes';
import type { InstrumentPredictions } from './instrumentLabels';
import { averageDescriptions, type DescriptionScore } from './profileDescriptions';
import { combineSoundModels } from './ensemble';
import { descriptionStarts, fastInstrumentStarts } from './analysisPlan';

export interface AnalysisOptions {
  signal?: AbortSignal;
  mode?: MusicAnalysisMode;
  onProgress?: (note: string) => void;
  onPreview?: (analysis: MusicAnalysis) => void;
}
export type MusicRequest = <T>(message: Record<string, unknown>, transfer: Transferable[]) => Promise<T>;
const audible = (samples: Float32Array) => samples.length > 0 && samples.reduce((sum, v) => sum + v * v, 0) / samples.length > 1e-8;

/** Same full-scan evidence as before, with a reusable first music-model pass. */
export async function analyzeDecodedMusic(decoder: MusicDecoder, request: MusicRequest, options: AnalysisOptions): Promise<MusicAnalysis> {
  // Without a duration, sample positions cannot be trusted: discover the full recording.
  const mode = options.mode === 'fast' && decoder.durationSeconds > 0 ? 'fast' : 'full';
  const cachedMusic = new Map<number, Record<string, number>>();
  const musicAt = async (start: number, seconds: number) => {
    if (cachedMusic.has(start)) return cachedMusic.get(start)!;
    const samples = await decoder.read(start, seconds, 16000);
    const scores = audible(samples) ? await request<Record<string, number>>({ kind: 'jamendo', samples }, [samples.buffer]) : {};
    cachedMusic.set(start, scores);
    return scores;
  };
  options.signal?.throwIfAborted();
  options.onProgress?.('Preparing a quick instrument estimate');
  const first = mode === 'fast' ? descriptionStarts(decoder.durationSeconds, mode)[0] : 0;
  try {
    const duration = decoder.durationSeconds || 10;
    const scores = await musicAt(first, Math.min(10, duration - first));
    const preview: MusicAnalysis = {
      version: 2, stage: 'preview', durationSeconds: duration, analyzedSeconds: 0, notes: [],
      instruments: jamendoSuggestions(scores).map(i => ({ label: i.label, score: i.score, status: 'possible' })),
      soundProfile: combineSoundModels([], scores, [], { ast: false, jamendo: true, clap: false }),
      instrumentScan: { revision: INSTRUMENT_ANALYSIS_REVISION, mode, complete: false, analyzedSeconds: 0, windows: 0 },
    };
    options.onPreview?.(preview);
  } catch (error) {
    if (options.signal?.aborted) throw error;
    // An early estimate is optional. The regular model pass below can retry.
  }

  options.onProgress?.('Estimating tempo and key');
  const excerpts = await decodeMusicExcerpts(decoder);
  const result = await request<MusicAnalysis>({ kind: 'rhythm', excerpts }, excerpts.samples.map(s => s.buffer));
  const evidence = new InstrumentEvidence();
  let coveredEnd = 0; let analyzedSeconds = 0; let windows = 0; let complete = false;
  async function* selectedWindows() {
    if (mode === 'full') { yield* instrumentWindows(decoder); return; }
    for (const start of fastInstrumentStarts(decoder.durationSeconds)) {
      const samples = await decoder.read(start, Math.min(10, decoder.durationSeconds - start), 16000);
      if (samples.length / 16000 < Math.min(10, decoder.durationSeconds - start) - .1) throw new Error('A selected audio section could not be fully decoded.');
      yield { start, end: start + samples.length / 16000, samples };
    }
  }
  try {
    for await (const window of selectedWindows()) {
      options.signal?.throwIfAborted();
      options.onProgress?.(`${mode === 'fast' ? 'Checking sampled sections' : 'Verifying instruments'}: ${Math.floor(window.start)}–${Math.ceil(window.end)}s`);
      if (audible(window.samples)) {
        const predictions = await request<InstrumentPredictions>({ kind: 'instruments', samples: window.samples }, [window.samples.buffer]);
        evidence.add(predictions.scores, window.start, window.end, predictions.musicScore);
      }
      analyzedSeconds += Math.max(0, window.end - Math.max(coveredEnd, window.start));
      coveredEnd = Math.max(coveredEnd, window.end);
      windows++;
    }
    complete = mode === 'fast' ? windows === fastInstrumentStarts(decoder.durationSeconds).length
      : decoder.durationSeconds ? coveredEnd >= decoder.durationSeconds - 0.1 : coveredEnd < 86400;
  } catch (error) {
    if (options.signal?.aborted) throw error;
    result.notes.push(`Instrument scan stopped early: ${error instanceof Error ? error.message : 'analysis unavailable'}. Reanalyze to finish.`);
  }
  if (!decoder.durationSeconds) result.durationSeconds = Math.max(result.durationSeconds, coveredEnd);
  result.instruments = evidence.results();
  const duration = mode === 'fast' ? decoder.durationSeconds : coveredEnd || decoder.durationSeconds;
  if (duration > 0) {
    const modelComplete = { ast: complete, jamendo: true, clap: true };
    const musicScores: Record<string, number> = {};
    const descriptions: DescriptionScore[][] = [];
    const starts = descriptionStarts(duration, mode);
    options.onProgress?.('Comparing instrument models');
    try {
      for (const start of starts) {
        const scores = await musicAt(start, Math.min(10, duration - start));
        for (const [label, score] of Object.entries(scores)) musicScores[label] = (musicScores[label] ?? 0) + score / starts.length;
      }
    } catch (error) {
      if (options.signal?.aborted) throw error;
      result.notes.push('Music-trained instrument recognition was unavailable. Reanalyze to retry.'); modelComplete.jamendo = false;
    }
    options.onProgress?.('Identifying sound character and musical role');
    try {
      for (const start of starts) {
        const samples = await decoder.read(start, Math.min(10, duration - start), 48000);
        descriptions.push(audible(samples) ? await request<DescriptionScore[]>({ kind: 'profile', samples }, [samples.buffer]) : []);
      }
    } catch (error) {
      if (options.signal?.aborted) throw error;
      result.notes.push('Sound character recognition was unavailable. Reanalyze to retry.'); modelComplete.clap = false;
    }
    result.soundProfile = combineSoundModels(result.instruments, musicScores, averageDescriptions(descriptions), modelComplete);
    const suggestions = jamendoSuggestions(musicScores);
    for (const suggestion of suggestions) {
      if (!result.instruments.some(i => i.label === suggestion.label)) result.instruments.push({ label: suggestion.label, score: suggestion.score, status: 'possible' });
    }
    const source = result.soundProfile.source;
    const estimate = source && (source.basis === 'AudioSet AST' ? result.instruments.find(i => i.label === source.label) : suggestions.find(i => i.label === source.label));
    if (source && estimate) result.instrumentPrediction = { label: source.label, score: estimate.score, margin: 'margin' in estimate ? estimate.margin : 0, model: 'Ensemble' };
    complete = modelComplete.ast && modelComplete.jamendo && modelComplete.clap;
  }
  result.instrumentScan = { revision: INSTRUMENT_ANALYSIS_REVISION, mode, complete, analyzedSeconds: Math.min(result.durationSeconds, analyzedSeconds), windows };
  if (!result.instruments.length && !result.soundProfile?.voice) result.notes.push('No instruments identified confidently. This does not mean the recording contains none.');
  return result;
}

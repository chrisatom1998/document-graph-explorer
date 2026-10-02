import Essentia from 'essentia.js/dist/essentia.js-core.es.js';
import { EssentiaWASM } from 'essentia.js/dist/essentia-wasm.es.js';
import { instrumentScores, musicScore } from './instrumentLabels';
import { INSTRUMENT_ANALYSIS_REVISION, KEY_ANALYSIS_REVISION, KEY_NAMES, TEMPO_ANALYSIS_REVISION, type MusicAnalysis } from './musicTypes';
import { classifyJamendo } from './jamendo';
import { detectRepeatedPitch } from './detectedPitch';
import { estimateTempo } from './tempo';
import { soundSuggestions } from './soundSuggestions';
import { descriptionScores, type DescriptionPrompt } from './profileDescriptions';
import type { MusicExcerpts } from './decodeMusic';
import type { AutoModelForAudioClassification, AutoProcessor } from '@huggingface/transformers';

declare const self: DedicatedWorkerGlobalScope;
const ready = new Promise<void>(resolve => {
  if (EssentiaWASM.calledRun) resolve(); else EssentiaWASM.onRuntimeInitialized = resolve;
});
let classifier: Promise<{ model: Awaited<ReturnType<typeof AutoModelForAudioClassification.from_pretrained>>; processor: Awaited<ReturnType<typeof AutoProcessor.from_pretrained>> }> | null = null;
function getClassifier() {
  return classifier ??= (async () => {
    const { env, AutoProcessor, AutoModelForAudioClassification } = await import('@huggingface/transformers');
    env.allowRemoteModels = false; env.allowLocalModels = true;
    env.localModelPath = import.meta.env.BASE_URL;
    if (env.backends.onnx.wasm) { env.backends.onnx.wasm.wasmPaths = undefined; env.backends.onnx.wasm.numThreads = 1; }
    const model = await AutoModelForAudioClassification.from_pretrained('music-model', { dtype: 'q8', device: 'wasm', local_files_only: true });
    const processor = await AutoProcessor.from_pretrained('music-model', { local_files_only: true });
    return { model, processor };
  })().catch(error => { classifier = null; throw error; });
}
let soundClassifier: Promise<{
  model: Awaited<ReturnType<typeof import('@huggingface/transformers')['ClapAudioModelWithProjection']['from_pretrained']>>;
  processor: Awaited<ReturnType<typeof AutoProcessor.from_pretrained>>;
  prompts: DescriptionPrompt[];
}> | null = null;
function getSoundClassifier() {
  return soundClassifier ??= (async () => {
    const { env, AutoProcessor, ClapAudioModelWithProjection } = await import('@huggingface/transformers');
    env.allowRemoteModels = false; env.allowLocalModels = true; env.localModelPath = import.meta.env.BASE_URL;
    if (env.backends.onnx.wasm) { env.backends.onnx.wasm.wasmPaths = undefined; env.backends.onnx.wasm.numThreads = 1; }
    // Isolate this generation from the previously cached, smaller CLAP model.
    // Requests in this worker are serialized, so restore the default for AST.
    const previousCache = env.cacheKey;
    env.cacheKey = 'dge-clap-music-and-speech-e9fd5ac1';
    let model; let processor;
    try {
      model = await ClapAudioModelWithProjection.from_pretrained('sound-model', { dtype: 'q8', device: 'wasm', local_files_only: true });
      processor = await AutoProcessor.from_pretrained('sound-model', { local_files_only: true });
    } finally { env.cacheKey = previousCache; }
    const response = await fetch(`${import.meta.env.BASE_URL}sound-model/prompts.json?v=${INSTRUMENT_ANALYSIS_REVISION}`);
    if (!response.ok) throw new Error('Sound descriptions could not be loaded.');
    return { model, processor, prompts: await response.json() as DescriptionPrompt[] };
  })().catch(error => { soundClassifier = null; throw error; });
}
const TONICS: Record<string, number> = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
function hasPitchDiversity(engine: Essentia, samples: Float32Array): boolean {
  const bins = new Float32Array(12);
  for (let i = 0; i < 12 && samples.length >= 4096; i++) {
    const start = Math.floor((samples.length - 4096) * i / 12);
    const frame = engine.arrayToVector(samples.slice(start, start + 4096));
    const windowed = engine.Windowing(frame).frame;
    const spectrum = engine.Spectrum(windowed).spectrum;
    const peaks = engine.SpectralPeaks(spectrum);
    const hpcp = engine.HPCP(peaks.frequencies, peaks.magnitudes).hpcp;
    const values = engine.vectorToArray(hpcp);
    for (let j = 0; j < 12; j++) bins[j] += values[j];
    for (const vector of [frame, windowed, spectrum, peaks.frequencies, peaks.magnitudes, hpcp]) vector.delete();
  }
  const ranked = [...bins].sort((a,b) => b-a);
  return ranked[0] > 0 && ranked[2] > ranked[0] * 0.18;
}
async function disposeTensors(values: Record<string, unknown>): Promise<void> {
  for (const tensor of Object.values(values)) {
    if (tensor && typeof tensor === 'object' && 'dispose' in tensor && typeof tensor.dispose === 'function') await tensor.dispose();
  }
}
self.onmessage = async ({ data }: MessageEvent<{ id: number; kind: 'rhythm'; excerpts: MusicExcerpts } | { id: number; kind: 'instruments'; samples: Float32Array } | { id: number; kind: 'sound'; samples: Float32Array } | { id: number; kind: 'jamendo'; samples: Float32Array } | { id: number; kind: 'profile'; samples: Float32Array }>) => {
  const { id } = data;
  let engine: Essentia | undefined;
  try {
    if (data.kind === 'jamendo') {
      await ready; engine = new Essentia(EssentiaWASM);
      self.postMessage({ id, result: await classifyJamendo(engine, data.samples) });
      return;
    }
    if (data.kind === 'sound' || data.kind === 'profile') {
      const { model, processor, prompts } = await getSoundClassifier();
      const inputs = await processor(data.samples);
      try {
        const output = await model(inputs);
        try { self.postMessage({ id, result: data.kind === 'profile' ? descriptionScores(output.audio_embeds.data, prompts) : soundSuggestions(output.audio_embeds.data, prompts.filter(p => p.group === 'source')) }); }
        finally { await disposeTensors(output); }
      } finally { await disposeTensors(inputs); }
      return;
    }
    if (data.kind === 'instruments') {
      const { model, processor } = await getClassifier();
      const inputs = await processor(data.samples);
      try {
        const output = await model(inputs);
        try {
          const labels = (model.config as unknown as { id2label: Record<string, string> }).id2label;
          self.postMessage({ id, result: { scores: instrumentScores(output.logits.data, labels), musicScore: musicScore(output.logits.data, labels) } });
        } finally { await disposeTensors(output); }
      } finally { await disposeTensors(inputs); }
      return;
    }
    const { excerpts } = data;
    await ready;
    engine = new Essentia(EssentiaWASM);
    const result: MusicAnalysis = { version: 2, keyRevision: KEY_ANALYSIS_REVISION, tempoRevision: TEMPO_ANALYSIS_REVISION, analyzedSeconds: excerpts.samples.reduce((s,v)=>s+v.length/44100,0), durationSeconds: excerpts.durationSeconds, instruments: [], notes: [] };
    const tempos: NonNullable<MusicAnalysis['tempo']>[] = [];
    const keys: NonNullable<MusicAnalysis['key']>[] = [];
    const pitches: NonNullable<MusicAnalysis['detectedPitch']>[] = [];
    const audible = excerpts.samples.filter(s => s.reduce((sum,v)=>sum+v*v,0) / s.length > 1e-8);
    self.postMessage({ id, progress: 'Estimating tempo and key' });
    for (const samples of audible) {
      const vector = engine.arrayToVector(samples);
      try {
        const tempo = estimateTempo(engine, samples);
        if (tempo) tempos.push(tempo);
        let repeatedPitch: MusicAnalysis['detectedPitch'];
        if (samples.length < 8 * 44100) {
          try { repeatedPitch = detectRepeatedPitch(engine, samples); }
          catch { /* A missing pitch hint must not prevent full-key estimation. */ }
          if (repeatedPitch) pitches.push(repeatedPitch);
        }
        // Harmonics of a single short note can resemble a major/minor profile.
        // Strong fundamental agreement is evidence for a pitch, not a mode.
        const singlePitch = repeatedPitch && repeatedPitch.confidence >= 0.9;
        if (!singlePitch && samples.length >= 3*44100 && hasPitchDiversity(engine, samples)) {
          const key = engine.KeyExtractor(vector);
          if (TONICS[key.key] !== undefined && (key.scale === 'major' || key.scale === 'minor') && key.strength >= 0.6) keys.push({ tonic: TONICS[key.key], mode: key.scale, strength: Math.min(1,key.strength) });
        }
      } finally { vector.delete(); }
    }
    if (tempos.length) {
      tempos.sort((a,b)=>a.bpm-b.bpm);const median = tempos[Math.floor(tempos.length/2)];
      const consistent = tempos.filter(t=>Math.abs(t.bpm-median.bpm)<=Math.max(3,median.bpm*0.04));
      if (consistent.length >= Math.ceil(excerpts.samples.length/2)) result.tempo = { ...median, bpm: Math.round(median.bpm*10)/10, confidence: Math.min(...consistent.map(t=>t.confidence)) };
    }
    for (const key of keys) {
      const same = keys.filter(k=>k.tonic===key.tonic&&k.mode===key.mode);
      if (same.length >= Math.ceil(excerpts.samples.length/2)) { result.key = { ...key, strength: Math.min(...same.map(k=>k.strength)) }; break; }
    }
    if (!result.tempo) result.notes.push('No steady tempo detected confidently (too few beats, free rhythm, or tempo changes).');
    if (!result.key) {
      for (const samples of audible.filter(s => s.length >= 8 * 44100)) {
        try { const pitch = detectRepeatedPitch(engine, samples); if (pitch) pitches.push(pitch); }
        catch { /* A pitch hint must not interrupt the remaining audio analysis. */ }
      }
      for (const pitch of pitches) {
        const same = pitches.filter(p => p.pitchClass === pitch.pitchClass);
        if (same.length >= Math.ceil(excerpts.samples.length / 2)) {
          result.detectedPitch = { pitchClass: pitch.pitchClass, confidence: Math.min(...same.map(p => p.confidence)) };
          break;
        }
      }
      result.notes.push(result.detectedPitch
        ? `Repeated ${KEY_NAMES[result.detectedPitch.pitchClass]} pitch detected from the audio; there is insufficient evidence for a full major/minor key.`
        : 'No stable major/minor key detected confidently.');
    }
    self.postMessage({ id, result });
  } catch (error) { self.postMessage({ id, error: error instanceof Error ? error.message : String(error) }); }
  finally { engine?.delete(); }
};

import { musicInferenceThreads, musicRuntimeDiagnostics, musicRuntimeIdentity } from './musicRuntime';
import soundManifest from '../../public/sound-model/manifest.json';
import { learnedDjScores, sanitizeLearnedDjModel, type LearnedDjModel } from './learnedDjModel';
import { sanitizeShortClipModel, shortClipScores, type ShortClipModel } from './shortClipModel';
import { eventFeatures } from './eventFeatures';
import { cachedAudioInference, isAudioEmbedding, isScoreMap } from './audioInferenceCache';
import Essentia from 'essentia.js/dist/essentia.js-core.es.js';
import { EssentiaWASM } from 'essentia.js/dist/essentia-wasm.es.js';
import { instrumentScores, musicScore, type InstrumentPredictions } from './instrumentLabels';
import { INSTRUMENT_ANALYSIS_REVISION, KEY_ANALYSIS_REVISION, KEY_NAMES, TEMPO_ANALYSIS_REVISION, type MusicAnalysis } from './musicTypes';
import { classifyJamendo, preloadJamendo } from './jamendo';
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
    if (env.backends.onnx.wasm) { env.backends.onnx.wasm.wasmPaths = undefined; env.backends.onnx.wasm.numThreads = musicInferenceThreads(); }
    const model = await AutoModelForAudioClassification.from_pretrained('music-model', { dtype: 'q8', device: 'wasm', local_files_only: true });
    const processor = await AutoProcessor.from_pretrained('music-model', { local_files_only: true });
    return { model, processor };
  })().catch(error => { classifier = null; throw error; });
}
const CLAP_ENCODER = 'Xenova/larger_clap_music_and_speech@e9fd5ac1dbf3280936a7fc3ec8a020453ff184db';
let soundClassifier: Promise<{
  model: Awaited<ReturnType<typeof import('@huggingface/transformers')['ClapAudioModelWithProjection']['from_pretrained']>>;
  processor: Awaited<ReturnType<typeof AutoProcessor.from_pretrained>>;
}> | null = null;
function getSoundClassifier() {
  return soundClassifier ??= (async () => {
    const { env, AutoProcessor, ClapAudioModelWithProjection } = await import('@huggingface/transformers');
    env.allowRemoteModels = false; env.allowLocalModels = true; env.localModelPath = import.meta.env.BASE_URL;
    if (env.backends.onnx.wasm) { env.backends.onnx.wasm.wasmPaths = undefined; env.backends.onnx.wasm.numThreads = musicInferenceThreads(); }
    // Isolate this generation from the previously cached, smaller CLAP model.
    // Requests in this worker are serialized, so restore the default for AST.
    const previousCache = env.cacheKey;
    env.cacheKey = 'dge-clap-music-and-speech-e9fd5ac1';
    let model; let processor;
    try {
      model = await ClapAudioModelWithProjection.from_pretrained('sound-model', { dtype: 'q8', device: 'wasm', local_files_only: true });
      processor = await AutoProcessor.from_pretrained('sound-model', { local_files_only: true });
    } finally { env.cacheKey = previousCache; }
    return { model, processor };
  })().catch(error => { soundClassifier = null; throw error; });
}
let soundDescriptions: Promise<{ prompts: DescriptionPrompt[]; learned?: LearnedDjModel; shortClip?: ShortClipModel }> | null = null;
/** Optional pinned asset: a missing, altered or malformed file leaves short clips on the existing analysis. */
async function pinnedJson(name: string): Promise<unknown> {
  const pinned = (soundManifest.sha256 as Record<string,string>)[name];
  if (!pinned) return;
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}sound-model/${name}?v=${INSTRUMENT_ANALYSIS_REVISION}`, {cache:'no-store'});
    if (!response.ok) return;
    const bytes = await response.arrayBuffer();
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
    return hash === pinned ? JSON.parse(new TextDecoder().decode(bytes)) : undefined;
  } catch { return; }
}
function getSoundDescriptions() {
  return soundDescriptions ??= (async () => {
    const response = await fetch(`${import.meta.env.BASE_URL}sound-model/prompts.json?v=${INSTRUMENT_ANALYSIS_REVISION}`);
    if (!response.ok) throw new Error('Sound descriptions could not be loaded.');
    let learned: LearnedDjModel | undefined;
    // A locally trained model is opt-in and must be pinned in the manifest.
    // Public builds do not ship private or assistant-generated review data.
    const learnedHash = (soundManifest.sha256 as Record<string,string>)['learned.json'];
    if (learnedHash) {
      try {
        const learnedResponse = await fetch(`${import.meta.env.BASE_URL}sound-model/learned.json?v=${INSTRUMENT_ANALYSIS_REVISION}`, {cache:'no-store'});
        if (learnedResponse.ok) {
          const bytes = await learnedResponse.arrayBuffer();
          const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
          if (hash === learnedHash) learned = sanitizeLearnedDjModel(JSON.parse(new TextDecoder().decode(bytes)));
        }
      } catch { /* Optional local model must not prevent pinned model inference. */ }
    }
    if (learned && learned.encoder !== CLAP_ENCODER) learned = undefined;
    let shortClip = sanitizeShortClipModel(await pinnedJson('short-clip.json'));
    if (shortClip && shortClip.clapEncoder !== CLAP_ENCODER) shortClip = undefined;
    return { prompts: await response.json() as DescriptionPrompt[], learned, shortClip };
  })().catch(error => { soundDescriptions = null; throw error; });
}
function isInstrumentPredictions(value: unknown): value is InstrumentPredictions {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<InstrumentPredictions>;
  return isScoreMap(candidate.scores) && typeof candidate.musicScore === 'number' && Number.isFinite(candidate.musicScore) && candidate.musicScore >= 0 && candidate.musicScore <= 1;
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
const isLogits = (v: unknown): v is number[] => Array.isArray(v) && v.length === 527 && v.every(x => typeof x === 'number' && Number.isFinite(x));
/** One-shot features exactly as scripts/short-clip-features.mjs computes them: CLAP with silence after the clip
 * (never looped), all AudioSet AST logits on the unchanged clip, and attack/body/decay features. */
async function shortClipProfile(model: ShortClipModel, samples48: Float32Array, samples16: Float32Array, embedding: number[]) {
  const inputs: Parameters<typeof shortClipScores>[1] = { clapRepeat: embedding };
  if (model.blocks.includes('event')) inputs.event = eventFeatures(samples16);
  if (!inputs.event && model.blocks.includes('event')) return [];
  if (model.blocks.includes('clapZero')) inputs.clapZero = await cachedAudioInference('sound-model', `clap-48khz-silence-pad:${musicRuntimeIdentity('clap')}`, samples48, isAudioEmbedding, async () => {
    const { model: clap, processor } = await getSoundClassifier();
    const extractor = (processor as unknown as { feature_extractor: { config: { padding: string } } }).feature_extractor;
    const previous = extractor.config.padding;
    extractor.config.padding = 'pad';
    try {
      const features = await processor(samples48);
      try { const output = await clap(features); try { return Array.from(output.audio_embeds.data) as number[]; } finally { await disposeTensors(output); } }
      finally { await disposeTensors(features); }
    } finally { extractor.config.padding = previous; }
  });
  if (model.blocks.includes('ast')) inputs.ast = await cachedAudioInference('music-model', `ast-16khz-logits:${musicRuntimeIdentity('ast')}`, samples16, isLogits, async () => {
    const { model: ast, processor } = await getClassifier();
    const features = await processor(samples16);
    try { const output = await ast(features); try { return Array.from(output.logits.data) as number[]; } finally { await disposeTensors(output); } }
    finally { await disposeTensors(features); }
  });
  return shortClipScores(model, inputs).scores;
}
/** Load one family's weights ahead of its first clip. Scores are unaffected: the same memoized sessions serve later requests. */
async function warmFamily(family: string): Promise<void> {
  if (family === 'instruments') await getClassifier();
  else if (family === 'profile' || family === 'sound') await Promise.all([getSoundDescriptions(), getSoundClassifier()]);
  else if (family === 'jamendo') await Promise.all([ready, preloadJamendo()]);
  else await ready;
}
self.onmessage = async ({ data }: MessageEvent<{ id: number; kind: 'warm'; family: string } | { id: number; kind: 'rhythm' | 'tonal'; excerpts: MusicExcerpts } | { id: number; kind: 'instruments'; samples: Float32Array } | { id: number; kind: 'sound'; samples: Float32Array } | { id: number; kind: 'jamendo'; samples: Float32Array } | { id: number; kind: 'profile'; samples: Float32Array; samples16?: Float32Array }>) => {
  const { id } = data;
  if (data.kind === 'warm') {
    try { await warmFamily(data.family); self.postMessage({ id, warmed: true }); }
    catch (error) { self.postMessage({ id, error: error instanceof Error ? error.message : String(error) }); }
    return;
  }
  const runtime = data.kind === 'rhythm' || data.kind === 'tonal'
    ? { backend: 'essentia-wasm', configuredInferenceThreads: 1, identity: 'essentia-wasm-v1' }
    : musicRuntimeDiagnostics(data.kind);
  let inferenceExecuted = false;
  const postResult = async (result: unknown) => {
    const effectiveInferenceThreads = inferenceExecuted
      ? data.kind === 'jamendo' ? 1 : (await import('@huggingface/transformers')).env.backends.onnx.wasm?.numThreads
      : undefined;
    self.postMessage({ id, runtime: { ...runtime, inferenceExecuted, ...(effectiveInferenceThreads ? { effectiveInferenceThreads } : {}) }, result });
  };
  let engine: Essentia | undefined;
  try {
    if (data.kind === 'jamendo') {
      const result = await cachedAudioInference('jamendo-model', `jamendo-16khz:${musicRuntimeIdentity('jamendo')}`, data.samples, isScoreMap, async () => {
        await ready; engine = new Essentia(EssentiaWASM);
        const result = await classifyJamendo(engine, data.samples); inferenceExecuted = true; return result;
      }, () => self.postMessage({ id, progress: 'Reusing saved instrument features' }));
      await postResult(result);
      return;
    }
    if (data.kind === 'sound' || data.kind === 'profile') {
      const { prompts, learned, shortClip } = await getSoundDescriptions();
      const embedding = await cachedAudioInference('sound-model', `clap-48khz:${musicRuntimeIdentity('clap')}`, data.samples, isAudioEmbedding, async () => {
        const { model, processor } = await getSoundClassifier();
        const inputs = await processor(data.samples);
        try {
          const output = await model(inputs); inferenceExecuted = true;
          try { return Array.from(output.audio_embeds.data) as number[]; }
          finally { await disposeTensors(output); }
        } finally { await disposeTensors(inputs); }
      }, () => self.postMessage({ id, progress: 'Applying current reviews to saved sound features' }));
      if (data.kind !== 'profile') { await postResult(soundSuggestions(embedding, prompts.filter(p => p.group === 'source'))); return; }
      let learnedScores = learned ? learnedDjScores(embedding, learned) : [];
      // A whole short clip arrives with its 16 kHz copy: score it with heads trained on one-shots.
      const short = data.samples16 && shortClip && data.samples.length <= shortClip.maxSeconds * 48000 ? shortClip : undefined;
      const oneShot = short ? await shortClipProfile(short, data.samples, data.samples16!, embedding) : [];
      if (short) {
        // Heads trained on longer audio were never validated on one-shots (several misfired, e.g. loop tags):
        // only the one-shot heads tag these clips. The user's own reviewed examples still apply.
        learnedScores = learnedScores.filter(s => s.basis !== 'head');
      }
      await postResult([...descriptionScores(embedding, prompts), ...learnedScores, ...oneShot]);
      return;
    }
    if (data.kind === 'instruments') {
      const result = await cachedAudioInference('music-model', `ast-16khz:${musicRuntimeIdentity('ast')}`, data.samples, isInstrumentPredictions, async () => {
        const { model, processor } = await getClassifier();
        const inputs = await processor(data.samples);
        try {
          const output = await model(inputs); inferenceExecuted = true;
          try {
            const labels = (model.config as unknown as { id2label: Record<string, string> }).id2label;
            return { scores: instrumentScores(output.logits.data, labels), musicScore: musicScore(output.logits.data, labels) };
          } finally { await disposeTensors(output); }
        } finally { await disposeTensors(inputs); }
      }, () => self.postMessage({ id, progress: 'Reusing saved instrument features' }));
      await postResult(result);
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
        const tempo = data.kind === 'rhythm' ? estimateTempo(engine, samples) : undefined;
        if (tempo) tempos.push(tempo);
        if (data.kind === 'rhythm') continue;
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
    if (data.kind === 'rhythm' && !result.tempo) result.notes.push('No steady tempo detected confidently (too few beats, free rhythm, or tempo changes).');
    if (data.kind === 'tonal' && !result.key) {
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
    self.postMessage({ id, runtime, result });
  } catch (error) { self.postMessage({ id, error: error instanceof Error ? error.message : String(error) }); }
  finally { engine?.delete(); }
};

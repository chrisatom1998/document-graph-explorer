import { musicInferenceThreads, musicRuntimeDiagnostics, musicRuntimeIdentity, THREADED_RUNTIME_STALLED, switchToSingleThreadRuntime } from './musicRuntime';
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
import { combineKeys, excerptKey } from './key';
import { combineTempo, predictCnnTempo } from './tempoCnn';
import { soundSuggestions } from './soundSuggestions';
import { descriptionScores, type DescriptionPrompt } from './profileDescriptions';
import type { MusicExcerpts } from './decodeMusic';
import type { AutoModelForAudioClassification, AutoProcessor } from '@huggingface/transformers';

declare const self: DedicatedWorkerGlobalScope;
const ready = new Promise<void>(resolve => {
  if (EssentiaWASM.calledRun) resolve(); else EssentiaWASM.onRuntimeInitialized = resolve;
});
/** Model loads with several threads must start within 20 s of the weights arriving (a cached load takes about
 * a second); otherwise the runtime is stuck and the main thread retries on a fresh single-thread worker. */
const THREADED_START_LIMIT_MS = 20_000;
async function loadModel<T>(load: (progress_callback?: (p: { status?: string; file?: string }) => void) => Promise<T>): Promise<T> {
  if (musicInferenceThreads() === 1) return load();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stall: (error: Error) => void = () => {};
  const stalled = new Promise<never>((_, reject) => { stall = reject; });
  const progress_callback = (p: { status?: string; file?: string }) => {
    if (p.status === 'done' && p.file?.endsWith('.onnx')) { clearTimeout(timer); timer = setTimeout(() => stall(new Error(THREADED_RUNTIME_STALLED)), THREADED_START_LIMIT_MS); }
  };
  try { return await Promise.race([load(progress_callback), stalled]); } finally { clearTimeout(timer); }
}
let classifier: Promise<{ model: Awaited<ReturnType<typeof AutoModelForAudioClassification.from_pretrained>>; processor: Awaited<ReturnType<typeof AutoProcessor.from_pretrained>> }> | null = null;
function getClassifier() {
  return classifier ??= (async () => {
    const { env, AutoProcessor, AutoModelForAudioClassification } = await import('@huggingface/transformers');
    env.allowRemoteModels = false; env.allowLocalModels = true;
    env.localModelPath = import.meta.env.BASE_URL;
    if (env.backends.onnx.wasm) { env.backends.onnx.wasm.wasmPaths = undefined; env.backends.onnx.wasm.numThreads = musicInferenceThreads(); }
    const model = await loadModel(progress_callback => AutoModelForAudioClassification.from_pretrained('music-model', { dtype: 'q8', device: 'wasm', local_files_only: true, progress_callback }));
    const processor = await AutoProcessor.from_pretrained('music-model', { local_files_only: true });
    return { model, processor };
  })().catch(error => { classifier = null; throw error; });
}
/** Full-precision AST on the graphics card: 0.4 s a window against 2-3 s for q8 WASM (measured 2026-10-05), with
 * every AudioSet probability within 0.023 of q8 and the same top five. Only requested where no validated scorer
 * reads AST scores (analyzeDecodedMusic astOnGpu); any failure falls back to q8 WASM for the rest of the session. */
let gpuClassifier: ReturnType<typeof getClassifier> | null = null;
let gpuUnavailable = false;
function getGpuClassifier() {
  return gpuClassifier ??= (async () => {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
    if (memory !== undefined && memory < 4) throw new Error('Too little memory for a second AST model');
    if (!gpu || !await gpu.requestAdapter().catch(() => null)) throw new Error('No WebGPU adapter');
    const { env, AutoProcessor, AutoModelForAudioClassification } = await import('@huggingface/transformers');
    env.allowRemoteModels = false; env.allowLocalModels = true;
    env.localModelPath = import.meta.env.BASE_URL;
    const model = await AutoModelForAudioClassification.from_pretrained('music-model', { dtype: 'fp32', device: 'webgpu', local_files_only: true });
    const processor = await AutoProcessor.from_pretrained('music-model', { local_files_only: true });
    return { model, processor };
  })();
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
      model = await loadModel(progress_callback => ClapAudioModelWithProjection.from_pretrained('sound-model', { dtype: 'q8', device: 'wasm', local_files_only: true, progress_callback }));
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
    const response = await fetch(`${import.meta.env.BASE_URL}sound-model/${name}?v=${INSTRUMENT_ANALYSIS_REVISION}`, {cache:'no-cache'});
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
        const learnedResponse = await fetch(`${import.meta.env.BASE_URL}sound-model/learned.json?v=${INSTRUMENT_ANALYSIS_REVISION}`, {cache:'no-cache'});
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
async function warmFamily(family: string, mode?: string): Promise<void> {
  // Quick analyses use the GPU model, so warming it keeps its ~6 s load off the first file. Full analyses only use it
  // for clips up to 2.048 s; there it loads on the first such clip instead of holding 347 MB for long recordings.
  if (family === 'instruments') { await getClassifier(); if (mode !== 'full') await getGpuClassifier().catch(() => { gpuUnavailable = true; }); }
  else if (family === 'profile' || family === 'sound') await Promise.all([getSoundDescriptions(), getSoundClassifier()]);
  else if (family === 'jamendo') await Promise.all([ready, preloadJamendo()]);
  else await ready;
}
self.onmessage = async ({ data }: MessageEvent<{ id: number; kind: 'warm'; family: string } | { id: number; kind: 'rhythm' | 'tonal'; excerpts: MusicExcerpts } | { id: number; kind: 'instruments'; samples: Float32Array } | { id: number; kind: 'sound'; samples: Float32Array } | { id: number; kind: 'jamendo'; samples: Float32Array } | { id: number; kind: 'profile'; samples: Float32Array; samples16?: Float32Array }>) => {
  const { id } = data;
  // The main thread decided this browser needs the single-thread runtime (see THREADED_RUNTIME_STALLED).
  if ((data as { singleThread?: boolean }).singleThread) switchToSingleThreadRuntime(false);
  if (data.kind === 'warm') {
    try { await warmFamily(data.family, (data as { mode?: string }).mode); self.postMessage({ id, warmed: true }); }
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
      await postResult([...descriptionScores(embedding, prompts), ...learnedScores, ...oneShot, { group: 'embedding', label: null, score: 0, embedding: embedding.map(v => Math.round(v * 1e4) / 1e4) }]);
      return;
    }
    if (data.kind === 'instruments') {
      // Settle the device before choosing the cache identity, so a WASM result is never saved as a GPU result.
      let gpuModel: Awaited<ReturnType<typeof getClassifier>> | undefined;
      if ((data as { gpu?: boolean }).gpu === true && !gpuUnavailable) try { gpuModel = await getGpuClassifier(); } catch { gpuUnavailable = true; }
      const infer = (load: () => ReturnType<typeof getClassifier>) => async () => {
        const { model, processor } = await load();
        const inputs = await processor(data.samples);
        try {
          const output = await model(inputs); inferenceExecuted = true;
          try {
            const labels = (model.config as unknown as { id2label: Record<string, string> }).id2label;
            return { scores: instrumentScores(output.logits.data, labels), musicScore: musicScore(output.logits.data, labels) };
          } finally { await disposeTensors(output); }
        } finally { await disposeTensors(inputs); }
      };
      const reuse = () => self.postMessage({ id, progress: 'Reusing saved instrument features' });
      let result: InstrumentPredictions | undefined;
      if (gpuModel) {
        const loaded = gpuModel;
        try {
          result = await cachedAudioInference('music-model', 'ast-16khz:webgpu-fp32-v1', data.samples, isInstrumentPredictions, infer(async () => loaded), reuse);
          Object.assign(runtime, { backend: 'webgpu', identity: 'webgpu-fp32-v1' });
        } catch {
          // A session that loaded can still fail at run time (device loss, out of memory): drop it and redo this window on WASM.
          gpuUnavailable = true; gpuClassifier = null;
        }
      }
      result ??= await cachedAudioInference('music-model', `ast-16khz:${musicRuntimeIdentity('ast')}`, data.samples, isInstrumentPredictions, infer(getClassifier), reuse);
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
      const tempo = data.kind === 'rhythm' ? estimateTempo(engine, samples) : undefined;
      if (tempo) tempos.push(tempo);
      if (data.kind === 'rhythm') continue;
      let repeatedPitch: MusicAnalysis['detectedPitch'];
      if (samples.length < 8 * 44100) {
        try { repeatedPitch = detectRepeatedPitch(engine, samples); }
        catch { /* A missing pitch hint must not prevent full-key estimation. */ }
        if (repeatedPitch) pitches.push(repeatedPitch);
      }
      const key = excerptKey(engine, samples, repeatedPitch);
      if (key) keys.push(key);
    }
    if (tempos.length) {
      tempos.sort((a,b)=>a.bpm-b.bpm);const median = tempos[Math.floor(tempos.length/2)];
      const consistent = tempos.filter(t=>Math.abs(t.bpm-median.bpm)<=Math.max(3,median.bpm*0.04));
      if (consistent.length >= Math.ceil(excerpts.samples.length/2)) result.tempo = { ...median, bpm: Math.round(median.bpm*10)/10, confidence: Math.min(...consistent.map(t=>t.confidence)) };
    }
    // A learned tempo model overrides the beat tracker only when it confidently reads a different tempo. Recordings under
    // 8 s keep the loop estimator's tempo and alternatives.
    if (result.tempo && !result.tempo.alternatives) {
      try {
        const cnn = await predictCnnTempo(audible);
        if (cnn) { const bpm = combineTempo(result.tempo.bpm, cnn); if (bpm !== result.tempo.bpm) result.tempo = { ...result.tempo, bpm }; }
      } catch { /* Keep the beat tracker's tempo if the model is unavailable. */ }
    }
    const key = combineKeys(keys, excerpts.samples.length);
    if (key) result.key = key;
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

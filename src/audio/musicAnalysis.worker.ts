import { loadPinnedSoundAsset } from './pinnedSoundAsset';
import { musicInferenceThreads, musicRuntimeDiagnostics, musicRuntimeIdentity, THREADED_RUNTIME_STALLED, switchToSingleThreadRuntime } from './musicRuntime';
import soundManifest from '../../public/sound-model/manifest.json';
import { learnedDjScores, sanitizeLearnedDjModel, type LearnedDjModel } from './learnedDjModel';
import { sanitizeShortClipModel, shortClipScores, type ShortClipModel } from './shortClipModel';
import { eventFeatures } from './eventFeatures';
import { cachedAudioInference, isAudioEmbedding, isScoreMap } from './audioInferenceCache';
import Essentia from 'essentia.js/dist/essentia.js-core.es.js';
import { EssentiaWASM } from 'essentia.js/dist/essentia-wasm.es.js';
import { instrumentScores, musicScore, type InstrumentPredictions } from './instrumentLabels';
import { KEY_ANALYSIS_REVISION, KEY_NAMES, TEMPO_ANALYSIS_REVISION, type MusicAnalysis } from './musicTypes';
import { classifyJamendo, preloadJamendo } from './jamendo';
import { classifyTagger, preloadTagger } from './taggerInference';
import { isTaggerScores } from './tagger';
import { GENRE_ENERGY_VERSION } from './genreEnergy';
import { detectRepeatedPitch } from './detectedPitch';
import { estimateTempo } from './tempo';
import { essentiaKey, excerptChroma, recordingKey } from './key';
import { keyProbabilities, profileWeight, recordingKeyFromProbabilities } from './keyCnn';
import { combineLoopTempo, combineTempo, predictCnnTempo } from './tempoCnn';
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
 * every AudioSet probability within 0.023 of q8 and the same top five. Requested for every analysis, including the
 * trained source classifier's inputs (held-out gate on fp32 AST, see docs/audio-runtime-performance.md); any failure
 * falls back to q8 WASM for the rest of the session. */
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
function getSoundDescriptions() {
  return soundDescriptions ??= (async () => {
    const hashes = soundManifest.sha256 as Record<string, string>;
    const [rawPrompts, rawLearned, rawShort] = await Promise.all([
      loadPinnedSoundAsset('prompts.json', hashes['prompts.json']),
      loadPinnedSoundAsset('learned.json', hashes['learned.json']),
      loadPinnedSoundAsset('short-clip.json', hashes['short-clip.json']),
    ]);
    const learned = sanitizeLearnedDjModel(rawLearned);
    const shortClip = sanitizeShortClipModel(rawShort);
    if (!Array.isArray(rawPrompts)) throw new Error('Sound descriptions are invalid.');
    if (hashes['learned.json'] && (!learned || learned.encoder !== CLAP_ENCODER)) throw new Error('Trained sound model is invalid.');
    if (hashes['short-clip.json'] && (!shortClip || shortClip.clapEncoder !== CLAP_ENCODER)) throw new Error('One-shot sound model is invalid.');
    return { prompts: rawPrompts as DescriptionPrompt[], learned, shortClip };
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
async function warmFamily(family: string): Promise<void> {
  // AST runs on the GPU model where WebGPU works, so warming it keeps its ~6 s load off the first file. The q8 WASM
  // model then loads only if the GPU fails (or for short-clip heads), instead of holding both in memory.
  if (family === 'instruments') { if (gpuUnavailable || !await getGpuClassifier().then(() => true, () => false)) { gpuUnavailable = true; await getClassifier(); } }
  else if (family === 'profile' || family === 'sound') await Promise.all([getSoundDescriptions(), getSoundClassifier()]);
  else if (family === 'jamendo') await Promise.all([ready, preloadJamendo(), preloadTagger()]);
  else await ready;
}
self.onmessage = async ({ data }: MessageEvent<{ id: number; kind: 'warm'; family: string } | { id: number; kind: 'rhythm' | 'tonal'; excerpts: MusicExcerpts } | { id: number; kind: 'instruments'; samples: Float32Array } | { id: number; kind: 'sound'; samples: Float32Array } | { id: number; kind: 'jamendo'; samples: Float32Array } | { id: number; kind: 'tagger'; samples: Float32Array } | { id: number; kind: 'profile'; samples: Float32Array; samples16?: Float32Array }>) => {
  const { id } = data;
  // The main thread decided this browser needs the single-thread runtime (see THREADED_RUNTIME_STALLED).
  if ((data as { singleThread?: boolean }).singleThread) switchToSingleThreadRuntime(false);
  if (data.kind === 'warm') {
    try { await warmFamily(data.family); self.postMessage({ id, warmed: true }); }
    catch (error) { self.postMessage({ id, error: error instanceof Error ? error.message : String(error) }); }
    return;
  }
  const runtime = data.kind === 'rhythm' || data.kind === 'tonal'
    ? { backend: 'essentia-wasm', configuredInferenceThreads: 1, identity: 'essentia-wasm-v1' }
    : musicRuntimeDiagnostics(data.kind === 'tagger' ? 'jamendo' : data.kind);
  let inferenceExecuted = false;
  const postResult = async (result: unknown) => {
    const effectiveInferenceThreads = inferenceExecuted
      ? data.kind === 'jamendo' || data.kind === 'tagger' ? 1 : (await import('@huggingface/transformers')).env.backends.onnx.wasm?.numThreads
      : undefined;
    self.postMessage({ id, runtime: { ...runtime, inferenceExecuted, ...(effectiveInferenceThreads ? { effectiveInferenceThreads } : {}) }, result });
  };
  let engine: Essentia | undefined;
  try {
    if (data.kind === 'jamendo') {
      const result = await cachedAudioInference('jamendo-model', `jamendo-16khz:${musicRuntimeIdentity('jamendo')}:styles-energy-${GENRE_ENERGY_VERSION}`, data.samples, isScoreMap, async () => {
        await ready; engine = new Essentia(EssentiaWASM);
        const result = await classifyJamendo(engine, data.samples); inferenceExecuted = true; return result;
      }, () => self.postMessage({ id, progress: 'Reusing saved instrument features' }));
      await postResult(result);
      return;
    }
    if (data.kind === 'tagger') {
      // Runs in the Jamendo family's worker (analyzeMusic familyOf), on its single-thread runtime.
      const result = await cachedAudioInference('tagger-model', `tagger-32khz:validated-v2:${musicRuntimeIdentity('jamendo')}`, data.samples, isTaggerScores, async () => {
        const scores = await classifyTagger(data.samples); inferenceExecuted = true; return scores;
      });
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
        // only the one-shot heads, and heads also tested on one-shots, tag these clips. Reviewed examples still apply.
        const oneShotHeads = new Set(learned?.heads?.filter(h => h.oneShot).map(h => `${h.group}:${h.label}`));
        learnedScores = learnedScores.filter(s => s.basis !== 'head' || oneShotHeads.has(`${s.learnedGroup}:${s.label}`));
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
    const chromas: number[][] = [];
    const tonal: Float32Array[] = [];
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
      const chroma = excerptChroma(engine, samples, repeatedPitch);
      if (chroma) { chromas.push(chroma); tonal.push(samples); }
    }
    if (tempos.length) {
      tempos.sort((a,b)=>a.bpm-b.bpm);const median = tempos[Math.floor(tempos.length/2)];
      const consistent = tempos.filter(t=>Math.abs(t.bpm-median.bpm)<=Math.max(3,median.bpm*0.04));
      if (consistent.length >= Math.ceil(excerpts.samples.length/2)) result.tempo = { ...median, bpm: Math.round(median.bpm*10)/10, confidence: Math.min(...consistent.map(t=>t.confidence)) };
    }
    // A learned tempo model overrides the beat tracker only when it confidently reads a different tempo. On a short loop
    // (one excerpt, under 30 s) it also fills in a tempo the loop estimator could not find.
    const loop = data.kind === 'rhythm' && audible.length === 1 && excerpts.durationSeconds < 30;
    if (result.tempo || loop) {
      try {
        const cnn = await predictCnnTempo(audible);
        if (cnn) result.tempo = loop ? combineLoopTempo(result.tempo, cnn) : { ...result.tempo!, ...combineTempo(result.tempo!, cnn) };
      } catch { /* Keep the beat tracker's tempo if the model is unavailable. */ }
    }
    // The learned key network reads the same tonal excerpts; the chroma profiles stay as the fallback when it cannot load.
    let key: MusicAnalysis['key'];
    if (data.kind === 'tonal' && tonal.length) {
      try {
        const probabilities: number[][] = [], profileKeys: MusicAnalysis['key'][] = [];
        const weight = profileWeight(excerpts.durationSeconds);
        for (const samples of tonal) {
          probabilities.push(await keyProbabilities(engine, samples));
          // The stock profile only counts for short files; songs skip its extra pass.
          if (weight > 0) { try { profileKeys.push(essentiaKey(engine, samples)); } catch { profileKeys.push(undefined); } }
        }
        key = recordingKeyFromProbabilities(probabilities, excerpts.samples.length, profileKeys, weight);
      } catch {
        key = recordingKey(chromas, excerpts.samples.length);
        // Marked one revision behind so the coordinator and the analysis cache retry with the network later.
        result.keyRevision = KEY_ANALYSIS_REVISION - 1;
      }
    }
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

import { releaseForScorer, supportsFusionInput } from './fusionRelease';
import { MAX_FUSION_WINDOWS, sanitizeFusionIdentity, sanitizeFusionDecisions, unavailableFusionDecisions, type FusionScorer, type FusionWindow } from './fusion';
import { DjTagEvidence, selectDjTags } from './djTags';
import { mergeDjTags } from './djClassification';
import type { MusicDecoder } from './decodeMusic';
import { jamendoSuggestions, jamendoLabels, jamendoInstrumentScores, nsynthLabels, JamendoRecordingScores } from './jamendo';
import { InstrumentEvidence, instrumentWindowStarts } from './instrumentEvidence';
import { INSTRUMENT_ANALYSIS_REVISION, KEY_ANALYSIS_REVISION, TEMPO_ANALYSIS_REVISION, type MusicAnalysis, type MusicAnalysisMode } from './musicTypes';
import type { InstrumentPredictions } from './instrumentLabels';
import { DescriptionAccumulator, meanEmbedding, selectDescriptions, splitEmbedding, type DescriptionScore } from './profileDescriptions';
import { combineSoundModels } from './ensemble';
import { descriptionStarts, fastInstrumentStarts } from './analysisPlan';
import { detectStructure, representativeStart, StructureFeatures, STRUCTURE_MAX_SECONDS, STRUCTURE_MIN_SECONDS, STRUCTURE_RATE } from './structure';
import { SHORT_CLIP_MAX_SECONDS } from './shortClipModel';
import { EVENT_WINDOW_AFTER, EVENT_WINDOW_BEFORE, EVENT_WINDOW_LABELS, EventWindowEvidence, onsetCandidates, pickEventStarts } from './eventWindows';
import { musicRuntimeIdentity } from './musicRuntime';
import { astGpuAllowed, createRecognition, refreshRuntimeIdentity, finishJob, recordEvidence, modelCacheKey, ResultCache, type Interval, type ModelId, type EvidenceCandidate } from './recognition';

export interface AnalysisOptions {
  /** Qualification-only opt-in; callers must bind and validate the scorer. */
  fusion?: FusionScorer;
  /** Original input MIME, used only by an installed qualified-tier scorer. */
  sourceMime?: string;
  signal?: AbortSignal;
  cacheKey?: string;
  force?: boolean;
  initialPreview?: MusicPreview;
  mode?: MusicAnalysisMode;
  audioFingerprint?: string;
  cache?: ResultCache;
  onProgress?: (note: string) => void;
  /** Live worker observations, never evidence that cached scores executed inference. */
  onRuntime?: (runtime: { kind: string; backend: string; configuredInferenceThreads: number; effectiveInferenceThreads?: number; inferenceExecuted: boolean }) => void;
  onPreview?: (analysis: MusicAnalysis) => void;
  onPartial?: (analysis: MusicAnalysis) => void;
  /** Hosts with one retained worker per model family may run the families side by side.
   * Outputs are still applied in the sequential order, so results do not depend on timing. */
  concurrentModels?: boolean;
  /** Cancellation-only consumers avoid copying the growing ledger after every window. */
  partialUpdates?: 'all' | 'cancelled';
}
export interface MusicPreview {
  start: number;
  end: number;
  scores: Record<string, number>;
  analysis: MusicAnalysis;
}
export type MusicRequest = <T>(message: Record<string, unknown>, transfer: Transferable[]) => Promise<T>;
const audible = (samples: Float32Array) => samples.length > 0 && samples.reduce((sum, v) => sum + v * v, 0) / samples.length > 1e-8;

/** The folder's first pass only needs one short music-model estimate per recording. */
export async function previewDecodedMusic(decoder: MusicDecoder, request: MusicRequest, options: AnalysisOptions): Promise<MusicPreview | undefined> {
  const mode = options.mode === 'fast' && decoder.durationSeconds > 0 ? 'fast' : 'full';
  options.signal?.throwIfAborted();
  if (!decoder.durationSeconds || decoder.durationSeconds < 2.048) return;
  options.onProgress?.('Preparing a quick instrument estimate');
  const start = mode === 'fast' ? descriptionStarts(decoder.durationSeconds, mode)[0] : 0;
  try {
    const duration = decoder.durationSeconds || 10;
    const samples = await decoder.read(start, Math.min(10, duration - start), 16000);
    const end = start + samples.length / 16000;
    if (samples.length < Math.round(Math.min(10, duration - start) * 16000) - 1) return;
    const scores = audible(samples) ? await request<Record<string, number>>({ kind: 'jamendo', samples }, [samples.buffer]) : {};
    const analysis: MusicAnalysis = {
      version: 2, stage: 'preview', durationSeconds: duration, analyzedSeconds: 0, notes: [],
      instruments: jamendoSuggestions(scores).map(i => ({ label: i.label, score: i.score, status: 'possible' })),
      soundProfile: combineSoundModels([], scores, [], { ast: false, jamendo: true, clap: false }),
      instrumentScan: { revision: INSTRUMENT_ANALYSIS_REVISION, mode, complete: false, analyzedSeconds: 0, windows: 0 },
    };
    options.onPreview?.(analysis);
    return { start, end, scores, analysis };
  } catch (error) {
    if (options.signal?.aborted) throw error;
    // A failed preview must not prevent the deeper pass from retrying the model.
    return undefined;
  }
}

/** The fusion scorer's contract is the fixed prompt catalog it was trained on. Trained-head,
 * reviewed-example and one-shot scores ride along in the same output for tagging and are not part of it. */
export const fusionClapDescriptions = (scores: DescriptionScore[]) => scores.filter(d => d.group !== 'dj-learned' && d.group !== 'dj-one-shot' && d.group !== 'embedding');
/** Model jobs share a bounded timeline, but never each other's validity. Evidence is applied in one fixed order. */
export async function analyzeDecodedMusic(decoder: MusicDecoder, send: MusicRequest, options: AnalysisOptions): Promise<MusicAnalysis> {
  // The runtime each AST/CLAP output came from: a threaded stall can switch this browser to one thread mid-run.
  const startRuntime = musicRuntimeIdentity(), producedBy = new Set<string>();
  const request: MusicRequest = <T>(message: Record<string, unknown>, transfer: Transferable[]) => send<T>(message, transfer).then(result => {
    if (message.kind === 'instruments' || message.kind === 'profile') producedBy.add(musicRuntimeIdentity());
    return result;
  });
  const check = () => options.signal?.throwIfAborted();
  check();
  const release = releaseForScorer(options.fusion);
  const fusionIdentity = options.fusion && sanitizeFusionIdentity(options.fusion.identity);
  if (options.fusion && !fusionIdentity) throw new Error('Invalid fusion scorer identity');
  const mode = options.mode === 'fast' && decoder.durationSeconds > 0 ? 'fast' : 'full';
  let duration = decoder.durationSeconds;
  if (!duration) {
    // Discover duration with bounded buffers; do not retain PCM across sections.
    for (let start = 0; start < 86400; start += 60) {
      check();
      const samples = await decoder.read(start, Math.min(60, 86400 - start), 16000);
      duration = start + samples.length / 16000;
      if (samples.length < 60 * 16000) break;
    }
  }
  if (!Number.isFinite(duration) || duration <= 0 || duration > 86400) throw new Error('No supported audio duration found.');
  // Reconcile small container-duration overstatements before planning evidence.
  // Larger or interior decode gaps are errors, never successful full windows.
  const tailStart = Math.max(0, duration - 10);
  const tail = await decoder.read(tailStart, duration - tailStart, 16000);
  check();
  const decodedEnd = tailStart + tail.length / 16000;
  if (tail.length && decodedEnd < duration && duration - decodedEnd <= 1) duration = decodedEnd;
  const recognition = createRecognition(duration, mode, options.audioFingerprint);
  const result: MusicAnalysis = { version: 2, durationSeconds: duration, analyzedSeconds: 0, instruments: [], notes: [], recognition,
    tempoRevision: TEMPO_ANALYSIS_REVISION, keyRevision: KEY_ANALYSIS_REVISION };
  // Mix points: one pass over the whole recording at 16 kHz, 60 s of PCM at a time (src/audio/structure.ts).
  if (duration >= STRUCTURE_MIN_SECONDS && duration <= STRUCTURE_MAX_SECONDS) {
    try {
      options.onProgress?.('Finding the intro, drops and breakdowns');
      const features = new StructureFeatures();
      for (let start = 0; start < duration; start += 60) { check(); features.add(await decoder.read(start, Math.min(60, duration - start), STRUCTURE_RATE)); }
      result.structure = detectStructure(features.blocks);
    } catch (error) {
      if (options.signal?.aborted) throw error;
      result.notes.push('Track structure was unavailable. Reanalyze to retry.');
    }
  }
  // A quick scan listens to the first drop, where every part plays, instead of the middle of the track.
  const dropStart = mode === 'fast' ? representativeStart(duration, result.structure) : undefined;
  const job = (id: ModelId) => recognition.jobs.find(j => j.modelId === id)!;
  const windows = (starts: number[], length = 10): Interval[] => starts.map(start => ({ start, end: Math.min(duration, start + length) }));
  const soundWindows = windows(instrumentWindowStarts(duration));
  const fastAst = fastInstrumentStarts(duration);
  if (dropStart !== undefined && fastAst.length === 3) fastAst[1] = dropStart;
  job('ast').planned = mode === 'full' ? soundWindows : windows(fastAst);
  for (const id of ['jamendo', 'clap'] as const) job(id).planned = mode === 'full' ? soundWindows : windows(dropStart !== undefined ? [dropStart] : descriptionStarts(duration, mode));
  const excerptStarts = duration > 60 ? [Math.max(0, duration * .1 - 10), duration * .5 - 10, Math.min(duration - 20, duration * .9 - 10)] : [0];
  for (const id of ['rhythm', 'tonal'] as const) job(id).planned = windows(excerptStarts, duration > 60 ? 20 : 60);
  if (duration < 2.048) job('jamendo').unsupportedReason = 'At least 2.048 seconds of audio are required; no Jamendo inference ran.';
  const fusionIntervals = options.fusion ? [...new Map(['ast','jamendo','clap'].flatMap(id => job(id as ModelId).planned).map(i => [`${i.start}:${i.end}`,i])).values()].sort((a,b) => a.start-b.start) : [];
  if (fusionIdentity) result.fusion = { version: 1, scope: 'window', validation: release ? 'policy-qualified' : 'unvalidated', ...(release ? { release } : {}), identity: fusionIdentity,
    planned: fusionIntervals.length, counts: { complete: 0, failed: 0, unsupported: 0, empty: 0 }, omittedWindows: 0, windows: [] };
  const cache = options.cache ?? new ResultCache();
  // A per-run identity still permits preview reuse without cross-file collisions.
  const fingerprint = options.audioFingerprint ?? recognition.runId;
  const astEvidence = new InstrumentEvidence();
  const musicScores = new JamendoRecordingScores();
  const descriptions = new DescriptionAccumulator();
  const embeddings: number[][] = [];
  const djEvidence = new DjTagEvidence();
  const eventEvidence = new EventWindowEvidence();
  const completed = new Set<string>();
  const stopped = new Set<ModelId>();
  let eventPassFailed = false;
  const messages: Partial<Record<ModelId, string>> = {
    ast: 'Instrument recognition was unavailable. Reanalyze to retry.',
    jamendo: 'Music-trained instrument recognition was unavailable. Reanalyze to retry.',
    clap: 'Sound character recognition was unavailable. Reanalyze to retry.',
    rhythm: 'Tempo analysis was unavailable. Reanalyze to retry.', tonal: 'Key analysis was unavailable. Reanalyze to retry.',
  };
  const refresh = (cancelled = false, ended = false) => {
    for (const j of recognition.jobs) finishJob(j, duration, cancelled);
    // Event windows are extra CLAP work. A failed pass must not look like a closed job.
    if (eventPassFailed && job('clap').status === 'complete') job('clap').status = 'partial';
    const soundComplete = ['ast','jamendo','clap'].every(id => ['complete','unsupported'].includes(job(id as ModelId).status));
    result.instruments = astEvidence.results();
    const music = musicScores.scores();
    result.soundProfile = combineSoundModels(result.instruments, music, descriptions.average(),
      { ast: job('ast').status === 'complete', jamendo: job('jamendo').status === 'complete', clap: job('clap').status === 'complete' });
    // Event-window tags only fill gaps: a tag the 10 s windows already found keeps its own (stronger) evidence.
    const windowTags = djEvidence.results(), found = new Set(windowTags.map(t => `${t.group}:${t.label}`));
    const eventTags = eventEvidence.results().filter(h => !found.has(`${h.tag.group}:${h.tag.label}`)).map(h => ({ ...h.tag, segments: h.segments.slice(0, 3) }));
    mergeDjTags(result.soundProfile, [...windowTags, ...eventTags], descriptions.average());
    const audioVector = meanEmbedding(embeddings);
    if (audioVector) result.embedding = audioVector; else delete result.embedding;
    for (const suggestion of jamendoSuggestions(music)) {
      if (!result.instruments.some(i => i.label === suggestion.label)) result.instruments.push({ label: suggestion.label, score: suggestion.score, status: 'possible' });
    }
    result.instrumentScan = { revision: INSTRUMENT_ANALYSIS_REVISION, mode, complete: soundComplete && !cancelled,
      analyzedSeconds: job('ast').analyzedSeconds, windows: job('ast').successful.length };
    recognition.status = cancelled ? 'cancelled' : ended ? recognition.jobs.every(j => ['complete','unsupported'].includes(j.status)) ? 'complete'
      : recognition.jobs.some(j => j.successful.length) ? 'partial' : 'failed' : 'running';
    // Relabel only when every AST/CLAP output came from the final runtime; a mixed run stays stale and is redone.
    if (ended && [...producedBy].every(runtime => runtime === musicRuntimeIdentity())) refreshRuntimeIdentity(recognition, duration);
    if (ended || cancelled) recognition.endedAt = new Date().toISOString();
    if (cancelled) recognition.cancellationReason = 'Cancelled by user';
  };
  const publish = () => {
    if ((options.onPartial && options.partialUpdates !== 'cancelled') || (mode === 'fast' && options.onPreview)) {
      refresh();
      if(options.partialUpdates !== 'cancelled') options.onPartial?.(structuredClone(result));
      if(mode === 'fast') options.onPreview?.({ ...structuredClone(result), stage: 'preview' });
    }
    check();
  };
  type SoundId = 'ast' | 'jamendo' | 'clap';
  type Raw = InstrumentPredictions | Record<string, number> | DescriptionScore[];
  const concurrent = options.concurrentModels === true;
  // One FFmpeg instance writes one output file: overlapping section reads must queue.
  let reading: Promise<unknown> = Promise.resolve();
  const read = (start: number, seconds: number, rate: number): Promise<Float32Array> => {
    if (!concurrent) return decoder.read(start, seconds, rate);
    const next = reading.then(() => decoder.read(start, seconds, rate));
    reading = next.catch(() => {});
    return next;
  };
  /** Decode and score one window. Touches no shared evidence, so families may overlap. */
  async function fetchRaw(id: SoundId, interval: Interval, key: string): Promise<{ output: Raw | undefined; cacheHit: boolean }> {
    let output = cache.get<Raw>(key);
    const cacheHit = output !== undefined;
    if (cacheHit && id !== 'jamendo') producedBy.add(startRuntime);
    const preview = options.initialPreview;
    if (!output && id === 'jamendo' && preview?.start === interval.start && Math.abs(preview.end - interval.end) < 1 / 16000) output = preview.scores;
    if (!output) {
      const rate = id === 'clap' ? 48000 : 16000;
      const samples = await read(interval.start, interval.end - interval.start, rate);
      check();
      if (!samples.length || samples.length < Math.round((interval.end - interval.start) * rate) - 1) throw new Error('Audio window could not be fully decoded');
      const hasAudio = audible(samples);
      // A whole short clip also goes to the one-shot heads, which read the unchanged 16 kHz audio.
      const samples16 = id === 'clap' && interval.start === 0 && interval.end >= duration && duration <= SHORT_CLIP_MAX_SECONDS ? await read(0, duration, 16000) : undefined;
      output = await request({ kind: id === 'ast' ? 'instruments' : id === 'clap' ? 'profile' : 'jamendo', samples, ...(samples16 ? { samples16 } : {}), ...(id === 'ast' && astOnGpu ? { gpu: true } : {}) }, samples16 ? [samples.buffer, samples16.buffer] : [samples.buffer]);
      if (!hasAudio) output = id === 'ast' ? { scores: {}, musicScore: 0 } : id === 'clap' ? [] : {};
      check(); cache.set(key, output);
    }
    return { output, cacheHit };
  }
  // Each family scores ahead of the ordered pass below. One window per family is in
  // flight, and small outputs wait at most MAX_AHEAD windows before they are applied.
  const MAX_AHEAD = 256;
  const ahead = new Map<string, ReturnType<typeof fetchRaw>>();
  const started = new Set<string>();
  const applied: Record<SoundId, number> = { ast: 0, jamendo: 0, clap: 0 };
  const wake: Partial<Record<SoundId, () => void>> = {};
  let ended = false;
  // AST runs on the graphics card (full-precision weights, about 8x faster) only where no validated scorer reads
  // its scores (recognition astGpuAllowed). The AST job's preprocessing version records it, so cache keys and
  // saved ledgers both tell GPU-allowed runs apart from q8 WASM ones.
  const astOnGpu = astGpuAllowed(duration, mode);
  const windowKey = (id: SoundId, interval: Interval) => modelCacheKey(fingerprint, job(id), interval);
  async function scoreAhead(id: SoundId): Promise<void> {
    const j = job(id);
    for (let i = 0; i < j.planned.length; i++) {
      while (!ended && i - applied[id] >= MAX_AHEAD) await new Promise<void>(resolve => { wake[id] = resolve; });
      if (ended || stopped.has(id) || j.unsupportedReason || options.signal?.aborted) return;
      const key = windowKey(id, j.planned[i]);
      if (started.has(key)) continue;
      started.add(key);
      const pending = fetchRaw(id, j.planned[i], key);
      ahead.set(key, pending);
      // The ordered pass reports this window's failure; here it only ends the family's lead.
      try { await pending; } catch { return; }
    }
  }
  const stopAhead = () => { ended = true; for (const id of ['ast','jamendo','clap'] as const) wake[id]?.(); };
  async function sound(id: SoundId, interval: Interval): Promise<{ output: Raw; cacheKey: string; cacheHit: boolean } | undefined> {
    check();
    if (stopped.has(id) || job(id).unsupportedReason) return;
    const j = job(id); const key = windowKey(id, interval);
    if (completed.has(key)) return;
    j.status = 'running'; j.attempted.push(interval);
    options.onProgress?.(`${id}: ${j.successful.length}/${j.planned.length} windows; ${Math.floor(interval.start)}–${Math.ceil(interval.end)}s of ${Math.ceil(duration)}s`);
    try {
      const early = ahead.get(key);
      ahead.delete(key); started.add(key);
      let output: Raw | undefined, cacheHit: boolean;
      try { ({ output, cacheHit } = await (early ?? fetchRaw(id, interval, key))); }
      finally { applied[id]++; wake[id]?.(); }
      if (!output) throw new Error('Native model returned no output');
      if (id === 'ast') {
        const predictions = output as InstrumentPredictions;
        astEvidence.add(predictions.scores, interval.start, interval.end, predictions.musicScore);
        recordEvidence(recognition, id, interval, Object.entries(predictions.scores).filter(([,score]) => score >= .35)
          .map(([labelId,score]) => ({ dimension: 'source', labelId, score })));
      } else if (id === 'jamendo') {
        const scores = output as Record<string, number>;
        musicScores.add(scores);
        recordEvidence(recognition, id, interval, [...jamendoLabels(scores), ...nsynthLabels(scores)]);
      } else {
        const { scores, embedding } = splitEmbedding(output as DescriptionScore[]);
        if (embedding) embeddings.push(embedding);
        descriptions.add(scores);
        djEvidence.add(selectDjTags(scores), interval.start, interval.end);
        const selected = selectDescriptions(scores);
        const candidates: EvidenceCandidate[] = selected.sources.map(s => ({ dimension: 'source', labelId: s.label, score: s.score }));
        if(selected.vocalSourceEvidence&&!selected.sources.some(s=>s.label==='voice')) {
          const {group,labelId,score}=selected.vocalSourceEvidence;
          candidates.push({dimension:'source',labelId:'voice',score,derivedFrom:{group,labelId}});
        }
        for (const [dimension, labels] of [['character',selected.character],['role',selected.roles],['vocal',selected.vocalStyle ? [selected.vocalStyle] : []]] as const) {
          for (const labelId of labels) candidates.push({ dimension: dimension === 'role' && labelId === 'atmosphere' ? 'effect' : dimension, labelId, score: Math.max(...scores.filter(s => s.label === labelId).map(s => s.score)) });
        }
        recordEvidence(recognition, id, interval, candidates);
      }
      j.successful.push(interval); completed.add(key);
      return { output, cacheKey: key, cacheHit };
    } catch (error) {
      if (options.signal?.aborted) throw error;
      j.error = error instanceof Error ? error.message : 'Unavailable';
      stopped.add(id); // One failed attempt per component per run; explicit reanalysis retries it.
      result.notes.push(messages[id]!);
      return undefined;
    }
  }
  /** One-shot heads on short windows where new sounds start (src/audio/eventWindows.ts). Optional: a failure
   * leaves the 10 s results as they are. */
  async function eventPass(): Promise<void> {
    try {
      const candidates: ReturnType<typeof onsetCandidates> = [];
      for (let start = 0; start < duration; start += 30) {
        check(); candidates.push(...onsetCandidates(await read(start, Math.min(30, duration - start), 16000), start));
      }
      const starts = pickEventStarts(candidates, duration);
      for (const [i, t] of starts.entries()) {
        check();
        const interval = { start: t - EVENT_WINDOW_BEFORE, end: t + EVENT_WINDOW_AFTER }, seconds = interval.end - interval.start;
        options.onProgress?.(`one-shot windows: ${i + 1}/${starts.length}; ${Math.floor(interval.start)}s of ${Math.ceil(duration)}s`);
        const key = `${modelCacheKey(fingerprint, job('clap'), interval)}:event-window-v1`;
        let output = cache.get<DescriptionScore[]>(key);
        if (output) producedBy.add(startRuntime);
        else {
          const samples = await read(interval.start, seconds, 48000), samples16 = await read(interval.start, seconds, 16000);
          check();
          if (!audible(samples) || samples.length < Math.round(seconds * 48000) - 1) continue;
          output = await request<DescriptionScore[]>({ kind: 'profile', samples, samples16 }, [samples.buffer, samples16.buffer]);
          check(); cache.set(key, output);
        }
        output = splitEmbedding(output).scores;
        eventEvidence.add(output, interval.start, interval.end);
        recordEvidence(recognition, 'clap', interval, output.flatMap(s => {
          if (s.group !== 'dj-learned' || s.basis !== 'head' || s.decision !== 'include' || !s.learnedGroup || !s.label || !EVENT_WINDOW_LABELS.has(s.label)) return [];
          return [{ dimension: s.learnedGroup === 'source' ? 'source' as const : 'effect' as const, labelId: s.label, score: s.score }];
        }));
      }
      publish();
    } catch (error) {
      if (options.signal?.aborted) throw error;
      eventPassFailed = true;
      job('clap').error = error instanceof Error ? error.message : 'Unavailable';
      result.notes.push('Event-window recognition was unavailable. Reanalyze to retry.');
    }
  }
  const leads = concurrent ? (['ast','jamendo','clap'] as const).map(id => scoreAhead(id).catch(() => {})) : [];
  try {
    if (!options.fusion) await sound('jamendo', job('jamendo').planned[0]);
    refresh();
    if (job('jamendo').successful.length) options.onPreview?.({ ...structuredClone(result), stage: 'preview' });
    check(); publish();
    for (const id of ['rhythm','tonal'] as const) {
      const j = job(id); j.status = 'running';
      try {
        const samples: Float32Array[] = [];
        for (const interval of j.planned) {
          check(); j.attempted.push(interval);
          const sample = await read(interval.start, interval.end - interval.start, 44100);
          if (!sample.length || sample.length < Math.round((interval.end - interval.start) * 44100) - 1) throw new Error('Audio excerpt could not be fully decoded');
          samples.push(sample);
        }
        if (!samples.length) throw new Error('Audio excerpt could not be fully decoded');
        const partial = await request<MusicAnalysis>({ kind: id, excerpts: { durationSeconds: duration, samples } }, samples.map(s => s.buffer));
        check();
        if (id === 'rhythm') result.tempo = partial.tempo;
        else { result.key = partial.key; result.detectedPitch = partial.detectedPitch; }
        result.notes.push(...(partial.notes ?? []));
        result.analyzedSeconds = Math.max(result.analyzedSeconds, j.planned.reduce((n,i) => n + i.end - i.start, 0));
        j.successful = [...j.planned];
      } catch (error) {
        if (options.signal?.aborted) throw error;
        j.error = error instanceof Error ? error.message : 'Unavailable'; result.notes.push(messages[id]!);
      }
      publish();
    }
    if (options.fusion && fusionIdentity) {
      const ids = ['ast','jamendo','clap'] as const;
      const keyOf = (i: Interval) => `${i.start}:${i.end}`;
      const plans = new Map(ids.map(id => [id, new Set(job(id).planned.map(keyOf))]));
      const fusion = result.fusion!;
      for (const interval of fusionIntervals) {
        check();
        // Only one window's raw outputs are retained. Native cache remains bounded separately.
        const outputs = new Map<string, NonNullable<Awaited<ReturnType<typeof sound>>>>();
        for (const id of ids) if (plans.get(id)!.has(keyOf(interval))) {
          const output = await sound(id, interval);
          if (output) outputs.set(id, output);
        }
        let window: FusionWindow = { ...interval, status: 'unsupported', reason: 'Native model intervals are not aligned', decisions: unavailableFusionDecisions() };
        if (ids.every(id => plans.get(id)!.has(keyOf(interval)))) {
          if (release && !supportsFusionInput(duration, mode, options.sourceMime)) window.reason = 'Input is outside the qualified ten-second Ogg full-analysis tier';
          else if (ids.some(id => job(id).unsupportedReason)) window.reason = 'A required native model does not support this interval';
          else if (outputs.size !== 3) window = { ...window, status: 'failed', reason: 'A required native model failed or stopped' };
          else {
            const ast = outputs.get('ast')!.output as InstrumentPredictions;
            const jamendo = jamendoInstrumentScores(outputs.get('jamendo')!.output as Record<string, number>);
            const clap = fusionClapDescriptions(outputs.get('clap')!.output as DescriptionScore[]);
            if (!Object.keys(ast.scores).length || !Object.keys(jamendo).length || !clap.length) {
              window = { ...window, status: 'empty', reason: 'Silent or empty native output; no fusion decision' };
            } else {
              try {
                const decisions = sanitizeFusionDecisions(await options.fusion.score(structuredClone({ interval, audioFingerprint: options.audioFingerprint,
                  raw: { ast: { instruments: ast.scores }, jamendo, clap: { descriptions: clap } },
                  native: ids.map(id => { const j = job(id); const o = outputs.get(id)!; return { modelId: id, weightsVersion: j.weightsVersion,
                    preprocessingVersion: j.preprocessingVersion, promptVersion: j.promptVersion, cacheKey: o.cacheKey, cacheHit: o.cacheHit }; }) }), options.signal), true);
                check();
                if (!decisions) throw new Error('Malformed fusion decisions');
                window = { ...interval, status: 'complete', decisions };
              } catch (error) {
                if (options.signal?.aborted) throw error;
                window = { ...window, status: 'failed', reason: 'Fusion scorer failed or returned invalid decisions' };
              }
            }
          }
        }
        fusion.counts[window.status]++;
        if (fusion.windows.length < MAX_FUSION_WINDOWS) fusion.windows.push(window); else fusion.omittedWindows++;
        publish();
      }
    } else {
      for (const id of ['ast','jamendo','clap'] as const) {
        for (const interval of job(id).planned) { await sound(id, interval); publish(); if (stopped.has(id)) break; }
      }
    }
    // A stopped family may still hold one window in flight; let it settle before the decoder closes.
    stopAhead(); await Promise.all(leads);
    if (mode === 'full' && duration > SHORT_CLIP_MAX_SECONDS && !stopped.has('clap') && !job('clap').unsupportedReason) await eventPass();
    refresh(false, true);
    return result;
  } catch (error) {
    if (options.signal?.aborted) { refresh(true, true); options.onPartial?.(structuredClone(result)); }
    throw error;
  } finally { stopAhead(); }
}

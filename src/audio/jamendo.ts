import type Essentia from 'essentia.js/dist/essentia.js-core.es.js';
import { jamendoPatches } from './jamendoFeatures';
import { INSTRUMENT_LABELS, isBroadInstrument } from './instrumentLabels';
import type { SoundSuggestion } from './soundSuggestions';
import { sourceLabels, type Dimension } from './recognition';
/** The score a Jamendo label needs before it counts; voice is noisier, so it needs more. */
export const jamendoBar = (label: string) => label === 'voice' ? .5 : .3;
export function jamendoLabels(scores: Record<string, number>): { dimension: Dimension; labelId: string; score: number }[] {
  return Object.entries(scores).flatMap(([raw, score]) => {
    if (!Number.isFinite(score) || score < jamendoBar(raw) || score > 1) return [];
    const role = ({ bass: 'bass', beat: 'rhythm', pad: 'pad' } as Record<string,string>)[raw];
    if (role) return [{ dimension: 'role' as Dimension, labelId: role, score }];
    const labelId = aliases[raw] ?? ({ acousticbassguitar: 'bass guitar', brass: 'brass instrument', keyboard: 'keyboard (musical)' } as Record<string,string>)[raw] ?? raw;
    return sourceLabels.includes(labelId) ? [{ dimension: 'source' as Dimension, labelId, score }] : [];
  });
}
const aliases: Record<string, string> = { acousticguitar: 'acoustic guitar', classicalguitar: 'acoustic guitar', doublebass: 'double bass', drummachine: 'drum machine', drums: 'drum kit', electricguitar: 'electric guitar', electricpiano: 'electric piano', pipeorgan: 'organ', rhodes: 'electric piano', strings: 'string section', violin: 'violin / fiddle' };
export function jamendoSuggestions(scores: Record<string, number>): SoundSuggestion[] {
  const candidates = new Map<string, number>();
  for (const [raw, score] of Object.entries(scores)) {
    const label = aliases[raw] ?? raw;
    // Bass, beat, pad and computer describe roles or broad sources;
    // do not convert them into invented specific instrument detections.
    if (INSTRUMENT_LABELS.includes(label) && !isBroadInstrument(label) && Number.isFinite(score) && score >= 0 && score <= 1) candidates.set(label, Math.max(candidates.get(label) ?? 0, score));
  }
  const ranked = [...candidates].sort((a,b) => b[1]-a[1]);
  return ranked.filter(([label, score]) => score >= jamendoBar(label)).slice(0, 3).map(([label, score]) => ({ label, score, margin: Math.max(0, score - (ranked.find(([other]) => other !== label)?.[1] ?? 0)) }));
}
/** Recording-level Jamendo scores: each label's mean over its two strongest windows. A plain average
 * over every window dilutes an instrument that plays in only part of a long recording. Past two windows,
 * the second-strongest window must itself clear the label's bar, or the label scores 0: halving alone
 * would still let one confident window (0.6 or more) reach the bar by itself. A window without a label
 * counts as 0, so one- and two-window recordings get exactly the plain average. */
export class JamendoRecordingScores {
  private top = new Map<string, [number, number]>();
  private windows = 0;
  add(scores: Record<string, number>): void {
    this.windows++;
    for (const [label, score] of Object.entries(scores)) {
      if (!Number.isFinite(score) || score < 0 || score > 1) continue;
      const best = this.top.get(label) ?? [0, 0];
      if (score > best[0]) this.top.set(label, [score, best[0]]);
      else this.top.set(label, [best[0], Math.max(best[1], score)]);
    }
  }
  scores(): Record<string, number> {
    return Object.fromEntries([...this.top].map(([label, [first, second]]) => {
      if (this.windows === 1) return [label, first];
      return [label, this.windows > 2 && second < jamendoBar(label) ? 0 : (first + second) / 2];
    }));
  }
}
/** NSynth heads share the Jamendo EffNet embedding. Their scores travel in the same
 * map under a prefix, so the Jamendo instrument family keeps its exact class set. */
const NSYNTH_HEADS = ['instrument', 'bright_dark', 'reverb', 'acoustic_electronic'] as const;
const NSYNTH_PREFIX = 'nsynth:';
export const isNsynthScore = (key: string) => key.startsWith(NSYNTH_PREFIX);
/** The MTG-Jamendo instrument scores alone, as the fusion schema expects them. */
export function jamendoInstrumentScores(scores: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(scores).filter(([key]) => !isNsynthScore(key)));
}
// Softmax pairs; a high bar keeps a coin-flip clip from claiming either side. Uncalibrated.
const NSYNTH_CHARACTER: Record<string, string> = { 'bright_dark:bright': 'bright', 'bright_dark:dark': 'dark', 'reverb:wet': 'reverberant', 'reverb:dry': 'dry' };
const NSYNTH_THRESHOLD = .8;
/** Timbre and space evidence. NSynth instrument and acoustic/electronic scores were
 * trained on single notes, so they are kept as scores but not reported as labels. */
export function nsynthLabels(scores: Record<string, number>): { dimension: Dimension; labelId: string; score: number }[] {
  return Object.entries(NSYNTH_CHARACTER).flatMap(([key, labelId]) => {
    const score = scores[`${NSYNTH_PREFIX}${key}`];
    return Number.isFinite(score) && score >= NSYNTH_THRESHOLD && score <= 1 ? [{ dimension: 'character' as Dimension, labelId, score }] : [];
  });
}
let models: ReturnType<typeof loadModels> | undefined;
async function loadModels() {
  // Same ORT entry as Transformers.js; no second runtime or remote requests.
  const ort = await import('onnxruntime-web/webgpu');
  // Float32 Jamendo reductions must retain the frozen single-thread path.
  ort.env.wasm.numThreads = 1;
  const root = `${import.meta.env.BASE_URL}jamendo-model/`;
  const metadata = await fetch(`${root}mtg_jamendo_instrument-discogs-effnet-1.json`);
  if (!metadata.ok) throw new Error('Music instrument labels are unavailable.');
  const { classes } = await metadata.json() as { classes: string[] };
  const embed = await ort.InferenceSession.create(`${root}discogs-effnet-bsdynamic-1.onnx`, { executionProviders: ['wasm'] });
  const opened: { release(): Promise<void> }[] = [embed];
  try {
    const head = await ort.InferenceSession.create(`${root}mtg_jamendo_instrument-discogs-effnet-1.onnx`, { executionProviders: ['wasm'] });
    opened.push(head);
    const nsynth = [];
    for (const name of NSYNTH_HEADS) {
      const meta = await fetch(`${root}nsynth_${name}-discogs-effnet-1.json`);
      if (!meta.ok) throw new Error('NSynth timbre labels are unavailable.');
      const session = await ort.InferenceSession.create(`${root}nsynth_${name}-discogs-effnet-1.onnx`, { executionProviders: ['wasm'] });
      opened.push(session);
      nsynth.push({ name, session, classes: (await meta.json() as { classes: string[] }).classes });
    }
    return { ort, embed, head, classes, nsynth };
  } catch (error) { for (const session of opened) await session.release(); throw error; }
}
/** Open the sessions before the first clip arrives; later calls share the same load. */
export function preloadJamendo(): ReturnType<typeof loadModels> {
  return models ??= loadModels().catch(error => { models = undefined; throw error; });
}
export async function classifyJamendo(engine: Essentia, samples: Float32Array): Promise<Record<string, number>> {
  const patches = jamendoPatches(engine, samples);
  if (!patches.length) throw new Error('Unsupported Jamendo input: at least 2.048 seconds required.');
  const { ort, embed, head, classes, nsynth } = await preloadJamendo();
  const sums = new Float64Array(classes.length);
  const nsynthSums = nsynth.map(h => new Float64Array(h.classes.length));
  for (const patch of patches) {
    const input = new ort.Tensor('float32', patch, [1, 128, 96]);
    const embedding = await embed.run({ melspectrogram: input });
    try {
      // Every head reads the same EffNet embedding, so the extra heads add no audio pass.
      for (const [session, target] of [[head, sums], ...nsynth.map((h, i) => [h.session, nsynthSums[i]] as const)] as const) {
        const outputs = await session.run({ embeddings: embedding.embeddings });
        try { for (let i = 0; i < target.length; i++) target[i] += Number(outputs.activations.data[i]) / patches.length; }
        finally { for (const tensor of Object.values(outputs)) tensor.dispose(); }
      }
    } finally { input.dispose(); for (const tensor of Object.values(embedding)) tensor.dispose(); }
  }
  return Object.fromEntries([
    ...classes.map((label, i) => [label, sums[i]] as const),
    ...nsynth.flatMap((h, j) => h.classes.map((label, i) => [`${NSYNTH_PREFIX}${h.name}:${label}`, nsynthSums[j][i]] as const)),
  ]);
}

import type Essentia from 'essentia.js/dist/essentia.js-core.es.js';
import { jamendoPatches } from './jamendoFeatures';
import { INSTRUMENT_LABELS, isBroadInstrument } from './instrumentLabels';
import type { SoundSuggestion } from './soundSuggestions';
import { sourceLabels, type Dimension } from './recognition';
export function jamendoLabels(scores: Record<string, number>): { dimension: Dimension; labelId: string; score: number }[] {
  return Object.entries(scores).flatMap(([raw, score]) => {
    if (!Number.isFinite(score) || score < (raw === 'voice' ? .5 : .3) || score > 1) return [];
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
  return ranked.filter(([label, score]) => score >= (label === 'voice' ? 0.5 : 0.3)).slice(0, 3).map(([label, score]) => ({ label, score, margin: Math.max(0, score - (ranked.find(([other]) => other !== label)?.[1] ?? 0)) }));
}
let models: ReturnType<typeof loadModels> | undefined;
async function loadModels() {
  // Same ORT entry as Transformers.js; no second runtime or remote requests.
  const ort = await import('onnxruntime-web/webgpu');
  ort.env.wasm.numThreads = 1;
  const root = `${import.meta.env.BASE_URL}jamendo-model/`;
  const metadata = await fetch(`${root}mtg_jamendo_instrument-discogs-effnet-1.json`);
  if (!metadata.ok) throw new Error('Music instrument labels are unavailable.');
  const { classes } = await metadata.json() as { classes: string[] };
  const embed = await ort.InferenceSession.create(`${root}discogs-effnet-bsdynamic-1.onnx`, { executionProviders: ['wasm'] });
  try {
    const head = await ort.InferenceSession.create(`${root}mtg_jamendo_instrument-discogs-effnet-1.onnx`, { executionProviders: ['wasm'] });
    return { ort, embed, head, classes };
  } catch (error) { await embed.release(); throw error; }
}
export async function classifyJamendo(engine: Essentia, samples: Float32Array): Promise<Record<string, number>> {
  const patches = jamendoPatches(engine, samples);
  if (!patches.length) throw new Error('Unsupported Jamendo input: at least 2.048 seconds required.');
  const { ort, embed, head, classes } = await (models ??= loadModels().catch(error => { models = undefined; throw error; }));
  const sums = new Float64Array(classes.length);
  for (const patch of patches) {
    const input = new ort.Tensor('float32', patch, [1, 128, 96]);
    const embedding = await embed.run({ melspectrogram: input });
    try {
      const outputs = await head.run({ embeddings: embedding.embeddings });
      try { for (let i = 0; i < sums.length; i++) sums[i] += Number(outputs.activations.data[i]) / patches.length; }
      finally { for (const tensor of Object.values(outputs)) tensor.dispose(); }
    } finally { input.dispose(); for (const tensor of Object.values(embedding)) tensor.dispose(); }
  }
  return Object.fromEntries(classes.map((label, i) => [label, sums[i]]));
}

import { TAGGER_POLICY, TAGGER_WINDOW_SAMPLES, taggerWindow } from './tagger';

/** Worker side of the trained tagger: one onnxruntime-web session (the runtime the Jamendo models already use), run on
 * one 10 s window of 32 kHz mono audio at a time. Returns every output's sigmoid score, keyed by its class name. */
let session: ReturnType<typeof loadTagger> | undefined;
async function loadTagger() {
  const ort = await import('onnxruntime-web/webgpu');
  // This session shares the Jamendo worker's runtime, whose float32 reductions must stay on one thread (jamendo.ts).
  ort.env.wasm.numThreads = 1;
  const root = `${import.meta.env.BASE_URL}tagger-model/`;
  const metadata = await fetch(`${root}model.json`);
  if (!metadata.ok) throw new Error('Tagger labels are unavailable.');
  const meta = await metadata.json() as { classes?: unknown; sha256?: Record<string, string> };
  const classes = Array.isArray(meta.classes) && meta.classes.every(c => typeof c === 'string') ? meta.classes as string[] : [];
  // The policy's thresholds belong to these exact weights.
  if (meta.sha256?.['model.onnx'] !== TAGGER_POLICY.modelSha256 || !TAGGER_POLICY.tags.every(tag => classes.includes(tag.output))) throw new Error('Tagger labels do not match the installed policy.');
  const model = await ort.InferenceSession.create(`${root}model.onnx`, { executionProviders: ['wasm'] });
  return { ort, model, classes };
}
export function preloadTagger(): ReturnType<typeof loadTagger> {
  return session ??= loadTagger().catch(error => { session = undefined; throw error; });
}
export async function classifyTagger(samples: Float32Array): Promise<Record<string, number>> {
  const { ort, model, classes } = await preloadTagger();
  const input = new ort.Tensor('float32', taggerWindow(samples), [1, TAGGER_WINDOW_SAMPLES]);
  try {
    const outputs = await model.run({ [TAGGER_POLICY.input.name]: input });
    try {
      const scores = outputs[TAGGER_POLICY.input.output].data as Float32Array;
      if (scores.length !== classes.length) throw new Error('Tagger returned an unexpected number of scores.');
      if (scores.some(score => !Number.isFinite(score) || score < 0 || score > 1)) throw new Error('Tagger returned an invalid probability.');
      return Object.fromEntries(classes.map((label, i) => [label, Number(scores[i])]));
    } finally { for (const tensor of Object.values(outputs)) tensor.dispose(); }
  } finally { input.dispose(); }
}

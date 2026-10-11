import { DASHENG_POLICY, dashengModelUrl, dashengWindow } from './dashengAddon';
import { isTaggerScores } from './tagger';

/** Worker side of the desktop Dasheng add-on (src/audio/dashengAddon.ts): one onnxruntime-web session in its own
 * worker family. The 651 MB model downloads once from huggingface.co, is checked against the policy's SHA-256 and kept
 * in this browser's Cache Storage, so later sessions load it offline. */
const CACHE = 'dge-dasheng-addon-v1';
const MODEL = 'model.onnx', META = 'model.json';

async function sha256(bytes: ArrayBuffer): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
}
/** The verified model bytes: from Cache Storage, else downloaded, verified and cached. A mismatch is never cached. */
async function modelBytes(onProgress?: (note: string) => void): Promise<ArrayBuffer> {
  const url = dashengModelUrl(MODEL);
  const cache = typeof caches === 'undefined' ? undefined : await caches.open(CACHE).catch(() => undefined);
  const cached = await cache?.match(url);
  if (cached) {
    const bytes = await cached.arrayBuffer();
    if (await sha256(bytes) === DASHENG_POLICY.modelSha256) return bytes;
    await cache!.delete(url);
  }
  onProgress?.(`Downloading the desktop Dasheng add-on (${DASHENG_POLICY.downloadMB} MB, once)`);
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`Dasheng add-on download failed (${response.status}).`);
  const total = Number(response.headers.get('content-length')) || DASHENG_POLICY.downloadMB * 1e6;
  const parts: Uint8Array[] = [];
  let received = 0, shown = 0;
  for (const reader = response.body.getReader(); ;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value); received += value.length;
    const percent = Math.min(99, Math.floor(100 * received / total));
    if (percent >= shown + 5) { shown = percent; onProgress?.(`Downloading the desktop Dasheng add-on: ${percent}% of ${DASHENG_POLICY.downloadMB} MB`); }
  }
  const joined = new Uint8Array(received);
  let at = 0;
  for (const part of parts) { joined.set(part, at); at += part.length; }
  const bytes = joined.buffer;
  if (await sha256(bytes) !== DASHENG_POLICY.modelSha256) throw new Error('The downloaded Dasheng add-on does not match its pinned checksum.');
  await cache?.put(url, new Response(bytes, { headers: { 'content-type': 'application/octet-stream' } })).catch(() => { /* quota: works this session only */ });
  return bytes;
}

let session: ReturnType<typeof loadDasheng> | undefined;
async function loadDasheng(onProgress?: (note: string) => void) {
  const ort = await import('onnxruntime-web/webgpu');
  const metadata = await fetch(dashengModelUrl(META));
  if (!metadata.ok) throw new Error('Dasheng add-on labels are unavailable.');
  const meta = await metadata.json() as { classes?: unknown; sha256?: Record<string, string> };
  const classes = Array.isArray(meta.classes) && meta.classes.every(c => typeof c === 'string') ? meta.classes as string[] : [];
  // The policy's thresholds belong to these exact weights.
  if (meta.sha256?.[MODEL] !== DASHENG_POLICY.modelSha256 || !DASHENG_POLICY.tags.every(tag => classes.includes(tag.output))) throw new Error('Dasheng add-on labels do not match the installed policy.');
  const model = await ort.InferenceSession.create(new Uint8Array(await modelBytes(onProgress)), { executionProviders: ['wasm'] });
  return { ort, model, classes };
}
export function preloadDasheng(onProgress?: (note: string) => void): ReturnType<typeof loadDasheng> {
  return session ??= loadDasheng(onProgress).catch(error => { session = undefined; throw error; });
}
/** Every policy output's probability for one window of 16 kHz mono audio. */
export async function classifyDasheng(samples: Float32Array, onProgress?: (note: string) => void): Promise<Record<string, number>> {
  const { ort, model, classes } = await preloadDasheng(onProgress);
  const window = dashengWindow(samples);
  const input = new ort.Tensor('float32', window, [1, window.length]);
  try {
    const outputs = await model.run({ [DASHENG_POLICY.input.name]: input });
    try {
      const scores = outputs[DASHENG_POLICY.input.output].data as Float32Array;
      if (scores.length !== classes.length) throw new Error('Dasheng add-on returned an unexpected number of scores.');
      const wanted = new Set(DASHENG_POLICY.tags.map(tag => tag.output));
      const result = Object.fromEntries(classes.flatMap((label, i) => wanted.has(label) ? [[label, Number(scores[i])]] : []));
      if (!isTaggerScores(result, DASHENG_POLICY)) throw new Error('Dasheng add-on returned an invalid probability.');
      return result;
    } finally { for (const tensor of Object.values(outputs)) tensor.dispose(); }
  } finally { input.dispose(); }
}

import { getDb } from '../persistence/db';

const PREFIX = 'audio-inference:v2:decoder-mono-v1:';
const LIMIT = 4096;
const fingerprints = new Map<string, Promise<string | undefined>>();
let writes = 0;

/** Pin reusable features to the encoder and preprocessing assets, not reviews.
 * Bump the prefix when feature extraction code or its numerical runtime changes.
 */
async function fingerprint(directory: string): Promise<string | undefined> {
  let pending = fingerprints.get(directory);
  if (!pending) {
    pending = (async () => {
      try {
        const response = await fetch(`${import.meta.env.BASE_URL}${directory}/manifest.json`, { cache: 'no-cache', signal: AbortSignal.timeout(2000) });
        if (!response.ok) return;
        const manifest = await response.json() as { sha256?: Record<string, string> };
        const assets = Object.entries(manifest.sha256 ?? {}).filter(([name]) => name !== 'learned.json' && name !== 'prompts.json').sort(([a], [b]) => a.localeCompare(b));
        if (!assets.length || !assets.some(([name]) => name.endsWith('.onnx')) || assets.some(([, hash]) => !/^[a-f0-9]{64}$/.test(hash))) return;
        return JSON.stringify(assets);
      } catch { return; }
    })();
    fingerprints.set(directory, pending);
  }
  return pending;
}

/** Store only model outputs, never user labels or audio. Exact PCM bytes and
 * model assets must match. Cache failures fall back to normal inference.
 */
export async function cachedAudioInference<T>(
  directory: string,
  kind: string,
  samples: Float32Array,
  valid: (value: unknown) => value is T,
  compute: () => Promise<T>,
  onHit?: () => void,
): Promise<T> {
  let key: string | undefined;
  try {
    const model = await fingerprint(directory);
    if (model) {
      const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength).slice()));
      key = `${PREFIX}${kind}:${model}:${Array.from(hash, b => b.toString(16).padStart(2, '0')).join('')}`;
      const cached = await (await getDb()).get('settings', key) as { value?: unknown } | undefined;
      const saved = cached?.value;
      if (valid(saved)) { onHit?.(); return saved; }
    }
  } catch { /* Storage is optional. */ }
  const value = await compute();
  if (key && valid(value)) {
    try {
      const db = await getDb();
      const tx = db.transaction('settings', 'readwrite');
      // Quota failures can reject both put() and the transaction promise.
      void tx.done.catch(() => {});
      await tx.store.put({ value, savedAt: Date.now() }, key);
      // Prune periodically rather than scanning storage on every window.
      if (writes++ % 32 === 0) {
        const keys = (await tx.store.getAllKeys()).filter(k => k.startsWith(PREFIX));
        if (keys.length > LIMIT) {
          const entries = await Promise.all(keys.map(async k => ({ key: k, savedAt: ((await tx.store.get(k)) as { savedAt?: number })?.savedAt ?? 0 })));
          entries.sort((a, b) => a.savedAt - b.savedAt);
          for (const entry of entries.slice(0, entries.length - LIMIT)) await tx.store.delete(entry.key);
        }
      }
      await tx.done;
    } catch { /* Full or unavailable storage must not interrupt analysis. */ }
  }
  return value;
}

export function isScoreMap(value: unknown): value is Record<string, number> {
  return !!value && typeof value === 'object' && !Array.isArray(value) && Object.values(value).every(v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1);
}

export function isAudioEmbedding(value: unknown): value is number[] {
  return Array.isArray(value) && value.length === 512 && value.every(v => typeof v === 'number' && Number.isFinite(v)) && Math.hypot(...value) > 1e-8;
}

import type { DecodedMusicSnapshot } from './musicDecodedCache';
import { instrumentWindowStarts } from './instrumentEvidence';
const SHORT_CLIP_SECONDS = 30;
const MODEL_SAMPLE_RATES = [16000, 44100, 48000];
/** This FFmpeg WASM build runs out of memory after roughly 150 section decodes in one instance (a 5-minute
 * song crashed with "memory access out of bounds" about 4 minutes in, 2026-10-05). A fresh instance every
 * 50 decodes stays well clear; the decoded samples are unchanged. */
const RECYCLE_AFTER_DECODES = 50;
export interface MusicExcerpts { samples: Float32Array[]; durationSeconds: number; }
export interface MusicDecoder {
  durationSeconds: number;
  read: (start: number, seconds: number, sampleRate: number) => Promise<Float32Array>;
  close: () => void;
  snapshot?: () => DecodedMusicSnapshot | undefined;
}

/** Keep the compressed original and only a small decoded section in memory. */
export async function openMusicDecoder(blob: Blob, name: string, signal?: AbortSignal): Promise<MusicDecoder> {
  const { FFmpeg } = await import('@ffmpeg/ffmpeg');
  signal?.throwIfAborted();
  let ff = new FFmpeg();
  const decoded = new Map<number, Float32Array>();
  let shortDecode: Promise<void> | undefined;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true; decoded.clear();
    signal?.removeEventListener('abort', close); ff.terminate();
  };
  signal?.addEventListener('abort', close, { once: true });
  const timer = setTimeout(close, 120_000);
  const base = `${import.meta.env.BASE_URL}audio-runtime/`;
  const input = `input.${name.split('.').pop()?.replace(/[^a-z0-9]/gi, '') || 'audio'}`;
  try {
    const load = (instance = ff) => instance.load({ coreURL: `${base}ffmpeg-core.js`, wasmURL: `${base}ffmpeg-core.wasm`, classWorkerURL: `${base}worker.js` });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    // A close during buffering already ran terminate; loading now would start a worker nothing releases.
    signal?.throwIfAborted();
    if (closed) throw new Error('The audio decoder was closed.');
    await load();
    // writeFile transfers its buffer to the FFmpeg worker; keep the original for a fresh instance.
    await ff.writeFile(input, bytes.slice());
    let decodes = 0;
    const fresh = async () => {
      const next = new FFmpeg();
      try {
        await load(next); await next.writeFile(input, bytes.slice());
        signal?.throwIfAborted();
        if (closed) throw new Error('The audio decoder was closed.');
      } catch (error) { next.terminate(); throw error; }
      ff.terminate(); ff = next; decodes = 0;
    };
    await ff.ffprobe(['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', input, '-o', 'probe.json']);
    let durationSeconds = 0;
    let duration = 0;
    // This WASM build can return -1 even after writing valid probe JSON.
    // Validate the output itself; missing/invalid metadata keeps discovery mode.
    try {
      const probe = await ff.readFile('probe.json', 'utf8');
      duration = Number(JSON.parse(String(probe)).format?.duration);
    } catch { /* Some containers need decoding to discover their duration. */ }
    if (Number.isFinite(duration) && duration > 86400) throw new Error('Split recordings longer than 24 hours before analysis.');
    if (Number.isFinite(duration) && duration > 0) durationSeconds = duration;
    const readSamples = async (file: string, maxSamples = Infinity): Promise<Float32Array> => {
      const data = await ff.readFile(file);
      if (typeof data === 'string') throw new Error('No audio samples found.');
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
      const samples = new Float32Array(Math.min(Math.floor(data.byteLength / 4), maxSamples));
      for (let j = 0; j < samples.length; j++) samples[j] = view.getFloat32(j * 4, true);
      await ff.deleteFile(file);
      signal?.throwIfAborted();
      if (closed) throw new Error('The audio decoder was closed.');
      return samples;
    };
    const decodeShortClip = async () => {
      const timer = setTimeout(close, 120_000);
      try {
        // One input decoder feeds all model rates. FFmpeg retains the same
        // antialiasing/downmix filters; no JS resampler changes the model input.
        // Preserve the codec-tail flush at the 30-second boundary. Only clips
        // actually within the bound are retained; longer output falls back to
        // the original bounded section reader rather than truncating coverage.
        const outputs = MODEL_SAMPLE_RATES.flatMap(rate => [
          '-map', `[rate${rate}]`, '-t', String(SHORT_CLIP_SECONDS + 1), '-ac', '1',
          '-ar', String(rate), '-f', 'f32le', '-y', `decoded-${rate}.f32`,
        ]);
        const status = await ff.exec([
          '-i', input, '-filter_complex', '[0:a:0]asplit=3[rate16000][rate44100][rate48000]', ...outputs,
        ], 90_000);
        if (status !== 0) throw new Error('This audio could not be decoded for music analysis.');
        for (const rate of MODEL_SAMPLE_RATES) {
          const samples = await readSamples(`decoded-${rate}.f32`);
          signal?.throwIfAborted();
          if (closed) throw new Error('The audio decoder was closed.');
          decoded.set(rate, samples);
        }
        if (MODEL_SAMPLE_RATES.some(rate => decoded.get(rate)!.length > SHORT_CLIP_SECONDS * rate)) {
          decoded.clear();
        }
      } catch (error) { decoded.clear(); throw error; }
      finally { clearTimeout(timer); }
    };
    return {
      durationSeconds, close,
      snapshot: () => durationSeconds > 0 && durationSeconds <= SHORT_CLIP_SECONDS && decoded.size === 3
        ? { durationSeconds, rates: new Map(decoded) } : undefined,
      async read(start, seconds, sampleRate) {
        signal?.throwIfAborted();
        if (closed) throw new Error('The audio decoder was closed.');
        if (durationSeconds > 0 && durationSeconds <= SHORT_CLIP_SECONDS && MODEL_SAMPLE_RATES.includes(sampleRate)) {
          await (shortDecode ??= decodeShortClip());
          signal?.throwIfAborted();
          if (closed) throw new Error('The audio decoder was closed.');
          const samples = decoded.get(sampleRate);
          if (samples) {
            // Each request owns its buffer: sending it to the model worker must
            // not detach the retained PCM needed by the next check.
            const from = Math.max(0, Math.round(start * sampleRate));
            return samples.slice(from, Math.max(from, Math.round((start + seconds) * sampleRate)));
          }
        }
        // Unstick a hung instance for this window only. Closing would take down every model.
        let readTimer = setTimeout(() => { ff.terminate(); }, 120_000);
        const section = async () => {
          decodes++;
          // Flush delayed codec/resampler samples, then crop by sample count.
          // Never pad a genuinely short endpoint.
          const status = await ff.exec(['-ss', String(start), '-i', input, '-t', String(seconds + 1), '-map', '0:a:0', '-vn', '-ac', '1', '-ar', String(sampleRate), '-f', 'f32le', '-y', 'clip.f32'], 90_000);
          if (status !== 0) throw new Error('This audio could not be decoded for music analysis.');
          return await readSamples('clip.f32', Math.round(seconds * sampleRate));
        };
        try {
          try {
            if (decodes >= RECYCLE_AFTER_DECODES) await fresh();
            return await section();
          } catch (error) {
            signal?.throwIfAborted();
            if (closed) throw error;
            // A crashed instance fails every later call; retry this section once on a fresh one.
            clearTimeout(readTimer);
            readTimer = setTimeout(() => { ff.terminate(); }, 120_000);
            await fresh();
            return await section();
          }
        } finally { clearTimeout(readTimer); }
      },
    };
  } catch (error) { close(); throw error; }
  finally { clearTimeout(timer); }
}

export async function decodeMusicExcerpts(decoder: MusicDecoder): Promise<MusicExcerpts> {
  const duration = decoder.durationSeconds;
  const starts = duration > 60 ? [Math.max(0, duration * 0.1 - 10), duration * 0.5 - 10, Math.min(duration - 20, duration * 0.9 - 10)] : [0];
  const samples: Float32Array[] = [];
  for (const start of starts) samples.push(await decoder.read(start, starts.length === 1 ? 60 : 20, 44100));
  if (!samples.some(s => s.length)) throw new Error('No audio samples found.');
  return { samples, durationSeconds: duration || samples[0].length / 44100 };
}

/** Overlapping 10-second windows cover every section, with at most 65 seconds of PCM held at once. */
export async function* instrumentWindows(decoder: MusicDecoder) {
  const rate = 16000;
  for (let start = 0; start < (decoder.durationSeconds || 86400); start += 60) {
    const data = await decoder.read(start, 65, rate);
    const seconds = data.length / rate;
    if (!seconds) return;
    const last = seconds < 65 - 1 / rate || (decoder.durationSeconds > 0 && start + seconds >= decoder.durationSeconds - 1 / rate);
    const offsets = instrumentWindowStarts(seconds);
    for (const offset of offsets) {
      if (!last && offset >= 60) continue;
      const sample = data.slice(Math.round(offset * rate), Math.round(Math.min(seconds, offset + 10) * rate));
      yield { samples: sample, start: start + offset, end: start + offset + sample.length / rate };
    }
    if (last) return;
  }
}

export async function decodeMusic(blob: Blob, name: string, signal?: AbortSignal): Promise<MusicExcerpts> {
  const decoder = await openMusicDecoder(blob, name, signal);
  try { return await decodeMusicExcerpts(decoder); } finally { decoder.close(); }
}

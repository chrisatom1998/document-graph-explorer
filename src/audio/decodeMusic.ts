import { instrumentWindowStarts } from './instrumentEvidence';
export interface MusicExcerpts { samples: Float32Array[]; durationSeconds: number; }
export interface MusicDecoder {
  durationSeconds: number;
  read: (start: number, seconds: number, sampleRate: number) => Promise<Float32Array>;
  close: () => void;
}

/** Keep the compressed original and only a small decoded section in memory. */
export async function openMusicDecoder(blob: Blob, name: string, signal?: AbortSignal): Promise<MusicDecoder> {
  const { FFmpeg } = await import('@ffmpeg/ffmpeg');
  signal?.throwIfAborted();
  const ff = new FFmpeg();
  const close = () => { signal?.removeEventListener('abort', close); ff.terminate(); };
  signal?.addEventListener('abort', close, { once: true });
  const timer = setTimeout(close, 120_000);
  const base = `${import.meta.env.BASE_URL}audio-runtime/`;
  const input = `input.${name.split('.').pop()?.replace(/[^a-z0-9]/gi, '') || 'audio'}`;
  try {
    await ff.load({ coreURL: `${base}ffmpeg-core.js`, wasmURL: `${base}ffmpeg-core.wasm`, classWorkerURL: `${base}worker.js` });
    await ff.writeFile(input, new Uint8Array(await blob.arrayBuffer()));
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
    return {
      durationSeconds, close,
      async read(start, seconds, sampleRate) {
        signal?.throwIfAborted();
        const readTimer = setTimeout(close, 120_000);
        try {
          // FFmpeg can stop before flushing codec/resampler tail samples at -t.
          // Decode at most one extra second, then bound by sample count. This
          // retains the real endpoint without padding genuinely short audio.
          const status = await ff.exec(['-ss', String(start), '-i', input, '-t', String(seconds + 1), '-map', '0:a:0', '-vn', '-ac', '1', '-ar', String(sampleRate), '-f', 'f32le', '-y', 'clip.f32'], 90_000);
          if (status !== 0) throw new Error('This audio could not be decoded for music analysis.');
          const data = await ff.readFile('clip.f32');
          if (typeof data === 'string') throw new Error('No audio samples found.');
          const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
          const samples = new Float32Array(Math.min(Math.floor(data.byteLength / 4), Math.round(seconds * sampleRate)));
          for (let j = 0; j < samples.length; j++) samples[j] = view.getFloat32(j * 4, true);
          await ff.deleteFile('clip.f32');
          return samples;
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

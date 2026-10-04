/** Single-thread local decoder: no remote upload, COOP/COEP, or native install. */
export async function convertAudio(blob: Blob, name: string, signal?: AbortSignal): Promise<Blob> {
  const { FFmpeg } = await import('@ffmpeg/ffmpeg');
  signal?.throwIfAborted();
  const ffmpeg = new FFmpeg();
  const abort = () => ffmpeg.terminate();
  signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(abort, 120_000);
  const base = `${import.meta.env.BASE_URL}audio-runtime/`;
  const extension = name.split('.').pop()?.replace(/[^a-zA-Z0-9]/g, '') || 'audio';
  const input = `input.${extension}`;
  try {
    await ffmpeg.load({ coreURL: `${base}ffmpeg-core.js`, wasmURL: `${base}ffmpeg-core.wasm`, classWorkerURL: `${base}worker.js` });
    await ffmpeg.writeFile(input, new Uint8Array(await blob.arrayBuffer()));
    const code = await ffmpeg.exec(['-i', input, '-map', '0:a:0', '-vn', '-ac', '2', '-ar', '44100', '-c:a', 'pcm_s16le', 'output.wav'], 120_000);
    if (code !== 0) throw new Error('This file could not be decoded. It may use an unsupported codec, be damaged, or be protected.');
    const data = await ffmpeg.readFile('output.wav');
    if (typeof data === 'string') throw new Error('Audio conversion returned no audio.');
    return new Blob([new Uint8Array(data).buffer], { type: 'audio/wav' });
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
    ffmpeg.terminate();
  }
}

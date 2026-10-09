import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { copilotWave, TRANSCRIPTION_RATE } from '../../src/audio/copilotWave';
import { LISTENING_SECONDS } from '../../src/audio/copilotListening';

export function listeningExcerpt(file: string, seconds: number): Buffer {
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > LISTENING_SECONDS) throw Error('Expected an excerpt of at most 10 seconds.');
  // FFmpeg WAV files contain extra chunks, while the provider boundary accepts
  // only our canonical 44-byte header. Decode PCM and use the browser's encoder.
  const pcm = execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-i', resolve(file), '-t', String(seconds),
    '-map', '0:a:0', '-vn', '-ac', '1', '-ar', String(TRANSCRIPTION_RATE), '-f', 'f32le', 'pipe:1'],
  { stdio: ['ignore', 'pipe', 'pipe'], timeout: 90_000, maxBuffer: LISTENING_SECONDS * TRANSCRIPTION_RATE * 4 + 4096 });
  if (pcm.length % 4) throw Error('Invalid decoded PCM.');
  const samples = new Float32Array(Math.min(pcm.length / 4, Math.round(seconds * TRANSCRIPTION_RATE)));
  for (let i = 0; i < samples.length; i++) samples[i] = pcm.readFloatLE(i * 4);
  return Buffer.from(copilotWave(samples));
}

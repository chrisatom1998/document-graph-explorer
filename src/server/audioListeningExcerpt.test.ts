import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { listeningExcerpt } from '../../scripts/audio-listening/excerpt';
import { reviewAudio } from './gptAudioReview';

it.skipIf(spawnSync('ffmpeg', ['-version']).status !== 0)('passes real FFmpeg excerpts through provider validation without a live API call', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'dge-excerpt-test-'));
  try {
    for (const seconds of [0.25, 10]) {
      const source = join(temp, 'source.wav');
      execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`, source]);
      const bytes = listeningExcerpt(source, seconds);
      const create = vi.fn(async () => ({ id: 'mock', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ answer: 'Synthetic tone.', suggestions: [] }) } }] }));
      const sample = { ref: 'Sample 1', durationSeconds: seconds, analyzedSeconds: seconds, preview: false,
        tempo: null, key: null, confirmedTags: null, confirmedInstruments: null, estimates: [], filenameHints: { bpm: null, key: null } };
      const report = await reviewAudio({ chat: { completions: { create } } } as never, [sample],
        [{ ref: 'Sample 1', wav: bytes.toString('base64') }], 'Listen', new AbortController().signal);
      expect(create).toHaveBeenCalledOnce();
      expect(bytes.length).toBe(44 + seconds * 16000 * 2);
      expect(report.listening[0].durationSeconds).toBe(seconds);
    }
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

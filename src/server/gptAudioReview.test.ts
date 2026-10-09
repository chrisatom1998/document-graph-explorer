import { describe, expect, it, vi } from 'vitest';
import { parseListeningClips, reviewAudio } from './gptAudioReview';
import { copilotWave } from '../audio/copilotWave';
import type { CopilotSample } from '../audio/copilotEvidence';

const sample: CopilotSample = { ref: 'Sample 1', durationSeconds: 30, analyzedSeconds: 30, preview: false,
  tempo: { bpm: 128, confidence: .9 }, key: null, confirmedTags: null, confirmedInstruments: null,
  estimates: [{ label: 'piano', score: .9 }], filenameHints: { bpm: 140, key: null } };
const clip = (seconds = 1) => ({ ref: 'Sample 1', wav: Buffer.from(copilotWave(new Float32Array(seconds * 16000))).toString('base64') });
const tags = { source: ['voice'], production: ['vocal chops'], character: [] };
const response = (body: unknown, finish_reason = 'stop') => ({ id: 'chat-audio', choices: [{ finish_reason, message: { content: JSON.stringify(body) } }] });
const review = (create: ReturnType<typeof vi.fn>, samples = [sample], clips = [clip()]) => reviewAudio({ chat: { completions: { create } } } as never, samples, clips, 'What is audible?', new AbortController().signal);

describe('GPT-Audio-1.5 listening', () => {
  it('uses real WAV input, text-only output, existing credentials, and no filename or detector hints', async () => {
    const create = vi.fn(async () => response({ answer: 'A chopped voice is audible in the excerpt.', suggestions: [{ ref: 'Sample 1', tags }] }));
    const result = await review(create);
    const [request, options] = create.mock.calls[0] as unknown as [any, any];
    expect(request).toMatchObject({ model: 'gpt-audio-1.5', modalities: ['text'], store: false });
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(request).not.toHaveProperty('response_format');
    expect(request).not.toHaveProperty('audio');
    const content = request.messages[1].content;
    expect(JSON.parse(content[0].text)).toEqual({ question: 'What is audible?', samples: [{ ref: 'Sample 1', confirmedTags: null, confirmedInstruments: null }] });
    expect(content[2]).toEqual({ type: 'input_audio', input_audio: { data: clip().wav, format: 'wav' } });
    expect(result).toMatchObject({ model: 'gpt-audio-1.5', suggestions: [{ ref: 'Sample 1', tags }], listening: [{ ref: 'Sample 1', startSeconds: 0, durationSeconds: 1 }] });
  });
  it('rejects missing, oversized, mismatched, noncanonical, or malformed audio before any API call', async () => {
    const create = vi.fn();
    for (const clips of [[], [clip(11)], [{ ...clip(), ref: 'Sample 2' }], [{ ...clip(), wav: clip().wav + '\n' }], [{ ...clip(), wav: Buffer.from('not wav').toString('base64') }]]) {
      await expect(review(create, [sample], clips)).rejects.toThrow();
    }
    expect(create).not.toHaveBeenCalled();
    expect(parseListeningClips([clip(10)], [sample]).listening[0].durationSeconds).toBe(10);
  });
  it('requires a completed answer and validates model tags and aliases', async () => {
    const create = vi.fn();
    for (const body of [
      response({ answer: 'Cut off', suggestions: [] }, 'length'),
      response({ answer: '', suggestions: [] }),
      response({ answer: 'bad label', suggestions: [{ ref: 'Sample 1', tags: { ...tags, source: ['invented'] } }] }),
      response({ answer: 'wrong sample', suggestions: [{ ref: 'Sample 2', tags }] }),
      { choices: [{ finish_reason: 'stop', message: { content: 'not JSON' } }] },
    ]) {
      create.mockResolvedValueOnce(body);
      await expect(review(create)).rejects.toThrow();
    }
  });
  it('preserves positive and explicitly empty corrections even if the model ignores instructions', async () => {
    const create = vi.fn(async () => response({ answer: 'Voice.', suggestions: [{ ref: 'Sample 1', tags }] }));
    for (const confirmedTags of [[], ['piano']]) {
      expect((await review(create, [{ ...sample, confirmedTags }])).suggestions).toEqual([]);
    }
    const result = await review(create, [{ ...sample, confirmedInstruments: ['piano'] }]);
    expect(result.suggestions).toEqual([{ ref: 'Sample 1', tags: { ...tags, source: [] } }]);
  });
});

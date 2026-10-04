import { afterEach, describe, expect, it, vi } from 'vitest';
import { llmStream } from './llmClient';

const target = { provider: 'openrouter' as const, apiKey: 'test-key', model: 'test-model' };
const partialEvent = 'data: {"choices":[{"delta":{"content":"Partial answer"}}]}\n\n';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('LLM stream failures', () => {
  it('does not restart generation after a partial answer disconnects', async () => {
    const read = vi.fn()
      .mockResolvedValueOnce({ done: false, value: new TextEncoder().encode(partialEvent) })
      .mockRejectedValueOnce(new Error('socket disconnected'));
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      body: { getReader: () => ({ read }) },
    } as unknown as Response);
    const onChunk = vi.fn();

    await expect(llmStream(target, 'document', 'question', onChunk)).resolves.toEqual({
      ok: false,
      error: 'Network error: socket disconnected',
      partialText: 'Partial answer',
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(onChunk).toHaveBeenCalledWith('Partial answer');
  });

  it('retains partial text without treating a provider error event as success', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      `${partialEvent}data: {"error":{"message":"generation failed"}}\n\ndata: [DONE]\n\n`,
    ));

    await expect(llmStream(target, 'document', 'question')).resolves.toEqual({
      ok: false,
      error: 'OpenRouter stream failed: generation failed',
      partialText: 'Partial answer',
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('still retries a transient network failure before output arrives', async () => {
    vi.useFakeTimers();
    const fetch = vi.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('connection reset'))
      .mockResolvedValueOnce(new Response(`${partialEvent}data: [DONE]\n\n`));
    const result = llmStream(target, 'document', 'question');
    await vi.advanceTimersByTimeAsync(1000);

    await expect(result).resolves.toEqual({ ok: true, text: 'Partial answer' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

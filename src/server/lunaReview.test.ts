import { describe, expect, it, vi } from 'vitest';
import { sample } from '../audio/lunaEvidence.fixture';
import { createLunaReviewer } from './lunaReview';
import { LUNA_MODEL } from '../audio/lunaEvidence';
const complete = () => ({ status: 'completed', output_text: JSON.stringify({ samples: [{ ref: 'Sample 1', normalizations: [{ id: 'e2', canonicalLabel: null }], review: 'recommend', reason: 'The keys label is ambiguous.' }] }), usage: { input_tokens: 100, output_tokens: 40, input_tokens_details: { cached_tokens: 0 } } });
const signal = () => new AbortController().signal;
describe('bounded Luna provider', () => {
  it('uses server Responses structured output, no audio, caches and preserves token usage', async () => {
    const create = vi.fn(async () => complete());
    const review = createLunaReviewer({ responses: { create } } as never);
    expect((await review([sample], signal())).usage).toEqual({ inputTokens: 100, outputTokens: 40, cachedInputTokens: 0 });
    expect((await review([sample], signal())).cached).toBe(true);
    expect(create).toHaveBeenCalledOnce();
    expect(create.mock.calls[0]).toBeDefined();
    const args = (create.mock.calls as unknown[][])[0][0] as Record<string, unknown>;
    expect(args).toMatchObject({ model: LUNA_MODEL, store: false, text: { format: { type: 'json_schema', strict: true } } });
    expect(JSON.stringify(args)).not.toContain('input_audio');
  });
  it('skips the API for fully locked fields', async () => {
    const create = vi.fn(); const review = createLunaReviewer({ responses: { create } } as never);
    await review([{ ...sample, locked: { source: true, production: true, character: true } }], signal());
    expect(create).not.toHaveBeenCalled();
  });
  it('counts failures against the request budget and never surfaces provider secrets', async () => {
    const create = vi.fn(async () => { throw Error('secret-key provider body'); });
    const review = createLunaReviewer({ responses: { create } } as never, { maxRequests: 1 });
    const first = await review([sample], signal()), second = await review([sample], signal());
    expect(first.status).toBe('fallback'); expect(first.samples[0].labels[0].canonicalLabel).toBe('voice');
    expect(JSON.stringify(first)).not.toContain('secret-key'); expect(second.samples[0].reason).toContain('budget');
    expect(create).toHaveBeenCalledOnce();
  });
  it('bounds concurrency, times out non-cooperative requests and rejects incomplete output', async () => {
    const create = vi.fn(() => new Promise(() => {}));
    const review = createLunaReviewer({ responses: { create } } as never, { concurrency: 1, timeoutMs: 10 });
    const first = review([sample], signal());
    expect((await review([sample], signal())).samples[0].reason).toContain('busy');
    expect((await first).status).toBe('fallback');
    const malformed = createLunaReviewer({ responses: { create: async () => ({ ...complete(), status: 'incomplete' }) } } as never);
    expect((await malformed([sample], signal())).status).toBe('fallback');
  });
  it('keeps a completed review when cached token details are absent', async () => {
    const create = vi.fn(async () => ({ status: 'completed', output_text: JSON.stringify({ samples: [{ ref: 'Sample 1', normalizations: [{ id: 'e2', canonicalLabel: 'piano' }], review: 'recommend', reason: 'The keys label is ambiguous.' }] }), usage: { input_tokens: 100, output_tokens: 40 } }));
    const review = createLunaReviewer({ responses: { create } } as never, { maxRequests: 1 });
    const report = await review([sample], signal());
    expect(report.status).toBe('complete');
    expect(report.samples[0].labels[1]).toMatchObject({ canonicalLabel: 'piano', method: 'luna' });
    expect(report.usage).toEqual({ inputTokens: 100, outputTokens: 40, cachedInputTokens: 0 });
    expect((await review([sample], signal())).cached).toBe(true);
    expect(create).toHaveBeenCalledOnce();
  });
  it('invalidates cached results when source evidence or coverage changes', async () => {
    const create = vi.fn(async () => complete()); const review = createLunaReviewer({ responses: { create } } as never);
    await review([sample], signal());
    await review([{ ...sample, labels: sample.labels.map(l => ({ ...l, coverage: [{ start: 0, end: 8 }] })) }], signal());
    expect(create).toHaveBeenCalledTimes(2);
  });
});

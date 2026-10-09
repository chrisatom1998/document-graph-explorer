import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCopilotHandler, openAiCopilot, type CopilotBackend } from './djCopilot';
import { copilotWave } from '../audio/copilotWave';

const sample = { ref: 'Sample 1', durationSeconds: 2, analyzedSeconds: 2, preview: false, tempo: null, key: null,
  confirmedTags: [], confirmedInstruments: null, estimates: [], filenameHints: { bpm: null, key: null } };
const servers: Server[] = [];
afterEach(async () => { for (const server of servers.splice(0)) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } });
async function start(backend: CopilotBackend) {
  const handler = createCopilotHandler('private-test-key', backend);
  const server = createServer((req, res) => { void handler(req, res); }); servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw Error();
  const origin = `http://127.0.0.1:${address.port}`;
  return (path = '/review', body: BodyInit = JSON.stringify({ samples: [sample], question: 'Review' }), headers = {}) => fetch(origin + path, {
    method: 'POST', headers: { Origin: origin, 'X-DJ-Assistant': '1', 'Content-Type': 'application/json', ...headers }, body,
  });
}
function backend(): CopilotBackend {
  return { review: vi.fn(async () => ({ answer: 'No confirmed labels.', model: 'test', sessionId: 's', turnId: 't' })), transcribe: vi.fn(async () => 'hello') };
}
describe('copilot server', () => {
  it('routes validated listening excerpts and blocks invalid audio and cross-origin uploads', async () => {
    const service = backend();
    service.audioReview = vi.fn(async () => ({ answer: 'An excerpt review.', model: 'gpt-audio-1.5', sessionId: '', turnId: 'chat' }));
    const post = await start(service);
    const clips = [{ ref: 'Sample 1', wav: Buffer.from(copilotWave(new Float32Array(16000))).toString('base64') }];
    const body = JSON.stringify({ samples: [sample], question: 'Listen', clips });
    expect((await post('/review-audio', body, { Origin: 'https://evil.example' })).status).toBe(403);
    expect((await post('/review-audio', JSON.stringify({ samples: [sample], question: 'Listen', clips: [] }))).status).toBe(400);
    expect(service.audioReview).not.toHaveBeenCalled();
    expect((await post('/review-audio', body)).status).toBe(200);
    expect(service.audioReview).toHaveBeenCalledWith([sample], clips, 'Listen', expect.any(AbortSignal));
    expect(service.review).not.toHaveBeenCalled();
  });
  it('rejects oversized listening bodies before contacting the provider', async () => {
    const service = backend(); const post = await start(service);
    expect((await post('/review-audio', ' '.repeat(2_200_000))).status).toBe(413);
    expect(service.review).not.toHaveBeenCalled();
  });
  it('routes fast reviews separately from hosted agent reviews', async () => {
    const service = backend();
    service.fastReview = vi.fn(async () => ({ answer: 'Fast evidence review.', model: 'gpt-6-astra', sessionId: '', turnId: 'response' }));
    const post = await start(service);
    expect((await post('/review-fast')).status).toBe(200);
    expect(service.fastReview).toHaveBeenCalledWith([sample], 'Review', expect.any(AbortSignal));
    expect(service.review).not.toHaveBeenCalled();
  });
  it('uses Astra Ultrafast with non-stored structured responses and protects confirmed fields', async () => {
    const create = vi.fn(async () => ({ id: 'response', status: 'completed', output_text: JSON.stringify({ answer: 'No confirmed labels.', suggestions: [{ ref: 'Sample 1', tags: { source: ['voice'], production: [], character: [] } }] }) }));
    const service = openAiCopilot('test', { responses: { create } } as never);
    const result = await service.fastReview!([sample], 'Review', new AbortController().signal);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ model: 'gpt-6-astra', service_tier: 'ultrafast', store: false }), expect.anything());
    expect(result.suggestions).toEqual([]);
  });
  it('validates and strips extraneous fields before sending evidence upstream', async () => {
    const service = backend(); const post = await start(service);
    const response = await post('/review', JSON.stringify({ samples: [{ ...sample, path: 'private', ref: 'private' }], question: 'Review', apiKey: 'secret' }));
    expect(response.status).toBe(200);
    expect(service.review).toHaveBeenCalledWith([sample], 'Review', expect.any(AbortSignal));
    expect(await response.text()).not.toContain('private-test-key');
  });
  it('blocks cross-origin and malformed requests without running the agent', async () => {
    const service = backend(); const post = await start(service);
    expect((await post('/review', '{}', { Origin: 'https://evil.example' })).status).toBe(403);
    expect((await post('/review', JSON.stringify({ samples: Array(6).fill(sample), question: 'Review' }))).status).toBe(400);
    expect((await post('/review', '{')).status).toBe(400);
    expect(service.review).not.toHaveBeenCalled();
  });
  it('does not reveal upstream exceptions or credentials', async () => {
    const service = backend(); service.review = vi.fn(async () => { throw Error('private-test-key secret-provider-body'); });
    const post = await start(service); const response = await post();
    expect(response.status).toBe(502);
    expect(await response.text()).not.toMatch(/private-test-key|secret-provider-body/);
  });
  it('transcribes only a validated bounded audio excerpt', async () => {
    const service = backend(); const post = await start(service);
    expect((await post('/transcribe', new Uint8Array(60), { 'Content-Type': 'audio/wav' })).status).toBe(400);
    expect(service.transcribe).not.toHaveBeenCalled();
    const response = await post('/transcribe', copilotWave(new Float32Array(16000)), { 'Content-Type': 'audio/wav' });
    expect(await response.json()).toMatchObject({ text: 'hello', seconds: 1, model: 'gpt-transcribe' });
    expect(service.transcribe).toHaveBeenCalledOnce();
  });
  it('allows only one active request at a time', async () => {
    const service = backend(); let release!: () => void;
    service.review = vi.fn(async () => { await new Promise<void>(r => { release = r; }); return { answer: 'done', model: 'test', sessionId: 's', turnId: 't' }; });
    const post = await start(service); const first = post();
    await vi.waitFor(() => expect(service.review).toHaveBeenCalledOnce());
    expect((await post()).status).toBe(429); release(); expect((await first).status).toBe(200);
  });
});

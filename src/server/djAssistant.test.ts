import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSampleHandler } from './djAssistant';
import { EMPTY_SAMPLE_QUERY } from '../audio/sampleSearch';
const servers: Server[] = [];
afterEach(async () => { for (const server of servers.splice(0)) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } });
async function start(upstream: typeof fetch, key = 'private-test-credential') {
  const handler = createSampleHandler(key, upstream);
  const server = createServer((req, res) => { void handler(req, res); }); servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw Error('No port');
  const origin = `http://127.0.0.1:${address.port}`;
  return (body: unknown = { query: 'short clips', hasReference: false }, extraHeaders = {}) => fetch(origin, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'X-DJ-Assistant': '1', ...extraHeaders }, body: JSON.stringify(body) });
}
describe('local DJ assistant boundary', () => {
  it('executes only the supported tool and sends no library data to OpenAI', async () => {
    const upstream = vi.fn(async () => Response.json({ status: 'completed', output: [{ type: 'function_call', name: 'search_samples', arguments: JSON.stringify(EMPTY_SAMPLE_QUERY) }] }));
    const post = await start(upstream);
    const response = await post({ query: 'short clips', hasReference: false, secretPath: '/should/not/send', nodes: ['private'] });
    expect(response.status).toBe(200);
    expect((await response.json()).plan).toEqual(EMPTY_SAMPLE_QUERY);
    const args = (upstream.mock.calls as unknown as [string, RequestInit][])[0];
    const body = JSON.parse(args[1].body as string);
    expect(body.model).toBe('gpt-6-astra');
    expect(body.service_tier).toBe('ultrafast');
    expect(body.store).toBe(false);
    expect(body.tool_choice.name).toBe('search_samples');
    expect(body.input).not.toContain('private');
    expect(body.input).not.toContain('secretPath');
  });
  it('blocks cross-origin requests before API use', async () => {
    const upstream = vi.fn(); const post = await start(upstream);
    expect((await post(undefined, { Origin: 'https://evil.example' })).status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
  });
  it('rejects malformed constraints before API use', async () => {
    const upstream = vi.fn(); const post = await start(upstream);
    expect((await post({ query: 'clips', hasReference: false, previous: { terms: [] } })).status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });
  it('does not leak upstream errors or credentials', async () => {
    const post = await start(vi.fn(async () => new Response('private-test-credential sensitive', { status: 401 })));
    const response = await post();
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain('private-test-credential');
  });
  it.each([
    [{ code: 'credit_balance_exhausted', type: 'insufficient_quota' }, 'Add credits in OpenAI API billing'],
    [{ code: 'insufficient_quota' }, 'Check API billing and usage limits'],
    [{ type: 'insufficient_quota' }, 'Check API billing and usage limits'],
    [{ code: 'rate_limit_exceeded' }, 'Wait briefly, then retry'],
  ])('distinguishes billing failures from temporary limits: %j', async (error, expected) => {
    const post = await start(vi.fn(async () => Response.json({ error: { ...error, message: 'private-test-credential' } }, { status: 429 })));
    const response = await post();
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.error).toContain(expected);
    expect(body.error).toContain('Local filters still work.');
    expect(body.error).not.toContain('private-test-credential');
  });
  it('rejects truncated model output instead of using partial filters', async () => {
    const post = await start(vi.fn(async () => Response.json({ status: 'incomplete', output: [] })));
    expect((await post()).status).toBe(502);
  });
  it('reports missing local configuration without contacting the API', async () => {
    const upstream = vi.fn(); const post = await start(upstream, '');
    expect((await post()).status).toBe(503);
    expect(upstream).not.toHaveBeenCalled();
  });
});

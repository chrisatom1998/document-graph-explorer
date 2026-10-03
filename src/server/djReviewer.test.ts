import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createReviewerHandler } from './djReviewer';
const servers: Server[] = [];
afterEach(async () => { for (const server of servers.splice(0)) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } });
async function setup(upstream: typeof fetch) {
  const start = vi.fn(async () => {});
  const handler = createReviewerHandler(upstream, start);
  const server = createServer((req, res) => { void handler(req, res); }); servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const origin = `http://127.0.0.1:${port}`;
  return { start, origin, post: (path = '/packs', override = {}) => fetch(origin + path, { method: 'POST', headers: { Origin: origin, 'X-DJ-Assistant': '1', 'Content-Type': 'application/json', ...override }, body: JSON.stringify({ packId: 'freepats-synth' }) }) };
}
describe('reviewer bridge', () => {
  it('allows browser same-origin progress GETs without an Origin header', async () => {
    const upstream = vi.fn(async () => Response.json({ state: 'running' }));
    const { origin } = await setup(upstream);
    const response = await fetch(`${origin}/jobs/${'a'.repeat(24)}`, { headers: { 'X-DJ-Assistant': '1', 'Sec-Fetch-Site': 'same-origin' } });
    expect(response.status).toBe(200);
    expect((await response.json()).state).toBe('running');
    expect((await fetch(`${origin}/jobs/${'a'.repeat(24)}`, { headers: { 'X-DJ-Assistant': '1', 'Sec-Fetch-Site': 'cross-site' } })).status).toBe(403);
  });
  it('uses the reviewer token only server-side and forwards imports to the fixed local service', async () => {
    const upstream = vi.fn().mockResolvedValueOnce(Response.json({ packImportVersion: 1, token: 'private-review-token' })).mockResolvedValueOnce(Response.json({ jobId: 'a'.repeat(24) }, { status: 202 }));
    const { post } = await setup(upstream);
    const response = await post();
    expect(response.status).toBe(202);
    expect(await response.text()).not.toContain('private-review-token');
    expect(upstream.mock.calls[1][0]).toBe('http://127.0.0.1:8766/api/packs');
    expect(upstream.mock.calls[1][1].headers['X-Review-Token']).toBe('private-review-token');
  });
  it('blocks cross-origin requests without starting the reviewer', async () => {
    const upstream = vi.fn(); const { post, start } = await setup(upstream);
    expect((await post('/packs', { Origin: 'https://other.example' })).status).toBe(403);
    expect(start).not.toHaveBeenCalled(); expect(upstream).not.toHaveBeenCalled();
  });
  it('explains when the running reviewer needs to be restarted', async () => {
    const { post } = await setup(vi.fn(async () => Response.json({ token: 'old-token' })));
    expect((await (await post()).json()).error).toContain('Restart the reviewer');
  });
  it('starts an unavailable reviewer before importing', async () => {
    const upstream = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(Response.json({ packImportVersion: 1, token: 'token' })).mockResolvedValueOnce(Response.json({ jobId: 'a'.repeat(24) }, { status: 202 }));
    const { post, start } = await setup(upstream);
    expect((await post()).status).toBe(202); expect(start).toHaveBeenCalledOnce();
  });
});

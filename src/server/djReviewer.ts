import type { IncomingMessage, ServerResponse } from 'node:http';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';
import { isLocalRequest } from './djAssistant';

const ORIGIN = 'http://127.0.0.1:8766';
const MAX_ARCHIVE = 100 * 1024 * 1024;
const pause = (ms: number) => new Promise<void>(done => setTimeout(done, ms));
let starting: Promise<void> | null = null;
async function startReviewer() {
  if (!starting) starting = (async () => {
    const child = spawn('python3', [resolve('scripts/dj-review-server.py')], { cwd: process.cwd(), detached: true, stdio: 'ignore', env: { ...process.env, DJ_REVIEW_PORT: '8766' } });
    await new Promise<void>((done, reject) => { child.once('spawn', done); child.once('error', reject); });
    child.unref();
    for (let i = 0; i < 20; i++) {
      await pause(200);
      try { if ((await fetch(`${ORIGIN}/api/state`, { signal: AbortSignal.timeout(500) })).ok) return; } catch { /* Wait for local startup. */ }
    }
    throw new Error('Could not start the reviewer. Run npm run review:sounds in the project folder.');
  })().finally(() => { starting = null; });
  return starting;
}

function reply(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

export function createReviewerHandler(request: typeof fetch = fetch, start: () => Promise<void> = startReviewer) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    if (!isLocalRequest(req, true)) return reply(res, 403, { error: 'Open pack import from the local app.' });
    const url = new URL(req.url ?? '/', ORIGIN);
    const isJob = /^\/jobs\/[a-f0-9]{24}$/.test(url.pathname);
    const isImport = ['/packs', '/archive'].includes(url.pathname);
    if (!isJob && !isImport) return reply(res, 404, { error: 'Unknown reviewer action.' });
    if (req.method !== (isJob ? 'GET' : 'POST')) return reply(res, 405, { error: 'Unsupported method.' });
    try {
      if (isJob) {
        const response = await request(`${ORIGIN}/api${url.pathname}`, { signal: AbortSignal.timeout(5000) });
        return reply(res, response.status, await response.json());
      }
      const limit = url.pathname === '/archive' ? MAX_ARCHIVE : 4096;
      if (Number(req.headers['content-length']) > limit) return reply(res, 413, { error: 'Choose an archive under 100 MB.' });
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > limit) return reply(res, 413, { error: 'Import request is too large.' });
        chunks.push(Buffer.from(chunk));
      }
      if (!size) return reply(res, 400, { error: 'Choose a pack or archive to import.' });
      let stateResponse: Response;
      try { stateResponse = await request(`${ORIGIN}/api/state`, { signal: AbortSignal.timeout(3000) }); }
      catch { await start(); stateResponse = await request(`${ORIGIN}/api/state`, { signal: AbortSignal.timeout(3000) }); }
      if (!stateResponse.ok) throw new Error('Reviewer is unavailable. Open http://127.0.0.1:8766/ to check it.');
      const state = await stateResponse.json();
      if (state.packImportVersion !== 1) throw new Error('Restart the reviewer with npm run review:sounds to enable pack imports.');
      const path = url.pathname === '/archive' ? `/api/pack-archive${url.search}` : '/api/packs';
      const response = await request(ORIGIN + path, { method: 'POST', headers: { Origin: ORIGIN, 'X-Review-Token': state.token, 'Content-Type': url.pathname === '/archive' ? 'application/octet-stream' : 'application/json' }, body: Buffer.concat(chunks), signal: AbortSignal.timeout(30000) });
      return reply(res, response.status, await response.json());
    } catch (error) {
      return reply(res, 502, { error: error instanceof Error && /^(Could not start|Reviewer is|Restart the reviewer)/.test(error.message) ? error.message : 'Could not connect to the reviewer. Check http://127.0.0.1:8766/ and try again. If an import already started, check its saved progress before retrying.' });
    }
  };
}

export function djReviewerPlugin(): Plugin {
  return { name: 'local-dj-reviewer', apply: 'serve', configureServer(server) {
    const handler = createReviewerHandler();
    server.middlewares.use('/api/dj-reviewer', (req, res) => { void handler(req, res); });
  } };
}

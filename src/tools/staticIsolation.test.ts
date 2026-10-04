import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { once } from 'node:events';
// @ts-expect-error - shared launcher implementation is plain CJS.
import { createRequestHandler } from '../../scripts/staticServer.cjs';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, {recursive:true,force:true}); });

class ResponseCapture extends Writable {
  headers: Record<string, string> = {};
  status = 0;
  body = '';
  headersSent = false;
  setHeader(name: string, value: string) { this.headers[name.toLowerCase()] = value; }
  writeHead(status: number, headers: Record<string, string>) {
    this.status = status; this.headersSent = true;
    for (const [name, value] of Object.entries(headers)) this.setHeader(name, value);
  }
  override _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error) => void) {
    this.body += chunk.toString(); callback();
  }
}

it('serves isolation headers on both the page and nested model workers without changing content or MIME', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dge-isolation-')); roots.push(root);
  writeFileSync(join(root, 'index.html'), '<html>app</html>');
  writeFileSync(join(root, 'worker.mjs'), 'export const model = true;');
  const handler = createRequestHandler(root, {headers:{'X-Content-Type-Options':'nosniff'}});
  for (const [url, contentType, body] of [
    ['/', 'text/html; charset=utf-8', '<html>app</html>'],
    ['/worker.mjs', 'text/javascript; charset=utf-8', 'export const model = true;'],
  ]) {
    const response = new ResponseCapture(); const finished = once(response, 'finish');
    handler({url}, response); await finished;
    expect(response.status).toBe(200);
    expect(response.headers).toMatchObject({
      'cross-origin-opener-policy':'same-origin', 'cross-origin-embedder-policy':'require-corp',
      'content-type':contentType, 'x-content-type-options':'nosniff',
    });
    expect(response.body).toBe(body);
  }
});

it('allows explicit host isolation overrides while keeping traversal protection', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dge-isolation-')); roots.push(root);
  const handler = createRequestHandler(root, {headers:{'Cross-Origin-Embedder-Policy':'unsafe-none'}});
  const response = new ResponseCapture(); const finished = once(response, 'finish');
  handler({url:'/../secret.txt'}, response); await finished;
  expect(response.status).toBe(403);
  expect(response.headers['cross-origin-embedder-policy']).toBe('unsafe-none');
});

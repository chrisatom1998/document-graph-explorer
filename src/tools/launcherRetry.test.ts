import { createServer, type Server } from 'node:http';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { spawn } from 'node:child_process';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => ({ on: vi.fn(), unref: vi.fn() })),
}));

const require = createRequire(import.meta.url);
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    server.close(() => resolve());
  })));
  vi.restoreAllMocks();
  vi.mocked(spawn).mockClear();
});

it.each(['node', 'exe'])('%s launcher opens only the actual server after a port conflict', async (launcher) => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  const blocker = createServer();
  servers.push(blocker);
  await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', resolve));
  const occupiedPort = (blocker.address() as { port: number }).port;
  const appServer = createServer();
  servers.push(appServer);
  const listening = new Promise<void>((resolve) => appServer.once('listening', resolve));

  if (launcher === 'node') {
    const { listen } = await import(new URL('../../scripts/serve.mjs', import.meta.url).href);
    listen(appServer, occupiedPort, 0);
  } else {
    runInNewContext(readFileSync('scripts/serve-exe.cjs', 'utf8'), {
      require: (id: string) => {
        if (id === 'node:http') return { createServer: () => appServer };
        if (id === 'node:fs') return { existsSync: () => true };
        if (id === 'node:child_process') return { spawn };
        if (id === './staticServer.cjs') return { createRequestHandler: () => () => {} };
        return require(id);
      },
      __dirname: path.resolve('scripts'),
      process: { argv: [], env: { PORT: String(occupiedPort) }, exit: vi.fn() },
      console,
    });
  }

  await listening;
  // The test listener runs first; allow all launcher callbacks to finish.
  await new Promise<void>((resolve) => setImmediate(resolve));
  const boundPort = (appServer.address() as { port: number }).port;
  expect(boundPort).not.toBe(occupiedPort);
  expect(spawn).toHaveBeenCalledTimes(1);
  const argumentsUsed = vi.mocked(spawn).mock.calls[0][1] as string[];
  expect(argumentsUsed).toContain(`http://127.0.0.1:${boundPort}/`);
  expect(argumentsUsed).not.toContain(`http://127.0.0.1:${occupiedPort}/`);
});

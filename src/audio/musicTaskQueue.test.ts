import { expect, it } from 'vitest';
import { MusicTaskQueue } from './musicTaskQueue';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
}

it('previews every waiting song before allowing two deeper checks', async () => {
  const queue = new MusicTaskQueue(2);
  const first = deferred();
  const second = deferred();
  const third = deferred();
  const deep = deferred();
  const started: string[] = [];
  const schedule = (priority: 'preview' | 'analysis', name: string, task: ReturnType<typeof deferred>) =>
    queue.schedule(priority, async () => { started.push(name); await task.promise; });
  const a = schedule('preview', 'preview A', first);
  const b = schedule('preview', 'preview B', second);
  const c = schedule('preview', 'preview C', third);
  const x = schedule('analysis', 'deep A', deep);
  const y = schedule('analysis', 'deep B', deep);
  const z = schedule('analysis', 'deep C', deep);
  await Promise.resolve();
  expect(started).toEqual(['preview A', 'preview B']);
  first.resolve();
  await a;
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(started).toEqual(['preview A', 'preview B', 'preview C']);
  second.resolve();
  await b;
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(started).toHaveLength(3); // The remaining preview owns the barrier.
  third.resolve();
  await c;
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(started).toEqual(['preview A', 'preview B', 'preview C', 'deep A', 'deep B']);
  deep.resolve();
  await Promise.all([x, y, z]);
  expect(started.at(-1)).toBe('deep C');
});

it('cancels a queued song promptly without ever opening its decoder', async () => {
  const queue = new MusicTaskQueue(1);
  const active = deferred();
  const running = queue.schedule('preview', () => active.promise);
  const controller = new AbortController();
  let opened = false;
  const queued = queue.schedule('preview', async () => { opened = true; }, controller.signal);
  const rejection = expect(queued).rejects.toMatchObject({ name: 'AbortError' });
  controller.abort();
  await rejection;
  active.resolve();
  await running;
  expect(opened).toBe(false);
});

it('continues the folder after a preview fails', async () => {
  const queue = new MusicTaskQueue(1);
  const failed = queue.schedule('preview', async () => { throw Error('Cannot decode'); });
  const next = queue.schedule('analysis', async () => 'next song');
  await expect(failed).rejects.toThrow('Cannot decode');
  expect(await next).toBe('next song');
});

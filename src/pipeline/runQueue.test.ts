import { describe, expect, it } from 'vitest';
import { enqueueRun } from './runQueue';

/** Resolves after a macrotask-ish delay so overlapping runs would actually overlap if unserialized. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('enqueueRun', () => {
  it('runs queued operations strictly in order, never overlapping', async () => {
    const events: string[] = [];
    let active = 0;
    let maxConcurrent = 0;

    const run = (label: string, ms: number): Promise<void> =>
      enqueueRun(async () => {
        active += 1;
        maxConcurrent = Math.max(maxConcurrent, active);
        events.push(`${label}:start`);
        await delay(ms);
        events.push(`${label}:end`);
        active -= 1;
      });

    // Enqueue out of "natural" timing order — a slower first job must still
    // fully finish before the faster second job starts.
    const a = run('a', 20);
    const b = run('b', 5);
    const c = run('c', 1);

    await Promise.all([a, b, c]);

    expect(maxConcurrent).toBe(1);
    expect(events).toEqual(['a:start', 'a:end', 'b:start', 'b:end', 'c:start', 'c:end']);
  });

  it("a rejected run doesn't wedge the queue — the next run still starts and completes", async () => {
    const events: string[] = [];

    const failing = enqueueRun(async () => {
      events.push('failing:start');
      throw new Error('boom');
    });
    const next = enqueueRun(async () => {
      events.push('next:start');
      return 'ok';
    });

    await expect(failing).rejects.toThrow('boom');
    await expect(next).resolves.toBe('ok');
    expect(events).toEqual(['failing:start', 'next:start']);
  });

  it('each call resolves with the return value of its own function', async () => {
    const first = enqueueRun(() => Promise.resolve(1));
    const second = enqueueRun(() => Promise.resolve('two'));
    await expect(first).resolves.toBe(1);
    await expect(second).resolves.toBe('two');
  });

  it('a run enqueued only after an earlier one settles still queues behind it', async () => {
    const events: string[] = [];
    await enqueueRun(async () => {
      events.push('first');
    });
    await enqueueRun(async () => {
      events.push('second');
    });
    expect(events).toEqual(['first', 'second']);
  });
});

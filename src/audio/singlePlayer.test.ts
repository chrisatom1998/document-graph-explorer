// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installSinglePlayer, trackPlayback } from './singlePlayer';

function player(): HTMLAudioElement {
  const el = document.createElement('audio');
  let paused = true;
  Object.defineProperty(el, 'paused', { get: () => paused });
  el.pause = () => { if (!paused) { paused = true; el.dispatchEvent(new Event('pause')); } };
  el.play = () => { paused = false; el.dispatchEvent(new Event('play')); return Promise.resolve(); };
  document.body.appendChild(el);
  return el;
}

describe('single player', () => {
  let uninstall: () => void;
  beforeEach(() => { uninstall = installSinglePlayer(); });
  afterEach(() => { uninstall(); document.body.innerHTML = ''; });

  it('pauses the first player when the second starts, and the reverse', async () => {
    const transport = player();
    const inspector = player();
    await transport.play();
    await inspector.play();
    expect(transport.paused).toBe(true);
    expect(inspector.paused).toBe(false);
    await transport.play();
    expect(inspector.paused).toBe(true);
    expect(transport.paused).toBe(false);
  });

  it('does not pause a player that already stopped on its own', async () => {
    const a = player();
    const b = player();
    await a.play();
    a.dispatchEvent(new Event('ended'));
    let paused = 0;
    a.pause = () => { paused += 1; };
    await b.play();
    expect(paused).toBe(0);
  });

  it('covers detached elements too', async () => {
    const attached = player();
    const detached = document.createElement('audio');
    let paused = true;
    Object.defineProperty(detached, 'paused', { get: () => paused });
    detached.pause = () => { paused = true; detached.dispatchEvent(new Event('pause')); };
    const untrack = trackPlayback(detached);
    paused = false; detached.dispatchEvent(new Event('play'));
    await attached.play();
    expect(paused).toBe(true);
    untrack();
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import { usePlayerStore } from './playerStore';

describe('playerStore', () => {
  beforeEach(() => usePlayerStore.getState().clear());

  it('restarts a clip that is played twice', () => {
    const { play } = usePlayerStore.getState();
    play('a', ['a', 'b']);
    const first = usePlayerStore.getState().playNonce;
    play('a');
    expect(usePlayerStore.getState().playNonce).toBe(first + 1);
    expect(usePlayerStore.getState().queue).toEqual(['a', 'b']);
  });

  it('steps through the queue and wraps', () => {
    const s = usePlayerStore.getState();
    s.play('a', ['a', 'b', 'c']);
    s.step(1); expect(usePlayerStore.getState().currentId).toBe('b');
    s.step(-1); s.step(-1); expect(usePlayerStore.getState().currentId).toBe('c');
    s.step(1); expect(usePlayerStore.getState().currentId).toBe('a');
  });

  it('does nothing with a single clip or none', () => {
    const s = usePlayerStore.getState();
    s.step(1);
    expect(usePlayerStore.getState().currentId).toBeNull();
    s.play('a', ['a']);
    s.step(1);
    expect(usePlayerStore.getState().currentId).toBe('a');
  });
});

import { create } from 'zustand';

/**
 * What the bottom transport is playing. The audio element lives in the
 * transport; cards and crates only say which clip to load (`play`) and the
 * ordered list that previous/next walk (`queue`).
 */
interface PlayerState {
  currentId: string | null;
  queue: string[];
  /** Bumped by every play request so re-playing the same clip restarts it. */
  playNonce: number;
  play: (id: string, queue?: string[]) => void;
  /** Load a clip without starting it. */
  select: (id: string, queue?: string[]) => void;
  step: (delta: 1 | -1) => void;
  clear: () => void;
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  currentId: null,
  queue: [],
  playNonce: 0,
  play: (id, queue) => set(s => ({ currentId: id, queue: queue ?? s.queue, playNonce: s.playNonce + 1 })),
  select: (id, queue) => set(s => ({ currentId: id, queue: queue ?? s.queue })),
  step: (delta) => {
    const { currentId, queue } = get();
    if (!currentId || queue.length < 2) return;
    const at = queue.indexOf(currentId);
    const next = queue[(Math.max(at, 0) + delta + queue.length) % queue.length];
    set(s => ({ currentId: next, playNonce: s.playNonce + 1 }));
  },
  clear: () => set({ currentId: null, queue: [] }),
}));

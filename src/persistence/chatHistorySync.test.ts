import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const history = vi.hoisted(() => ({
  loadChatHistory: vi.fn().mockResolvedValue([]),
  saveChatHistory: vi.fn().mockResolvedValue(undefined),
  deleteChatHistory: vi.fn().mockResolvedValue(undefined),
  chatTranscriptMarkdown: vi.fn(),
}));
vi.mock('./chatHistory', () => history);

import {
  _resetChatHistorySyncForTests,
  flushPendingChatSave,
  initChatHistorySync,
} from './chatHistorySync';
import { useChatStore } from '../store/chatStore';
import { useCorpusStore } from '../store/corpusStore';
import { useGraphStore } from '../store/graphStore';

const CORPUS_A = 'corpus-a';
const CORPUS_B = 'corpus-b';

function activateLocalCorpus(id: string): void {
  useCorpusStore.setState({ activeCorpusId: id, mode: 'local', switching: false });
}

beforeEach(() => {
  vi.useFakeTimers();
  useChatStore.setState({ messages: [], isStreaming: false });
  useGraphStore.setState({ phase: 'ready' });
  activateLocalCorpus(CORPUS_A);
  initChatHistorySync();
});

afterEach(() => {
  _resetChatHistorySyncForTests();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe('saving the transcript', () => {
  it('debounces a save against the active workspace', async () => {
    useChatStore.getState().addMessage({ role: 'user', text: 'hello' });
    await vi.advanceTimersByTimeAsync(400);

    expect(history.saveChatHistory).toHaveBeenCalledTimes(1);
    expect(history.saveChatHistory.mock.calls[0][0]).toBe(CORPUS_A);
  });

  it('never persists the cleared transcript against the outgoing workspace', async () => {
    useChatStore.getState().addMessage({ role: 'user', text: 'keep me' });
    await vi.advanceTimersByTimeAsync(400);
    history.saveChatHistory.mockClear();

    // Exactly the corpus-switch sequence: switching flips first, resetCorpus
    // clears the messages, and only later does the active id move to B.
    useCorpusStore.setState({ switching: true });
    useChatStore.getState().clearMessages();
    await vi.advanceTimersByTimeAsync(400);

    expect(history.saveChatHistory).not.toHaveBeenCalled();

    activateLocalCorpus(CORPUS_B);
    await vi.advanceTimersByTimeAsync(400);

    const wipedA = history.saveChatHistory.mock.calls.some(
      ([scope, messages]) => scope === CORPUS_A && messages.length === 0,
    );
    expect(wipedA).toBe(false);
  });

  it('drops a queued save when an import switches to a non-local corpus mid-debounce', async () => {
    useChatStore.getState().addMessage({ role: 'user', text: 'pending' });
    // Imports call resetCorpus + setEphemeral without ever setting `switching`.
    useCorpusStore.getState().setEphemeral('Imported graph', 'imported');
    await vi.advanceTimersByTimeAsync(400);

    expect(history.saveChatHistory).not.toHaveBeenCalled();
  });

  it('does not persist a partial answer while it is streaming', async () => {
    useChatStore.setState({ isStreaming: true });
    useChatStore.getState().addMessage({ role: 'assistant', text: 'half an ans' });
    await vi.advanceTimersByTimeAsync(400);

    expect(history.saveChatHistory).not.toHaveBeenCalled();
  });

  it('flushes a debounced save on demand so a switch cannot lose it', async () => {
    useChatStore.getState().addMessage({ role: 'user', text: 'sent just now' });
    await flushPendingChatSave();

    expect(history.saveChatHistory).toHaveBeenCalledWith(
      CORPUS_A,
      expect.arrayContaining([expect.objectContaining({ text: 'sent just now' })]),
    );
  });
});

describe('loading the transcript', () => {
  it('loads once for a workspace, not on every return to ready', async () => {
    await vi.advanceTimersByTimeAsync(0);
    expect(history.loadChatHistory).toHaveBeenCalledTimes(1);

    // Enrichment, a folder rescan, or adding files all re-enter 'ready'.
    useGraphStore.setState({ phase: 'enriching' });
    useGraphStore.setState({ phase: 'ready' });
    await vi.advanceTimersByTimeAsync(0);

    expect(history.loadChatHistory).toHaveBeenCalledTimes(1);
  });

  it('leaves a streaming answer untouched when the pipeline reaches ready', async () => {
    await vi.advanceTimersByTimeAsync(0);
    history.loadChatHistory.mockResolvedValue([
      { id: 'old', role: 'user', text: 'stale saved turn', timestamp: 1 },
    ]);

    useChatStore.getState().addMessage({ role: 'assistant', text: 'streaming now' });
    useChatStore.setState({ isStreaming: true });
    useGraphStore.setState({ phase: 'enriching' });
    useGraphStore.setState({ phase: 'ready' });
    await vi.advanceTimersByTimeAsync(0);

    const state = useChatStore.getState();
    expect(state.isStreaming).toBe(true);
    expect(state.messages.at(-1)?.text).toBe('streaming now');
  });

  it('loads the new workspace exactly once after a switch settles', async () => {
    await vi.advanceTimersByTimeAsync(0);
    history.loadChatHistory.mockClear();

    // Hydration reaches 'ready' while the switch is still in flight; the load
    // must wait for switching to clear rather than being skipped entirely.
    useCorpusStore.setState({ switching: true, activeCorpusId: CORPUS_B });
    useGraphStore.setState({ phase: 'ready' });
    await vi.advanceTimersByTimeAsync(0);
    expect(history.loadChatHistory).not.toHaveBeenCalled();

    useCorpusStore.setState({ switching: false });
    await vi.advanceTimersByTimeAsync(0);

    expect(history.loadChatHistory).toHaveBeenCalledTimes(1);
    expect(history.loadChatHistory).toHaveBeenCalledWith(CORPUS_B);
  });
});

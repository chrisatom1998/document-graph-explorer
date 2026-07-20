/**
 * Owns persistence of the chat transcript: when to load it for a workspace and
 * when to write it back.
 *
 * This lives outside React on purpose. Both jobs depend on *which workspace is
 * active right now*, and a React effect can only see the scope captured at its
 * last commit. During a corpus switch the store changes several times before
 * React commits again, and the two effects this module replaces both raced that
 * window: the writer persisted an empty transcript against the OUTGOING corpus
 * (resetCorpus clears messages before activateCorpus flips the id), and the
 * reader re-loaded on every re-entry to 'ready', overwriting a live streaming
 * answer. Deriving scope from the stores at decision time removes the race
 * class rather than narrowing it.
 *
 * Deliberate: restoring a snapshot into the same corpus clears the transcript
 * and persists that clear, matching resetCorpus's intent — answers cite the
 * outgoing corpus, so they must not outlive it.
 */
import { useChatStore } from '../store/chatStore';
import { useCorpusStore } from '../store/corpusStore';
import { useGraphStore } from '../store/graphStore';
import { loadChatHistory, saveChatHistory } from './chatHistory';

const SAVE_DEBOUNCE_MS = 350;

let started = false;
let unsubscribers: (() => void)[] = [];
let pending: { scope: string; timer: ReturnType<typeof setTimeout> } | null = null;
let lastLoadedScope: string | null = null;

/** The workspace a transcript belongs to, or null when nothing should persist. */
function currentScope(): string | null {
  const corpus = useCorpusStore.getState();
  if (corpus.mode !== 'local') return null;
  return corpus.activeCorpusId;
}

function clearPending(): void {
  if (pending) clearTimeout(pending.timer);
  pending = null;
}

/**
 * Everything is re-read here rather than captured when the save was scheduled:
 * a switch may have started during the debounce (making this the wrong
 * workspace to key the write by), an answer may have started streaming (a
 * partial answer must not be persisted), and the transcript itself may have
 * grown — writing a snapshot taken 350ms ago would silently drop those turns.
 */
async function writeIfStillValid(scope: string): Promise<void> {
  const chat = useChatStore.getState();
  if (chat.isStreaming) return;
  if (useCorpusStore.getState().switching || currentScope() !== scope) return;
  try {
    await saveChatHistory(scope, chat.messages);
  } catch (error) {
    console.warn('chat history save failed', error);
  }
}

function scheduleSave(): void {
  const state = useChatStore.getState();
  // Partial answers are never persisted; the completed turn schedules its own
  // save when streaming ends.
  if (state.isStreaming) return;
  // A switch in progress means the messages currently in the store no longer
  // correspond to the id we would key the write by. Dropping the save here is
  // what stops the outgoing workspace's transcript being replaced with [].
  // Cheap early-out so a switch doesn't churn timers; the authoritative check
  // is in writeIfStillValid, which runs after the debounce.
  if (useCorpusStore.getState().switching) return;
  const scope = currentScope();
  if (!scope) return;

  clearPending();
  pending = {
    scope,
    timer: setTimeout(() => {
      pending = null;
      void writeIfStillValid(scope);
    }, SAVE_DEBOUNCE_MS),
  };
}

function maybeLoad(): void {
  const scope = currentScope();
  if (!scope || scope === lastLoadedScope) return;
  const corpus = useCorpusStore.getState();
  if (corpus.switching) return;
  if (useGraphStore.getState().phase !== 'ready') return;

  // Claim the scope before awaiting so concurrent triggers can't double-load.
  lastLoadedScope = scope;
  loadChatHistory(scope)
    .then((messages) => {
      // The workspace may have changed again while IndexedDB was reading.
      if (currentScope() !== scope) return;
      // An answer that started streaming while the read was in flight is newer
      // than anything on disk, and replaceMessages would both discard it and
      // clear isStreaming out from under the running request. Release the
      // scope claim so this retries once the stream finishes — otherwise the
      // saved transcript is never restored and the next save replaces it with
      // just this one turn.
      if (useChatStore.getState().isStreaming) {
        lastLoadedScope = null;
        return;
      }
      useChatStore.getState().replaceMessages(messages);
    })
    .catch((error) => {
      lastLoadedScope = null; // let a later trigger retry
      console.warn('chat history restore failed', error);
    });
}

/**
 * Persists any debounced transcript immediately. Call before tearing down a
 * workspace so a message sent moments earlier isn't lost with the timer.
 */
export async function flushPendingChatSave(): Promise<void> {
  if (!pending) return;
  const { scope, timer } = pending;
  clearTimeout(timer);
  pending = null;
  await writeIfStillValid(scope);
}

/** Idempotent; safe to call from React StrictMode's double-invoked effects. */
export function initChatHistorySync(): void {
  if (started) return;
  started = true;
  unsubscribers = [
    useChatStore.subscribe(() => {
      scheduleSave();
      // Also the retry path for a load deferred by an in-flight stream: the
      // stream ending is a chat-store change, not a corpus or phase one.
      maybeLoad();
    }),
    // Both stores can be the one that makes a load newly valid: the corpus
    // store when the switch finishes, the graph store when hydration reaches
    // 'ready'. Whichever lands last triggers the single load.
    useCorpusStore.subscribe(maybeLoad),
    useGraphStore.subscribe(maybeLoad),
  ];
  maybeLoad();
}

export function _resetChatHistorySyncForTests(): void {
  unsubscribers.forEach((off) => off());
  unsubscribers = [];
  clearPending();
  lastLoadedScope = null;
  started = false;
}

/**
 * Chat document scope. Kept off settingsStore so the eager entry chunk
 * does not grow — ChatPanel, SettingsPanel, and ragChat are all lazy.
 */
import { create } from 'zustand';

export type ChatScope = 'relevant' | 'all';

const STORAGE_KEY = 'knowledge-nebula-chat-scope';

function loadChatScope(): ChatScope {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'all' ? 'all' : 'relevant';
  } catch {
    return 'relevant';
  }
}

export interface ChatScopeState {
  chatScope: ChatScope;
  setChatScope: (scope: ChatScope) => void;
}

export const useChatScopeStore = create<ChatScopeState>((set) => ({
  chatScope: loadChatScope(),
  setChatScope: (chatScope) => set({ chatScope }),
}));

useChatScopeStore.subscribe((s) => {
  try {
    localStorage.setItem(STORAGE_KEY, s.chatScope);
  } catch {
    /* private mode / quota — in-memory scope still works */
  }
});

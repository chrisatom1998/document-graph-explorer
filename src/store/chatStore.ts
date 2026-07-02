/**
 * Chat-with-data store: message history + streaming state.
 * Messages are ephemeral (cleared on corpus reset) — not persisted to IndexedDB.
 */

import { create } from 'zustand';

/** A typed content block for rich AI responses. */
export type ContentBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'callout'; label: string; text: string }
  | { type: 'heading'; text: string };

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  /** Structured blocks for rich rendering (assistant messages only). */
  blocks?: ContentBlock[];
  /** Doc IDs used as context for this answer (shown as source chips). */
  sources?: string[];
  timestamp: number;
}

interface ChatState {
  messages: ChatMessage[];
  isOpen: boolean;
  isStreaming: boolean;
  addMessage: (msg: Omit<ChatMessage, 'id' | 'timestamp'>) => string;
  updateMessage: (id: string, patch: Partial<ChatMessage>) => void;
  setIsOpen: (open: boolean) => void;
  setIsStreaming: (streaming: boolean) => void;
  clearMessages: () => void;
}

let nextId = 0;

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  isOpen: false,
  isStreaming: false,

  addMessage: (msg) => {
    const id = `chat-${++nextId}`;
    set((s) => ({
      messages: [...s.messages, { ...msg, id, timestamp: Date.now() }],
    }));
    return id;
  },

  updateMessage: (id, patch) =>
    set((s) => ({
      messages: s.messages.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    })),

  setIsOpen: (isOpen) => set({ isOpen }),
  setIsStreaming: (isStreaming) => set({ isStreaming }),
  clearMessages: () => set({ messages: [] }),
}));

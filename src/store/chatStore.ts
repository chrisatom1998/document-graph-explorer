/**
 * Chat-with-data store: message history + streaming state.
 * Messages are ephemeral (cleared on corpus reset) — not persisted to IndexedDB.
 */

import { create } from 'zustand';

/** A single citation: the best-scoring chunk retrieved from one document. */
export interface ChatSource {
  docId: string;
  /** First ~200 chars of the best-matching chunk, for the tooltip preview. */
  snippet: string;
  /** Cosine similarity of that chunk to the question. */
  score: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  /** Chunk-level citations used as context for this answer (source chips). */
  sources?: ChatSource[];
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

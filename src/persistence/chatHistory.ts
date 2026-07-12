import type { ChatMessage } from '../store/chatStore';
import { getDb } from './db';

export async function loadChatHistory(corpusHash: string): Promise<ChatMessage[]> {
  if (!corpusHash) return [];
  return (await (await getDb()).get('chats', corpusHash))?.messages ?? [];
}

export async function saveChatHistory(corpusHash: string, messages: ChatMessage[]): Promise<void> {
  if (!corpusHash) return;
  await (await getDb()).put('chats', { corpusHash, messages: messages.slice(-100), savedAt: Date.now() });
}

export function chatTranscriptMarkdown(messages: ChatMessage[]): string {
  return messages.map((message) => {
    const sources = message.sources?.length
      ? `\n\nSources: ${message.sources.map((source) => source.docId).join(', ')}`
      : '';
    const speaker = message.role === 'user' ? 'You' : message.role === 'assistant' ? 'Assistant' : 'System';
    return `## ${speaker}\n\n${message.text}${sources}`;
  }).join('\n\n---\n\n');
}

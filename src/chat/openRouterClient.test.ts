import { describe, expect, it } from 'vitest';
import { buildOpenRouterMessages, parseOpenRouterSseLine } from './openRouterClient';
import type { ChatMessage } from '../store/chatStore';

describe('parseOpenRouterSseLine', () => {
  it('extracts streamed text and finish reasons', () => {
    const event = parseOpenRouterSseLine(
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'Hello' }, finish_reason: 'stop' }] })}`,
    );
    expect(event).toEqual({ text: 'Hello', finishReason: 'stop' });
  });

  it('ignores comments, done sentinels, and malformed data', () => {
    expect(parseOpenRouterSseLine(': OPENROUTER PROCESSING')).toBeNull();
    expect(parseOpenRouterSseLine('data: [DONE]')).toBeNull();
    expect(parseOpenRouterSseLine('data: {broken')).toBeNull();
  });

  it('surfaces top-level and choice-level stream errors', () => {
    expect(parseOpenRouterSseLine('data: {"error":{"message":"failed"}}')).toEqual({
      text: '',
      error: 'failed',
    });
    expect(
      parseOpenRouterSseLine('data: {"choices":[{"delta":{},"error":{"message":"lost"}}]}'),
    ).toEqual({ text: '', error: 'lost' });
  });
});

describe('buildOpenRouterMessages', () => {
  it('drops system and failed assistant messages while retaining conversation context', () => {
    const base = { id: '1', timestamp: 1 };
    const history: ChatMessage[] = [
      { ...base, role: 'system', text: 'notice' },
      { ...base, id: '2', role: 'user', text: 'Earlier question' },
      { ...base, id: '3', role: 'assistant', text: 'Earlier answer' },
      { ...base, id: '4', role: 'assistant', text: 'Error: failed', isError: true },
    ];
    const messages = buildOpenRouterMessages(history, 'Grounded prompt');
    expect(messages.map((message) => message.role)).toEqual([
      'system',
      'user',
      'assistant',
      'user',
    ]);
    expect(messages.at(-1)?.content).toBe('Grounded prompt');
    expect(messages.some((message) => message.content === 'notice')).toBe(false);
  });
});

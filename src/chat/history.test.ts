/**
 * `buildHistoryTurns` (src/chat/ragChat.ts) turns prior chat messages into
 * Gemini `contents` turns. Gemini rejects multiturn `contents` that don't
 * strictly alternate starting with 'user' and ending with 'model' (the
 * caller appends the current user question right after) — a 400 kills the
 * whole request, not just history, so these normalization rules are the
 * highest-value thing to pin down with tests.
 *
 * ragChat.ts imports pipeline/coordinator at module scope (pdfjs et al. in
 * its transitive graph), so it's mocked here the same way
 * ragChat.airgap.test.ts does, even though this suite never calls anything
 * that touches it.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../pipeline/coordinator', () => ({
  embedQuery: vi.fn().mockRejectedValue(new Error('no embed worker in test')),
}));

import { buildHistoryTurns } from './ragChat';
import type { ChatMessage } from '../store/chatStore';

let nextId = 0;
function msg(role: ChatMessage['role'], text: string): ChatMessage {
  return { id: `m-${++nextId}`, role, text, timestamp: Date.now() };
}

describe('buildHistoryTurns', () => {
  it('returns [] for empty history', () => {
    expect(buildHistoryTurns([])).toEqual([]);
  });

  it('excludes system messages', () => {
    const turns = buildHistoryTurns([
      msg('system', 'No documents loaded yet.'),
      msg('user', 'Q1'),
      msg('assistant', 'A1'),
    ]);
    expect(turns).toEqual([
      { role: 'user', parts: [{ text: 'Q1' }] },
      { role: 'model', parts: [{ text: 'A1' }] },
    ]);
  });

  it('excludes failed assistant turns (text starting with "Error:")', () => {
    const turns = buildHistoryTurns([
      msg('user', 'Q1'),
      msg('assistant', 'Error: Gemini HTTP 500'),
      msg('user', 'Q2'),
      msg('assistant', 'A2'),
    ]);
    // The dropped error turn leaves two consecutive 'user' messages, which
    // the alternation normalization then merges into a single user turn.
    expect(turns).toEqual([
      { role: 'user', parts: [{ text: 'Q1\n\nQ2' }] },
      { role: 'model', parts: [{ text: 'A2' }] },
    ]);
  });

  it('drops a leading model turn (alternation must start with user)', () => {
    const turns = buildHistoryTurns([msg('assistant', 'A0'), msg('user', 'Q1')]);
    // Dropping the leading model turn leaves a single trailing user turn,
    // which the trailing-user trim (below) then removes entirely.
    expect(turns).toEqual([]);
  });

  it('drops a trailing user turn (conversation must end on model)', () => {
    const turns = buildHistoryTurns([
      msg('user', 'Q1'),
      msg('assistant', 'A1'),
      msg('user', 'Q2 with no answer yet'),
    ]);
    expect(turns).toEqual([
      { role: 'user', parts: [{ text: 'Q1' }] },
      { role: 'model', parts: [{ text: 'A1' }] },
    ]);
  });

  it('merges consecutive same-role turns instead of sending them separately', () => {
    const turns = buildHistoryTurns([
      msg('user', 'part one'),
      msg('user', 'part two'),
      msg('assistant', 'answer'),
    ]);
    expect(turns).toEqual([
      { role: 'user', parts: [{ text: 'part one\n\npart two' }] },
      { role: 'model', parts: [{ text: 'answer' }] },
    ]);
  });

  it('respects MAX_HISTORY_MESSAGES (8): keeps only the most recent window', () => {
    // 6 strict user/assistant pairs = 12 messages, alternating starting with
    // user. The most recent 8 (indices 4..11) already start on 'user' and
    // end on 'assistant', so this isolates the cap from the normalization
    // logic exercised above.
    const messages: ChatMessage[] = [];
    for (let i = 1; i <= 6; i++) {
      messages.push(msg('user', `Q${i}`));
      messages.push(msg('assistant', `A${i}`));
    }
    const turns = buildHistoryTurns(messages);
    expect(turns).toHaveLength(8);
    expect(turns.map((t) => t.role)).toEqual([
      'user', 'model', 'user', 'model', 'user', 'model', 'user', 'model',
    ]);
    // Oldest two pairs (Q1/A1, Q2/A2) fell outside the window.
    expect(turns[0].parts[0].text).toBe('Q3');
    expect(turns.at(-1)?.parts[0].text).toBe('A6');
  });
});

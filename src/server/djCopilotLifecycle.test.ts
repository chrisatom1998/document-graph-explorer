import OpenAI from 'openai';
import { describe, expect, it, vi } from 'vitest';
import { openAiCopilot } from './djCopilot';

function fixture(events: unknown[], result: unknown) {
  const stream = { async *[Symbol.asyncIterator]() { yield* events; }, withResultCollection: vi.fn(), finalResult: vi.fn(async () => result), controller: { abort: vi.fn() } };
  const sessions = { create: vi.fn(async () => stream), delete: vi.fn(async () => ({})), events: { create: vi.fn(async () => ({})) },
    turns: { retrieve: vi.fn(async () => ({ status: 'failed' })) }, items: { async *list() { /* no items */ } } };
  const client = { beta: { agents: { sessions } } } as unknown as OpenAI;
  return { sessions, stream, service: openAiCopilot('not-used', client) };
}
const created = { type: 'agent.session.created', session: { id: 'our-session' } };
const turn = { id: 'our-turn', subagent_id: null };
const output = (answer: string) => JSON.stringify({ answer, suggestions: [] });
describe('copilot agent lifecycle', () => {
  it('requires a completed root turn, collects final output, and removes the hosted session', async () => {
    const f = fixture([created, { type: 'agent.session.turn.completed', turn }], { session_id: 'our-session', turn_id: 'our-turn', turn: { status: 'completed' }, output_text: output('Evidence reviewed.') });
    const result = await f.service.review([], 'Review', new AbortController().signal);
    expect(result.answer).toBe('Evidence reviewed.');
    expect(f.sessions.delete).toHaveBeenCalledWith('our-session', expect.any(Object));
    expect(f.sessions.events.create).not.toHaveBeenCalled();
    expect(f.sessions.create.mock.calls[0]).toBeDefined();
    const sent = (f.sessions.create.mock.calls as unknown as [Record<string, any>][])[0][0];
    expect(sent.environment).toMatchObject({ type: 'openai_hosted', network: { access: 'disabled' } });
    expect(sent.agent.model).toBe('gpt-6.1-sol');
    expect(sent.agent.text.format.type).toBe('json_schema');
    expect(JSON.stringify(sent)).not.toContain('not-used');
  });
  it('cancels and removes a failed root turn instead of returning partial commentary', async () => {
    const f = fixture([created, { type: 'agent.session.turn.failed', turn }], null);
    await expect(f.service.review([], 'Review', new AbortController().signal)).rejects.toThrow('did not finish');
    expect(f.stream.finalResult).not.toHaveBeenCalled();
    expect(f.sessions.events.create).toHaveBeenCalledWith('our-session', { events: [{ type: 'agent.session.input.cancel' }] }, expect.any(Object));
    expect(f.sessions.delete).toHaveBeenCalled();
  });
  it('does not accept idle or subagent completion as success', async () => {
    const f = fixture([created, { type: 'agent.session.idle' }, { type: 'agent.session.turn.completed', turn: { id: 'other', subagent_id: 'child' } }], { session_id: 'our-session', turn_id: 'our-turn', turn: { status: 'in_progress' }, output_text: 'Partial' });
    await expect(f.service.review([], 'Review', new AbortController().signal)).rejects.toThrow();
    expect(f.sessions.events.create).toHaveBeenCalled();
    expect(f.sessions.delete).toHaveBeenCalled();
  });
  it('retries cleanup conflicts without repeating the model request', async () => {
    const f = fixture([created, { type: 'agent.session.turn.completed', turn }], { session_id: 'our-session', turn_id: 'our-turn', turn: { status: 'completed' }, output_text: output('Done') });
    f.sessions.delete.mockRejectedValueOnce(new OpenAI.APIError(409, {}, 'Conflict', new Headers()));
    expect((await f.service.review([], 'Review', new AbortController().signal)).answer).toBe('Done');
    expect(f.sessions.delete).toHaveBeenCalledTimes(2);
    expect(f.sessions.create).toHaveBeenCalledOnce();
  });
  it('reconciles a timed-out delete before deciding the session leaked', async () => {
    const f = fixture([created, { type: 'agent.session.turn.completed', turn }], { session_id: 'our-session', turn_id: 'our-turn', turn: { status: 'completed' }, output_text: output('Done') });
    f.sessions.delete.mockRejectedValueOnce(new OpenAI.APIConnectionTimeoutError());
    Object.assign(f.sessions, { retrieve: vi.fn(async () => { throw new OpenAI.APIError(404, {}, 'Gone', new Headers()); }) });
    expect((await f.service.review([], 'Review', new AbortController().signal)).warning).toBeUndefined();
    expect(f.sessions.delete).toHaveBeenCalledOnce();
  });
  it('rejects malformed structured output after cleaning up the session', async () => {
    const f = fixture([created], { session_id: 'our-session', turn_id: 'our-turn', turn: { status: 'completed' }, output_text: 'Not JSON' });
    await expect(f.service.review([], 'Review', new AbortController().signal)).rejects.toThrow('invalid suggested properties');
    expect(f.sessions.delete).toHaveBeenCalledOnce();
  });
});

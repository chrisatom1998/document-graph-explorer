import { describe, expect, it } from 'vitest';
import { useChatScopeStore } from './chatScopeStore';

describe('chatScopeStore', () => {
  it('defaults to relevant passages and round-trips all-documents', () => {
    expect(useChatScopeStore.getState().chatScope).toBe('relevant');
    useChatScopeStore.getState().setChatScope('all');
    expect(useChatScopeStore.getState().chatScope).toBe('all');
    useChatScopeStore.getState().setChatScope('relevant');
    expect(useChatScopeStore.getState().chatScope).toBe('relevant');
  });
});

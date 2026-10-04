// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMusicJobs } from '../store/musicJobs';
import { useChatStore } from '../store/chatStore';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';
import { sendChatMessage } from '../chat/ragChat';
import ChatPanel from './ChatPanel';
vi.mock('../chat/ragChat', () => ({ sendChatMessage: vi.fn(), cancelChat: vi.fn() }));
Element.prototype.scrollIntoView = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  useGraphStore.getState().reset();
  useMusicJobs.setState({ jobs: {} });
  useGraphStore.getState().addNodes([{ id: 'sample', title: 'Studio synth', kind: 'document', fileType: 'audio', topics: [], entities: [], keywords: [], wordCount: 0, cluster: 0, degree: 0, status: 'ok' }]);
  useChatStore.getState().clearMessages();
  useChatStore.getState().setIsOpen(true);
  useUiStore.setState({ selectedId: 'sample' });
});
afterEach(cleanup);
describe('music copilot panel', () => {
  it('passes the selected sample to matching requests', () => {
    render(<ChatPanel />);
    expect(screen.getByRole('dialog', { name: 'Music copilot' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Find matching samples' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(sendChatMessage).toHaveBeenCalledWith('Find matches for this selected sample', { selectedId: 'sample' });
  });
  it('allows questions during analysis and updates the processing notice', () => {
    useGraphStore.getState().setPhase('parsing');
    render(<ChatPanel />);
    expect(screen.getByText(/Analysis is still running/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Explore my library' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(sendChatMessage).toHaveBeenCalledWith('Give me an overview of my sample library', { selectedId: 'sample' });
    act(() => {
      useMusicJobs.setState({ jobs: { sample: 'Verifying' } });
      useGraphStore.getState().setPhase('ready');
    });
    expect(screen.getByText(/Analysis is still running/)).toBeVisible();
    act(() => useMusicJobs.setState({ jobs: {} }));
    expect(screen.queryByText(/Analysis is still running/)).not.toBeInTheDocument();
  });
  it('keeps normal document chat available for mixed libraries', () => {
    useGraphStore.getState().addNodes([{ id: 'note', title: 'Notes', kind: 'document', fileType: 'txt', topics: [], entities: [], keywords: [], wordCount: 20, cluster: 0, degree: 0, status: 'ok' }]);
    render(<ChatPanel />);
    fireEvent.click(screen.getByText('More tools'));
    fireEvent.click(screen.getByRole('button', { name: 'Chat with all files instead' }));
    expect(screen.getByLabelText('Ask a question about your documents')).toBeVisible();
  });
  it('highlights cited samples with a direct graph action', () => {
    useChatStore.getState().addMessage({ role: 'assistant', text: 'A matching sample', sources: [{ docId: 'sample', score: 1, snippet: 'Tempo: 140 BPM' }] });
    render(<ChatPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Show samples in graph' }));
    expect(useUiStore.getState().selectedId).toBeNull();
    expect(useUiStore.getState().searchResults).toEqual(['sample']);
  });
});

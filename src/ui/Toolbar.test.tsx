// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { DocNode } from '../model/types';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';
import { useCollabStore } from '../collab/store';
import Toolbar from './Toolbar';

function documentNode(): DocNode {
  return {
    id: 'doc',
    kind: 'document',
    title: 'Document',
    fileType: 'txt',
    topics: [],
    entities: [],
    keywords: [],
    wordCount: 10,
    cluster: 0,
    degree: 0,
    status: 'ok',
  };
}

describe('Toolbar', () => {
  const realJoinInvite = useCollabStore.getState().joinInvite;

  beforeEach(() => {
    useGraphStore.setState({
      nodes: [documentNode()],
      nodeIndex: { doc: 0 },
      edges: [],
      phase: 'ready',
    });
    useUiStore.setState({
      searchOpen: false,
      settingsOpen: false,
      snapshotsOpen: false,
      helpOpen: false,
      insightsOpen: false,
      pathMode: false,
    });
  });

  afterEach(() => {
    cleanup();
    useGraphStore.getState().reset();
    useCollabStore.setState({ joinInvite: realJoinInvite });
    useCollabStore.getState().leaveSession();
  });

  it('keeps studio tools in Analyze and Add menus instead of first-class buttons', () => {
    render(<Toolbar />);

    expect(screen.getByRole('button', { name: 'Search documents' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Analyze' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add documents' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show me a topic' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Corpus insights' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Saved snapshots' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add folder' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Analyze' }));
    expect(screen.getByRole('button', { name: 'How are these connected?' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Corpus insights' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Snapshots' })).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Add documents' }));
    expect(screen.getByRole('button', { name: 'Add files' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Add folder' })).toBeVisible();
  });

  it('joins a collaboration invite from a glass modal instead of window.prompt', async () => {
    const joinInvite = vi.fn().mockResolvedValue('#collab=v1.room1.key1');
    useCollabStore.setState({
      joinInvite,
      session: null,
      invite: null,
      peers: {},
      followMode: false,
      shareNotes: false,
    });
    const promptSpy = vi.spyOn(window, 'prompt');

    render(<Toolbar />);
    fireEvent.click(screen.getByRole('button', { name: 'Collaboration' }));
    fireEvent.click(screen.getByRole('button', { name: 'Join invite' }));

    expect(promptSpy).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog', { name: 'Join a collaboration session' });
    expect(dialog).toBeVisible();

    fireEvent.change(screen.getByLabelText('Collaboration invite'), {
      target: { value: '  #collab=v1.room1.key1  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));

    await waitFor(() => expect(joinInvite).toHaveBeenCalledTimes(1));
    expect(joinInvite).toHaveBeenCalledWith('#collab=v1.room1.key1');
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Join a collaboration session' })).not.toBeInTheDocument();
    });

    promptSpy.mockRestore();
  });

  it('cancels the collaboration join modal without connecting', () => {
    const joinInvite = vi.fn();
    useCollabStore.setState({ joinInvite, session: null, invite: null, peers: {} });

    render(<Toolbar />);
    fireEvent.click(screen.getByRole('button', { name: 'Collaboration' }));
    fireEvent.click(screen.getByRole('button', { name: 'Join invite' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(joinInvite).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: 'Join a collaboration session' })).not.toBeInTheDocument();
  });
});

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { DocNode } from '../model/types';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';
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
});

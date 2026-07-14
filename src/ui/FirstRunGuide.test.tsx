// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import type { DocNode } from '../model/types';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';
import FirstRunGuide, { FIRST_RUN_GUIDE_REOPEN_EVENT } from './FirstRunGuide';

const node: DocNode = {
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

describe('FirstRunGuide', () => {
  beforeEach(() => {
    localStorage.clear();
    useGraphStore.setState({
      nodes: [node],
      nodeIndex: { doc: 0 },
      edges: [],
      phase: 'ready',
    });
    useUiStore.setState({ selectedId: null });
  });

  afterEach(() => {
    cleanup();
    useGraphStore.getState().reset();
  });

  it('gets out of the way while document details are open', async () => {
    render(<FirstRunGuide />);
    expect(await screen.findByLabelText('Getting started')).toBeVisible();

    act(() => useUiStore.getState().setSelected('doc'));

    expect(screen.queryByLabelText('Getting started')).not.toBeInTheDocument();
  });

  it('can be reopened after dismissal', async () => {
    render(<FirstRunGuide />);
    const guide = await screen.findByLabelText('Getting started');
    expect(guide).toBeVisible();

    await act(async () => {
      screen.getByRole('button', { name: 'Dismiss getting started' }).click();
    });
    expect(screen.queryByLabelText('Getting started')).not.toBeInTheDocument();

    await act(async () => {
      window.dispatchEvent(new Event(FIRST_RUN_GUIDE_REOPEN_EVENT));
    });

    expect(await screen.findByLabelText('Getting started')).toBeVisible();
  });

  it('walks through focused learning steps', async () => {
    render(<FirstRunGuide />);
    expect(await screen.findByText('Explore the map')).toBeVisible();

    await act(async () => screen.getByRole('button', { name: 'Next' }).click());
    expect(screen.getByText('Find and shape the view')).toBeVisible();
    expect(screen.getByText('Step 2 of 4')).toBeVisible();

    await act(async () => screen.getByRole('button', { name: 'Back' }).click());
    expect(screen.getByText('Explore the map')).toBeVisible();
  });
});

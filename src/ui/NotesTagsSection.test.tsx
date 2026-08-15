// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const { getCorpusRecordMock, updateCorpusAnnotationsMock } = vi.hoisted(() => ({
  getCorpusRecordMock: vi.fn(),
  updateCorpusAnnotationsMock: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../persistence/corpusRepository', () => ({
  getCorpusRecord: getCorpusRecordMock,
  updateCorpusAnnotations: updateCorpusAnnotationsMock,
}));

import type { DocNode } from '../model/types';
import NotesTagsSection from './NotesTagsSection';
import { _resetAnnotationsForTests, useAnnotationStore } from '../store/annotationStore';
import { useCorpusStore } from '../store/corpusStore';
import { useGraphStore } from '../store/graphStore';

function doc(id: string, path: string): DocNode {
  return {
    id,
    kind: 'document',
    title: path.split('/').pop() ?? path,
    path,
    fileType: 'md',
    topics: [],
    entities: [],
    keywords: [],
    wordCount: 10,
    cluster: 0,
    degree: 0,
    status: 'ok',
  } as DocNode;
}

describe('NotesTagsSection', () => {
  beforeEach(() => {
    getCorpusRecordMock.mockReset().mockResolvedValue({ annotations: {} });
    updateCorpusAnnotationsMock.mockClear();
    useCorpusStore.setState({ activeCorpusId: 'c1', mode: 'local' });
    // Tag suggestions only come from documents still present in the graph.
    useGraphStore.setState({
      nodes: [doc('d1', 'docs/a.md'), doc('d2', 'docs/other.md')],
      nodeIndex: { d1: 0, d2: 1 },
    });
  });

  afterEach(() => {
    cleanup(); // no global test setup registers this
    _resetAnnotationsForTests();
    useCorpusStore.setState({ activeCorpusId: null, mode: 'local' });
    useGraphStore.getState().reset();
  });

  it('renders note, tag editor, and pin once annotations hydrate', async () => {
    render(<NotesTagsSection docKey="docs/a.md" />);
    expect(await screen.findByLabelText('Document note')).toBeVisible();
    expect(screen.getByLabelText('Add a tag')).toBeVisible();
    expect(screen.getByRole('button', { name: '☆ Pin' })).toBeVisible();
  });

  it('typing a note updates the store; Enter adds a tag chip', async () => {
    render(<NotesTagsSection docKey="docs/a.md" />);
    const note = await screen.findByLabelText('Document note');
    fireEvent.change(note, { target: { value: 'central design doc' } });
    expect(useAnnotationStore.getState().annotations['docs/a.md']?.note).toBe(
      'central design doc',
    );

    const tagInput = screen.getByLabelText('Add a tag');
    fireEvent.change(tagInput, { target: { value: 'architecture' } });
    fireEvent.keyDown(tagInput, { key: 'Enter' });
    expect(screen.getByRole('button', { name: 'Remove tag architecture' })).toBeVisible();
    expect(useAnnotationStore.getState().annotations['docs/a.md']?.tags).toEqual([
      'architecture',
    ]);
  });

  it('pin toggles and clicking a tag chip removes it', async () => {
    getCorpusRecordMock.mockResolvedValue({
      annotations: { 'docs/a.md': { note: '', tags: ['api'], pinned: false, updatedAt: 1 } },
    });
    render(<NotesTagsSection docKey="docs/a.md" />);

    const pin = await screen.findByRole('button', { name: '☆ Pin' });
    await act(async () => pin.click());
    expect(screen.getByRole('button', { name: '★ Pinned' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await act(async () => screen.getByRole('button', { name: 'Remove tag api' }).click());
    expect(screen.queryByRole('button', { name: 'Remove tag api' })).not.toBeInTheDocument();
  });

  it('offers corpus-wide tags as one-click suggestions', async () => {
    getCorpusRecordMock.mockResolvedValue({
      annotations: {
        'docs/other.md': { note: '', tags: ['roadmap'], pinned: false, updatedAt: 1 },
      },
    });
    render(<NotesTagsSection docKey="docs/a.md" />);
    const suggestion = await screen.findByRole('button', { name: '+ roadmap' });
    await act(async () => suggestion.click());
    expect(useAnnotationStore.getState().annotations['docs/a.md']?.tags).toEqual(['roadmap']);
  });

  it('does not suggest tags from annotations whose document left the graph', async () => {
    getCorpusRecordMock.mockResolvedValue({
      annotations: {
        'docs/deleted.md': { note: '', tags: ['ghost'], pinned: false, updatedAt: 1 },
      },
    });
    render(<NotesTagsSection docKey="docs/a.md" />);
    await screen.findByLabelText('Document note');
    expect(screen.queryByRole('button', { name: '+ ghost' })).not.toBeInTheDocument();
  });

  it('splits pasted comma-separated input into separate tags', async () => {
    render(<NotesTagsSection docKey="docs/a.md" />);
    const tagInput = await screen.findByLabelText('Add a tag');
    fireEvent.change(tagInput, { target: { value: ' api, roadmap , api,' } });
    fireEvent.keyDown(tagInput, { key: 'Enter' });
    expect(useAnnotationStore.getState().annotations['docs/a.md']?.tags).toEqual([
      'api',
      'roadmap',
    ]);
  });

  it('does not commit a draft on blur — clicking away keeps it uncommitted', async () => {
    render(<NotesTagsSection docKey="docs/a.md" />);
    const tagInput = await screen.findByLabelText('Add a tag');
    fireEvent.change(tagInput, { target: { value: 'half-typ' } });
    fireEvent.blur(tagInput);
    expect(useAnnotationStore.getState().annotations['docs/a.md']).toBeUndefined();
    expect(tagInput).toHaveValue('half-typ'); // still visible, not silently saved
  });

  it('explains why notes are unavailable on an imported/shared graph', () => {
    useCorpusStore.setState({ activeCorpusId: null, mode: 'imported' });
    render(<NotesTagsSection docKey="docs/a.md" />);
    expect(screen.getByText(/not available on imported or shared graphs/i)).toBeVisible();
    expect(screen.queryByLabelText('Document note')).not.toBeInTheDocument();
  });
});

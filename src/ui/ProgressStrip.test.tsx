// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useGraphStore } from '../store/graphStore';
import ProgressStrip from './ProgressStrip';

describe('ProgressStrip accessibility', () => {
  beforeEach(() => {
    useGraphStore.getState().reset();
    useGraphStore.setState({
      phase: 'embedding',
      fileStatuses: {
        first: { fileId: 'first', name: 'first.md', stage: 'placed' },
        second: { fileId: 'second', name: 'second.md', stage: 'embedding' },
      },
      modelProgress: { loaded: 5, total: 10, note: '' },
    });
  });

  afterEach(cleanup);

  it('announces the active phase and exposes determinate pipeline progress', () => {
    render(<ProgressStrip />);

    expect(screen.getByRole('status')).toHaveTextContent('Embedding meaning');
    expect(screen.getByRole('progressbar', { name: 'Embedding meaning…' }))
      .toHaveAttribute('aria-valuetext', '1 of 2');
    expect(screen.getByRole('progressbar', { name: 'Loading embedding model' }))
      .toHaveAttribute('aria-valuetext', '0.0 of 0.0 MB');
  });
});

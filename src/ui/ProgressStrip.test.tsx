// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';
import { clearIngestAbort, registerIngestAbort } from '../pipeline/ingestCancellation';
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
      modelProgress: { kind: 'embedding-model', loaded: 5, total: 10, note: '' },
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

  it('announces OCR progress as pages instead of model bytes', () => {
    useGraphStore.setState({
      phase: 'parsing',
      modelProgress: {
        kind: 'ocr',
        loaded: 2,
        total: 7,
        note: 'OCR scan.pdf — page 2 of 7',
      },
    });

    render(<ProgressStrip />);

    expect(screen.getByText('OCR scan.pdf — page 2 of 7')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Recognizing scanned PDF text' }))
      .toHaveAttribute('aria-valuetext', '2 of 7 pages');
  });
});

describe('ProgressStrip cancellation', () => {
  beforeEach(() => {
    useGraphStore.getState().reset();
    useGraphStore.setState({
      phase: 'parsing',
      fileStatuses: {
        first: { fileId: 'first', name: 'first.md', stage: 'parsing' },
      },
    });
  });

  afterEach(cleanup);

  it('shows no Cancel button when nothing cancellable is registered', () => {
    render(<ProgressStrip />);
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
  });

  it('aborts the registered ingest on click and flips to a disabled "Cancelling…"', () => {
    const controller = new AbortController();
    registerIngestAbort(controller);
    try {
      render(<ProgressStrip />);
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(controller.signal.aborted).toBe(true);
      expect(screen.getByRole('button', { name: 'Cancelling…' })).toBeDisabled();
    } finally {
      clearIngestAbort(controller);
    }
  });
});

describe('ProgressStrip ingest report link', () => {
  beforeEach(() => {
    useGraphStore.getState().reset();
    useUiStore.setState({ insightsOpen: false });
    useGraphStore.setState({
      phase: 'parsing',
      ignoredFiles: [{ name: 'b.exe', reason: 'unsupported type' }],
    });
  });

  afterEach(cleanup);

  it('offers no report link while no report has been published', () => {
    render(<ProgressStrip />);
    expect(screen.queryByRole('button', { name: 'View full report' })).not.toBeInTheDocument();
  });

  it('opens the Insights panel where the persisted report lives', () => {
    useGraphStore.setState({
      ingestReport: {
        finishedAt: Date.now(),
        entries: [{ name: 'b.exe', reason: 'unsupported type', kind: 'ignored' }],
      },
    });

    render(<ProgressStrip />);
    fireEvent.click(screen.getByRole('button', { name: 'View full report' }));

    expect(useUiStore.getState().insightsOpen).toBe(true);
  });
});

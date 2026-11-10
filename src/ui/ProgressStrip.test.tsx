// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
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

  it('shows music progress instead of an already completed file counter', () => {
    useGraphStore.setState({ phase: 'parsing', modelProgress: { kind: 'music-analysis', loaded: 0, total: 2, note: 'Listening to one.wav' } });
    render(<ProgressStrip />);
    expect(screen.getByRole('progressbar', { name: 'Analyzing music…' })).toHaveAttribute('aria-valuetext', '0 of 2');
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

  it('minimizes without cancelling, keeps progress current, and restores the controls', () => {
    const controller = new AbortController();
    registerIngestAbort(controller);
    try {
      render(<ProgressStrip />);
      fireEvent.click(screen.getByRole('button', { name: 'Minimize processing details' }));
      expect(controller.signal.aborted).toBe(false);
      expect(screen.queryByText('first.md')).not.toBeInTheDocument();
      act(() => useGraphStore.setState({ modelProgress: { kind: 'music-analysis', loaded: 7, total: 32, note: 'Checking a song' } }));
      expect(screen.getByRole('status')).toHaveTextContent('Analyzing music… · 7/32');
      fireEvent.click(screen.getByRole('button', { name: 'Show processing details' }));
      expect(screen.getByText('first.md')).toBeVisible();
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
      expect(controller.signal.aborted).toBe(false);
    } finally { clearIngestAbort(controller); }
  });

  it('shows details for a new run after the previous strip disappears', () => {
    render(<ProgressStrip />);
    fireEvent.click(screen.getByRole('button', { name: 'Minimize processing details' }));
    act(() => useGraphStore.setState({ phase: 'idle' }));
    expect(screen.queryByRole('button', { name: 'Show processing details' })).not.toBeInTheDocument();
    act(() => useGraphStore.setState({ phase: 'parsing' }));
    expect(screen.getByRole('button', { name: 'Minimize processing details' })).toBeVisible();
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

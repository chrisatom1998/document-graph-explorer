// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGraphStore } from '../store/graphStore';
import IngestReportSection from './IngestReportSection';

const dropZone = vi.hoisted(() => ({ openFilePicker: vi.fn() }));
vi.mock('../ingest/DropZone', () => dropZone);

describe('IngestReportSection', () => {
  beforeEach(() => {
    useGraphStore.getState().reset();
    dropZone.openFilePicker.mockClear();
  });

  afterEach(cleanup);

  it('renders nothing when there is no report', () => {
    const { container } = render(<IngestReportSection />);
    expect(container).toBeEmptyDOMElement();
  });

  it('lists every entry with its kind and reason, kept after the strip is gone', () => {
    useGraphStore.setState({
      ingestReport: {
        finishedAt: Date.now(),
        entries: [
          { name: 'a.pdf', reason: 'parse blew up', kind: 'failed' },
          { name: 'b.exe', reason: 'unsupported type', kind: 'ignored' },
          { name: 'c.md', reason: 'node limit reached (2500 max)', kind: 'capped' },
        ],
      },
    });

    render(<IngestReportSection />);

    expect(screen.getByText('Last ingest issues (3)')).toBeInTheDocument();
    expect(screen.getByText('a.pdf')).toBeInTheDocument();
    expect(screen.getByText('parse blew up')).toBeInTheDocument();
    expect(screen.getByText('ignored')).toBeInTheDocument();
    expect(screen.getByText('capped')).toBeInTheDocument();
  });

  it('Clear dismisses the report and the tray backing it', () => {
    useGraphStore.setState({
      fileStatuses: { a: { fileId: 'a', name: 'a.pdf', stage: 'error', error: 'boom' } },
      ignoredFiles: [{ name: 'b.exe', reason: 'unsupported type' }],
      ingestReport: {
        finishedAt: Date.now(),
        entries: [{ name: 'a.pdf', reason: 'boom', kind: 'failed' }],
      },
    });

    render(<IngestReportSection />);
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));

    const state = useGraphStore.getState();
    expect(state.ingestReport).toBeNull();
    expect(state.fileStatuses).toEqual({});
    expect(state.ignoredFiles).toEqual([]);
  });

  it('Re-add files opens the existing file picker as the retry path', () => {
    useGraphStore.setState({
      ingestReport: {
        finishedAt: Date.now(),
        entries: [{ name: 'a.pdf', reason: 'boom', kind: 'failed' }],
      },
    });

    render(<IngestReportSection />);
    fireEvent.click(screen.getByRole('button', { name: /Re-add files/ }));

    expect(dropZone.openFilePicker).toHaveBeenCalledTimes(1);
  });
});

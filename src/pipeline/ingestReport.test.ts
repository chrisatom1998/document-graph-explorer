import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileStatus } from '../model/types';
import { useCorpusStore } from '../store/corpusStore';
import { useGraphStore } from '../store/graphStore';
import {
  buildIngestReport,
  clearIngestReport,
  publishIngestReport,
} from './ingestReport';

const repo = vi.hoisted(() => ({
  updateCorpusIngestReport: vi.fn(() => Promise.resolve()),
}));
vi.mock('../persistence/corpusRepository', () => repo);

const AT = 1_000;

function statuses(...list: FileStatus[]): Record<string, FileStatus> {
  return Object.fromEntries(list.map((s) => [s.fileId, s]));
}

describe('buildIngestReport', () => {
  it('clears a recovered source path without hiding a same-basename failure in another folder', () => {
    const ignored = [
      { name: 'vault/a/foo.txt', reason: 'could not read: denied' },
      { name: 'vault/b/foo.txt', reason: 'could not read: denied' },
    ];
    const report = buildIngestReport(statuses(
      { fileId: 'recovered', name: 'foo.txt', path: 'vault/a/foo.txt', stage: 'placed' },
      { fileId: 'still-broken', name: 'foo.txt', path: 'vault/b/foo.txt', stage: 'error', error: 'parse failed' },
    ), ignored, { finishedAt: AT });
    expect(report?.entries).toEqual([
      { name: 'vault/b/foo.txt', reason: 'parse failed', kind: 'failed' },
      { name: 'vault/b/foo.txt', reason: 'could not read: denied', kind: 'ignored' },
    ]);
    expect(buildIngestReport(statuses(
      { fileId: 'a', name: 'foo.txt', path: 'vault/a/foo.txt', stage: 'placed' },
      { fileId: 'b', name: 'foo.txt', path: 'vault/b/foo.txt', stage: 'cached' },
    ), ignored, { finishedAt: AT })).toBeNull();
  });

  it('returns null when there is nothing to report', () => {
    expect(buildIngestReport({}, [], { finishedAt: AT })).toBeNull();
    expect(
      buildIngestReport(
        statuses({ fileId: 'a', name: 'a.md', stage: 'placed' }),
        [],
        { finishedAt: AT },
      ),
    ).toBeNull();
  });

  it('classifies error statuses as failed, node-limit errors as capped, ignored entries by reason', () => {
    const report = buildIngestReport(
      statuses(
        { fileId: 'a', name: 'a.pdf', stage: 'error', error: 'parse blew up' },
        { fileId: 'b', name: 'b.md', stage: 'error', error: 'Node limit reached (2500 max)' },
      ),
      [
        { name: 'c.exe', reason: 'unsupported type' },
        { name: 'b.md', reason: 'node limit reached (2500 max)' },
      ],
      { finishedAt: AT },
    );

    expect(report?.finishedAt).toBe(AT);
    // b.md appears in both the statuses and the ignored list — one entry survives
    expect(report?.entries).toEqual([
      { name: 'a.pdf', reason: 'parse blew up', kind: 'failed' },
      { name: 'b.md', reason: 'Node limit reached (2500 max)', kind: 'capped' },
      { name: 'c.exe', reason: 'unsupported type', kind: 'ignored' },
    ]);
  });

  it('records still-pending files as skipped only for a cancelled run', () => {
    const pending = statuses(
      { fileId: 'a', name: 'a.md', stage: 'queued' },
      { fileId: 'b', name: 'b.md', stage: 'parsing' },
      { fileId: 'c', name: 'c.md', stage: 'embedding' },
    );

    expect(buildIngestReport(pending, [], { finishedAt: AT })).toBeNull();

    const cancelled = buildIngestReport(pending, [], { cancelled: true, finishedAt: AT });
    expect(cancelled?.entries.map((e) => e.kind)).toEqual(['skipped', 'skipped', 'skipped']);
    expect(cancelled?.entries[0].reason).toMatch(/cancelled/i);
  });

  it('drops a stale failure once the same file name later ingested cleanly', () => {
    const report = buildIngestReport(
      statuses(
        { fileId: 'old', name: 'flaky.pdf', stage: 'error', error: 'parse blew up' },
        { fileId: 'new', name: 'flaky.pdf', stage: 'placed' },
        { fileId: 'x', name: 'broken.pdf', stage: 'error', error: 'still broken' },
      ),
      [],
      { finishedAt: AT },
    );

    expect(report?.entries).toEqual([
      { name: 'broken.pdf', reason: 'still broken', kind: 'failed' },
    ]);
  });
});

describe('publishIngestReport / clearIngestReport', () => {
  beforeEach(() => {
    useGraphStore.getState().reset();
    repo.updateCorpusIngestReport.mockClear();
  });

  afterEach(() => {
    useCorpusStore.setState({ activeCorpusId: null });
    useGraphStore.getState().reset();
  });

  it('snapshots the tray into the store and persists it on the active corpus', () => {
    useCorpusStore.setState({ activeCorpusId: 'corpus-1' });
    useGraphStore.setState({
      fileStatuses: statuses({ fileId: 'a', name: 'a.pdf', stage: 'error', error: 'boom' }),
      ignoredFiles: [{ name: 'b.exe', reason: 'unsupported type' }],
    });

    publishIngestReport();

    const report = useGraphStore.getState().ingestReport;
    expect(report?.entries).toHaveLength(2);
    expect(repo.updateCorpusIngestReport).toHaveBeenCalledWith('corpus-1', report);
  });

  it('replaces the previous report with null after a clean run', () => {
    useCorpusStore.setState({ activeCorpusId: 'corpus-1' });
    useGraphStore.setState({
      ingestReport: { finishedAt: AT, entries: [{ name: 'x', reason: 'y', kind: 'failed' }] },
    });

    publishIngestReport();

    expect(useGraphStore.getState().ingestReport).toBeNull();
    expect(repo.updateCorpusIngestReport).toHaveBeenCalledWith('corpus-1', null);
  });

  it('skips persistence for an ephemeral corpus but still updates the store', () => {
    useGraphStore.setState({
      ignoredFiles: [{ name: 'b.exe', reason: 'unsupported type' }],
    });

    publishIngestReport();

    expect(useGraphStore.getState().ingestReport?.entries).toHaveLength(1);
    expect(repo.updateCorpusIngestReport).not.toHaveBeenCalled();
  });

  it('clearIngestReport empties the report AND the tray it derives from', () => {
    useCorpusStore.setState({ activeCorpusId: 'corpus-1' });
    useGraphStore.setState({
      fileStatuses: statuses({ fileId: 'a', name: 'a.pdf', stage: 'error', error: 'boom' }),
      ignoredFiles: [{ name: 'b.exe', reason: 'unsupported type' }],
      ingestReport: { finishedAt: AT, entries: [{ name: 'a.pdf', reason: 'boom', kind: 'failed' }] },
    });

    clearIngestReport();

    const state = useGraphStore.getState();
    expect(state.ingestReport).toBeNull();
    expect(state.fileStatuses).toEqual({});
    expect(state.ignoredFiles).toEqual([]);
    expect(repo.updateCorpusIngestReport).toHaveBeenCalledWith('corpus-1', null);
  });
});

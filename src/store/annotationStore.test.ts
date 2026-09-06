import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getCorpusRecordMock, updateCorpusAnnotationsMock } = vi.hoisted(() => ({
  getCorpusRecordMock: vi.fn(),
  updateCorpusAnnotationsMock: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../persistence/corpusRepository', () => ({
  getCorpusRecord: getCorpusRecordMock,
  updateCorpusAnnotations: updateCorpusAnnotationsMock,
}));

import {
  _resetAnnotationsForTests,
  annotationKey,
  ensureAnnotationsLoaded,
  flushAnnotationSave,
  useAnnotationStore,
} from './annotationStore';

describe('annotationStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    getCorpusRecordMock.mockReset().mockResolvedValue({ annotations: {} });
    updateCorpusAnnotationsMock.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    _resetAnnotationsForTests();
    vi.useRealTimers();
  });

  it('keys annotations by path, disambiguating pathless docs by node id', () => {
    expect(annotationKey({ path: 'docs/a.md', title: 'A', id: 'x1' })).toBe('docs/a.md');
    // Two pathless docs with the same title must NOT share a key.
    const a = annotationKey({ title: 'Loose file', id: 'id-1' });
    const b = annotationKey({ title: 'Loose file', id: 'id-2' });
    expect(a).not.toBe(b);
  });

  it('hydrates from the corpus record and persists only the edited keys (debounced)', async () => {
    getCorpusRecordMock.mockResolvedValue({
      annotations: {
        'docs/a.md': { note: 'old', tags: [], pinned: false, updatedAt: 1 },
        'docs/untouched.md': { note: 'keep', tags: [], pinned: false, updatedAt: 1 },
      },
    });
    await ensureAnnotationsLoaded('corpus-1');
    expect(useAnnotationStore.getState().annotations['docs/a.md']?.note).toBe('old');

    useAnnotationStore.getState().update('docs/a.md', { note: 'new note' });
    useAnnotationStore.getState().update('docs/a.md', { tags: ['api'] });
    expect(updateCorpusAnnotationsMock).not.toHaveBeenCalled(); // still debouncing

    await vi.advanceTimersByTimeAsync(400);
    expect(updateCorpusAnnotationsMock).toHaveBeenCalledOnce();
    const [scope, patch] = updateCorpusAnnotationsMock.mock.calls[0];
    expect(scope).toBe('corpus-1');
    expect(patch['docs/a.md']).toMatchObject({ note: 'new note', tags: ['api'] });
    // Untouched keys are NOT in the patch — a second tab's edits survive.
    expect(patch).not.toHaveProperty('docs/untouched.md');
  });

  it('persists a cleared annotation as an explicit null (delete)', async () => {
    await ensureAnnotationsLoaded('corpus-1');
    useAnnotationStore.getState().update('k', { pinned: true });
    useAnnotationStore.getState().update('k', { pinned: false });
    await vi.advanceTimersByTimeAsync(400);
    const [, patch] = updateCorpusAnnotationsMock.mock.calls.at(-1)!;
    expect(patch['k']).toBeNull();
    expect(useAnnotationStore.getState().annotations['k']).toBeUndefined();
  });

  it('persists collaboration updates without replacing their conflict timestamp', async () => {
    await ensureAnnotationsLoaded('corpus-1');
    useAnnotationStore.getState().applyRemote('doc', {
      note: 'from peer',
      tags: ['shared'],
      pinned: true,
      updatedAt: 42,
    });
    expect(useAnnotationStore.getState().annotations.doc?.updatedAt).toBe(42);

    await vi.advanceTimersByTimeAsync(400);
    const [, patch] = updateCorpusAnnotationsMock.mock.calls.at(-1)!;
    expect(patch.doc).toEqual({
      note: 'from peer',
      tags: ['shared'],
      pinned: true,
      updatedAt: 42,
    });

    useAnnotationStore.getState().applyRemote('doc', null);
    await vi.advanceTimersByTimeAsync(400);
    const [, deletePatch] = updateCorpusAnnotationsMock.mock.calls.at(-1)!;
    expect(deletePatch.doc).toBeNull();
  });

  it('pending edits for the outgoing corpus land before re-hydration replaces them', async () => {
    await ensureAnnotationsLoaded('corpus-A');
    useAnnotationStore.getState().update('doc', { note: 'A note' });

    getCorpusRecordMock.mockResolvedValue({ annotations: {} });
    await ensureAnnotationsLoaded('corpus-B');

    const aCall = updateCorpusAnnotationsMock.mock.calls.find((c) => c[0] === 'corpus-A');
    expect(aCall?.[1]['doc']).toMatchObject({ note: 'A note' });
    expect(useAnnotationStore.getState().scope).toBe('corpus-B');
  });

  it('a debounced write retains its original scope after an out-of-band re-hydration', async () => {
    await ensureAnnotationsLoaded('corpus-A');
    useAnnotationStore.getState().update('doc', { note: 'A note' });
    useAnnotationStore.getState().hydrate('corpus-B', {});
    await vi.advanceTimersByTimeAsync(400);
    expect(updateCorpusAnnotationsMock).toHaveBeenCalledWith('corpus-A', {
      doc: expect.objectContaining({ note: 'A note' }),
    });
  });

  it('retains both workspaces edits across failed flushes and restores pending notes on return', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await ensureAnnotationsLoaded('corpus-A');
    useAnnotationStore.getState().update('doc', { note: 'A note' });
    updateCorpusAnnotationsMock.mockRejectedValue(new Error('quota'));

    await ensureAnnotationsLoaded('corpus-B');
    useAnnotationStore.getState().update('doc', { note: 'B note' });
    await ensureAnnotationsLoaded('corpus-A');
    expect(useAnnotationStore.getState().annotations.doc?.note).toBe('A note');

    updateCorpusAnnotationsMock.mockClear().mockResolvedValue(undefined);
    await vi.advanceTimersByTimeAsync(16_000);
    expect(updateCorpusAnnotationsMock).toHaveBeenCalledTimes(2);
    expect(updateCorpusAnnotationsMock).toHaveBeenCalledWith('corpus-A', {
      doc: expect.objectContaining({ note: 'A note' }),
    });
    expect(updateCorpusAnnotationsMock).toHaveBeenCalledWith('corpus-B', {
      doc: expect.objectContaining({ note: 'B note' }),
    });
    warn.mockRestore();
  });

  it('keeps a re-edit pending when the previous annotation write finishes', async () => {
    await ensureAnnotationsLoaded('corpus-A');
    useAnnotationStore.getState().update('doc', { note: 'first' });
    let complete!: () => void;
    updateCorpusAnnotationsMock.mockImplementationOnce(
      () => new Promise<void>((resolve) => { complete = resolve; }),
    );
    const saving = flushAnnotationSave();
    useAnnotationStore.getState().update('doc', { note: 'second' });
    complete();
    await saving;
    await flushAnnotationSave();
    expect(updateCorpusAnnotationsMock).toHaveBeenLastCalledWith('corpus-A', {
      doc: expect.objectContaining({ note: 'second' }),
    });
    expect(updateCorpusAnnotationsMock).toHaveBeenCalledTimes(2);
  });

  it('flushAnnotationSave writes immediately and the timer does not double-write', async () => {
    await ensureAnnotationsLoaded('corpus-1');
    useAnnotationStore.getState().update('doc', { pinned: true });
    await flushAnnotationSave();
    expect(updateCorpusAnnotationsMock).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(400);
    expect(updateCorpusAnnotationsMock).toHaveBeenCalledOnce();
  });

  it('a failed write keeps the keys dirty and retries', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await ensureAnnotationsLoaded('corpus-1');
    updateCorpusAnnotationsMock.mockRejectedValueOnce(new Error('quota'));
    useAnnotationStore.getState().update('doc', { note: 'must survive' });

    await vi.advanceTimersByTimeAsync(400); // debounce fires, write fails
    expect(updateCorpusAnnotationsMock).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(16_000); // retry timer
    expect(updateCorpusAnnotationsMock).toHaveBeenCalledTimes(2);
    const [, patch] = updateCorpusAnnotationsMock.mock.calls[1];
    expect(patch['doc']).toMatchObject({ note: 'must survive' });
    warn.mockRestore();
  });

  it('sanitizes malformed persisted records at hydration', async () => {
    getCorpusRecordMock.mockResolvedValue({
      annotations: {
        ok: { note: 'fine', tags: ['a'], pinned: true, updatedAt: 5 },
        badTags: { note: 'x', tags: 'not-an-array', pinned: false, updatedAt: 1 },
        nullRecord: null,
        badNote: { note: 42, tags: [1, 'real'], pinned: 'yes', updatedAt: 'nope' },
      },
    });
    await ensureAnnotationsLoaded('corpus-1');
    const a = useAnnotationStore.getState().annotations;
    expect(a['ok']).toEqual({ note: 'fine', tags: ['a'], pinned: true, updatedAt: 5 });
    expect(a['badTags']).toMatchObject({ note: 'x', tags: [] });
    expect(a['nullRecord']).toBeUndefined();
    expect(a['badNote']).toEqual({ note: '', tags: ['real'], pinned: false, updatedAt: 0 });
  });

  it('a failed hydration releases the claim so a later call retries', async () => {
    getCorpusRecordMock.mockRejectedValueOnce(new Error('idb down'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await ensureAnnotationsLoaded('corpus-1')).toBe(false);
    expect(useAnnotationStore.getState().scope).toBeNull();

    getCorpusRecordMock.mockResolvedValue({ annotations: {} });
    expect(await ensureAnnotationsLoaded('corpus-1')).toBe(true);
    expect(useAnnotationStore.getState().scope).toBe('corpus-1');
    warn.mockRestore();
  });

  it('concurrent hydration callers await the same read and completed store update', async () => {
    let complete!: (record: { annotations: Record<string, never> }) => void;
    getCorpusRecordMock.mockImplementationOnce(
      () => new Promise((resolve) => { complete = resolve; }),
    );
    const first = ensureAnnotationsLoaded('corpus-A');
    const second = ensureAnnotationsLoaded('corpus-A');
    expect(second).toBe(first);
    let settled = false;
    void second.then(() => { settled = true; });
    await vi.waitFor(() => expect(getCorpusRecordMock).toHaveBeenCalledOnce());
    expect(settled).toBe(false);
    expect(useAnnotationStore.getState().scope).toBeNull();

    complete({ annotations: {} });
    expect(await first).toBe(true);
    expect(await second).toBe(true);
    expect(useAnnotationStore.getState().scope).toBe('corpus-A');
  });

  it('returning to the visible workspace cancels a pending hydration of another workspace', async () => {
    await ensureAnnotationsLoaded('corpus-A');
    let complete!: (record: { annotations: Record<string, never> }) => void;
    getCorpusRecordMock.mockImplementationOnce(
      () => new Promise((resolve) => { complete = resolve; }),
    );
    const loadingB = ensureAnnotationsLoaded('corpus-B');
    await vi.waitFor(() => expect(getCorpusRecordMock).toHaveBeenCalledTimes(2));
    expect(await ensureAnnotationsLoaded('corpus-A')).toBe(true);
    complete({ annotations: {} });

    expect(await loadingB).toBe(false);
    expect(useAnnotationStore.getState().scope).toBe('corpus-A');
  });

  it('edits without a hydrated scope are ignored rather than persisted nowhere', () => {
    useAnnotationStore.getState().update('doc', { note: 'orphan' });
    expect(useAnnotationStore.getState().annotations['doc']).toBeUndefined();
  });
});

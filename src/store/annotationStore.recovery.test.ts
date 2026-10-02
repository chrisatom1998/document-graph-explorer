// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const repository = vi.hoisted(() => ({ getCorpusRecord: vi.fn(), updateCorpusAnnotations: vi.fn() }));
vi.mock('../persistence/corpusRepository', () => repository);
import { _resetAnnotationsForTests, ensureAnnotationsLoaded, flushAnnotationSave, useAnnotationStore } from './annotationStore';
import { clearJournalAnnotation, journalAnnotation, recoverAnnotations } from './annotationRecovery';

beforeEach(() => {
  localStorage.clear();
  repository.getCorpusRecord.mockReset().mockResolvedValue({ annotations: {} });
  repository.updateCorpusAnnotations.mockReset().mockResolvedValue(undefined);
});
afterEach(() => { _resetAnnotationsForTests(); localStorage.clear(); vi.restoreAllMocks(); });

it('recovers a note and tag after reload interrupts the debounce, scoped to their corpus', async () => {
  await ensureAnnotationsLoaded('A');
  useAnnotationStore.getState().update('document', { note: 'Must survive', tags: ['regression'] });
  expect(repository.updateCorpusAnnotations).not.toHaveBeenCalled();
  _resetAnnotationsForTests(); // page reload loses all timers and memory
  await ensureAnnotationsLoaded('B');
  expect(useAnnotationStore.getState().annotations.document).toBeUndefined();
  await ensureAnnotationsLoaded('A');
  expect(useAnnotationStore.getState().annotations.document).toMatchObject({ note: 'Must survive', tags: ['regression'] });
  await flushAnnotationSave();
  expect(repository.updateCorpusAnnotations).toHaveBeenCalledWith('A', {
    document: expect.objectContaining({ note: 'Must survive', tags: ['regression'] }),
  }, expect.any(Object), expect.any(Object));
  expect(recoverAnnotations('A')).toEqual([]);
});

it('replays deletion without resurrecting the previous saved note', async () => {
  repository.getCorpusRecord.mockResolvedValue({ annotations: { document: { note: 'old', tags: [], pinned: false, updatedAt: 1 } } });
  await ensureAnnotationsLoaded('A');
  useAnnotationStore.getState().update('document', { note: '' });
  _resetAnnotationsForTests();
  await ensureAnnotationsLoaded('A');
  expect(useAnnotationStore.getState().annotations.document).toBeUndefined();
  await flushAnnotationSave();
  expect(repository.updateCorpusAnnotations).toHaveBeenCalledWith('A', { document: null }, expect.any(Object), expect.any(Object));
});

it('keeps the newer recovery copy when an older in-flight write completes', async () => {
  await ensureAnnotationsLoaded('A');
  useAnnotationStore.getState().update('document', { note: 'first' });
  let complete!: () => void;
  repository.updateCorpusAnnotations.mockImplementationOnce(() => new Promise<void>(resolve => { complete = resolve; }));
  const write = flushAnnotationSave();
  useAnnotationStore.getState().update('document', { note: 'second' });
  complete(); await write;
  expect(recoverAnnotations('A')[0].value?.note).toBe('second');
  _resetAnnotationsForTests();
  await ensureAnnotationsLoaded('A');
  expect(useAnnotationStore.getState().annotations.document.note).toBe('second');
});

it('keeps recovery data after a rejected transaction and reports the failure honestly', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  await ensureAnnotationsLoaded('A');
  useAnnotationStore.getState().update('document', { note: 'pending' });
  repository.updateCorpusAnnotations.mockRejectedValueOnce(new Error('quota'));
  await flushAnnotationSave();
  expect(useAnnotationStore.getState().saveStatus).toBe('error');
  expect(recoverAnnotations('A')[0].value?.note).toBe('pending');
  await flushAnnotationSave();
  expect(useAnnotationStore.getState().saveStatus).toBe('saved');
  expect(recoverAnnotations('A')).toEqual([]);
});

it('does not claim saved when both recovery storage and IndexedDB are unavailable', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  await ensureAnnotationsLoaded('A');
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
  repository.updateCorpusAnnotations.mockRejectedValueOnce(new Error('quota'));
  useAnnotationStore.getState().update('document', { note: 'pending' });
  expect(useAnnotationStore.getState().saveStatus).toBe('saving');
  await flushAnnotationSave();
  expect(useAnnotationStore.getState().saveStatus).toBe('error');
  expect(useAnnotationStore.getState().annotations.document.note).toBe('pending');
});

it('never clears a newer tab edit while acknowledging an earlier journal entry', () => {
  const first = journalAnnotation('A', 'doc', { note: 'first', tags: [], pinned: false, updatedAt: 1 })!;
  journalAnnotation('A', 'doc', { note: 'second', tags: [], pinned: false, updatedAt: 2 });
  clearJournalAnnotation('A', 'doc', first);
  expect(recoverAnnotations('A')[0].value?.note).toBe('second');
});

it('ignores malformed recovery data and does not replace a newer committed annotation', async () => {
  localStorage.setItem('knowledge-nebula:pending-annotation:bad-json', '{}');
  journalAnnotation('A', 'document', { note: 'stale', tags: [], pinned: false, updatedAt: 1 });
  repository.getCorpusRecord.mockResolvedValue({ annotations: { document: { note: 'newer', tags: [], pinned: false, updatedAt: Date.now() + 1000 } } });
  await ensureAnnotationsLoaded('A');
  expect(useAnnotationStore.getState().annotations.document.note).toBe('newer');
  expect(recoverAnnotations('A')).toEqual([]);
});

it('compares legacy recovery edit time, not its later journal-write time', async () => {
  localStorage.setItem('knowledge-nebula:pending-annotation:["A","document"]', JSON.stringify({
    value: { note: 'stale', tags: [], pinned: false, updatedAt: 100 }, updatedAt: 103, nonce: 'legacy',
  }));
  repository.getCorpusRecord.mockResolvedValue({ annotations: { document: { note: 'newer', tags: [], pinned: false, updatedAt: 102 } } });
  await ensureAnnotationsLoaded('A');
  expect(useAnnotationStore.getState().annotations.document.note).toBe('newer');
  await flushAnnotationSave();
  expect(repository.updateCorpusAnnotations).not.toHaveBeenCalled();
});
it('retains a committed value on equal timestamps, including deletion tombstones', async () => {
  journalAnnotation('A', 'document', { note: 'stale', tags: [], pinned: false, updatedAt: 100 });
  repository.getCorpusRecord.mockResolvedValue({ annotations: {}, annotationVersions: { document: 100 } });
  await ensureAnnotationsLoaded('A');
  expect(useAnnotationStore.getState().annotations.document).toBeUndefined();
  expect(recoverAnnotations('A')).toEqual([]);
  vi.spyOn(Date, 'now').mockReturnValue(100);
  useAnnotationStore.getState().update('document', { note: 'deliberate new edit' });
  expect(useAnnotationStore.getState().annotations.document.updatedAt).toBe(101);
});
it('keeps separate journals for competing tabs and recovers the newest edit', async () => {
  journalAnnotation('A', 'document', { note: 'newer', tags: [], pinned: false, updatedAt: 102 });
  journalAnnotation('A', 'document', { note: 'older arriving later', tags: [], pinned: false, updatedAt: 100 });
  expect(recoverAnnotations('A')).toHaveLength(2);
  await ensureAnnotationsLoaded('A');
  expect(useAnnotationStore.getState().annotations.document.note).toBe('newer');
});
it('does not infer a legacy deletion clock from its later journal-write time', async () => {
  localStorage.setItem('knowledge-nebula:pending-annotation:["A","document"]', JSON.stringify({ value: null, updatedAt: 103, nonce: 'old-delete' }));
  repository.getCorpusRecord.mockResolvedValue({ annotations: { document: { note: 'keep', tags: [], pinned: false, updatedAt: 102 } } });
  await ensureAnnotationsLoaded('A');
  expect(useAnnotationStore.getState().annotations.document.note).toBe('keep');
});
it('reconciles a transaction conflict but never replaces a later local edit with an older acknowledgement', async () => {
  await ensureAnnotationsLoaded('A');
  vi.spyOn(Date, 'now').mockReturnValue(100);
  useAnnotationStore.getState().update('document', { note: 'first' });
  let complete!: (value: unknown) => void;
  repository.updateCorpusAnnotations.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  const saving = flushAnnotationSave();
  useAnnotationStore.getState().update('document', { note: 'second' });
  complete({ document: { value: { note: 'other tab', tags: [], pinned: false, updatedAt: 103 }, updatedAt: 103 } });
  await saving;
  expect(useAnnotationStore.getState().annotations.document.note).toBe('second');
  useAnnotationStore.getState().update('document', { note: 'third' });
  expect(useAnnotationStore.getState().annotations.document.updatedAt).toBe(104);
});
it('reconciles rejected stale values to the durable transaction result', async () => {
  await ensureAnnotationsLoaded('A');
  useAnnotationStore.getState().update('document', { note: 'stale' });
  repository.updateCorpusAnnotations.mockResolvedValueOnce({ document: { value: { note: 'newer saved', tags: [], pinned: false, updatedAt: Date.now() + 1000 }, updatedAt: Date.now() + 1000 } });
  await flushAnnotationSave();
  expect(useAnnotationStore.getState().annotations.document.note).toBe('newer saved');
  expect(useAnnotationStore.getState().saveStatus).toBe('saved');
});
it('preserves live collaboration equal-time winners without upgrading their edit clock', async () => {
  repository.getCorpusRecord.mockResolvedValue({ annotations: { document: { note: 'local', tags: [], pinned: false, updatedAt: 100 } } });
  await ensureAnnotationsLoaded('A');
  useAnnotationStore.getState().applyRemote('document', { note: 'Yjs winner', tags: [], pinned: false, updatedAt: 100 });
  await flushAnnotationSave();
  expect(repository.updateCorpusAnnotations).toHaveBeenLastCalledWith('A', { document: expect.objectContaining({ note: 'Yjs winner', updatedAt: 100 }) }, { document: 100 }, { document: { value: { note: 'local', tags: [], pinned: false, updatedAt: 100 }, updatedAt: 100 } });
  useAnnotationStore.getState().applyRemote('document', { note: 'old remote', tags: [], pinned: false, updatedAt: 99 });
  expect(useAnnotationStore.getState().annotations.document.note).toBe('Yjs winner');
});
it('ignores delayed unversioned deletes and preserves the original clock of versioned deletes', async () => {
  repository.getCorpusRecord.mockResolvedValue({ annotations: { document: { note: 'newer', tags: [], pinned: false, updatedAt: 102 } } });
  await ensureAnnotationsLoaded('A');
  vi.spyOn(Date, 'now').mockReturnValue(5000);
  useAnnotationStore.getState().applyRemote('document', null);
  useAnnotationStore.getState().applyRemote('document', { note: '', tags: [], pinned: false, updatedAt: 100 });
  expect(useAnnotationStore.getState().annotations.document.note).toBe('newer');
  useAnnotationStore.getState().applyRemote('document', { note: '', tags: [], pinned: false, updatedAt: 103 });
  expect(recoverAnnotations('A')[0]).toMatchObject({ value: null, updatedAt: 103 });
  _resetAnnotationsForTests(); // interrupted deletion before database commit
  await ensureAnnotationsLoaded('A');
  expect(useAnnotationStore.getState().annotations.document).toBeUndefined();
  await flushAnnotationSave();
  expect(repository.updateCorpusAnnotations).toHaveBeenLastCalledWith('A', { document: null }, { document: 103 }, {});
});
it('ignores malformed peer records without throwing or modifying a saved note', async () => {
  await ensureAnnotationsLoaded('A');
  useAnnotationStore.getState().update('document', { note: 'keep' });
  expect(() => useAnnotationStore.getState().applyRemote('document', 'bad' as never)).not.toThrow();
  expect(useAnnotationStore.getState().annotations.document.note).toBe('keep');
});

it('captures and advances the full deletion baseline for queued live changes only after a winning write', async () => {
  repository.getCorpusRecord.mockResolvedValue({ annotations: {}, annotationVersions: { document: 100 } });
  await ensureAnnotationsLoaded('A');
  const deletion = { note: '', tags: [], pinned: false, updatedAt: 101 };
  useAnnotationStore.getState().applyRemote('document', deletion);
  let complete!: (value: unknown) => void;
  repository.updateCorpusAnnotations.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  const saving = flushAnnotationSave();
  useAnnotationStore.getState().applyRemote('document', { ...deletion, note: 'next winner' });
  complete({ document: { value: null, updatedAt: 101 } });
  await saving;
  await flushAnnotationSave();
  expect(repository.updateCorpusAnnotations).toHaveBeenLastCalledWith('A', { document: expect.objectContaining({ note: 'next winner' }) }, { document: 101 }, { document: { value: null, updatedAt: 101 } });
});

it('does not advance a queued null baseline when a competing deletion wins', async () => {
  await ensureAnnotationsLoaded('A');
  const value = { note: 'first', tags: [], pinned: false, updatedAt: 100 };
  useAnnotationStore.getState().applyRemote('document', value);
  let complete!: (value: unknown) => void;
  repository.updateCorpusAnnotations.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  const saving = flushAnnotationSave();
  useAnnotationStore.getState().applyRemote('document', { ...value, note: 'queued' });
  complete({ document: { value: null, updatedAt: 100 } });
  await saving;
  await flushAnnotationSave();
  expect(repository.updateCorpusAnnotations.mock.lastCall?.[3]).toEqual({ document: { value: null, updatedAt: 0 } });
});

it('rejects extreme peers and preserves healthy local edits and deletion', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(1000);
  await ensureAnnotationsLoaded('A');
  useAnnotationStore.getState().update('document', { note: 'keep' });
  useAnnotationStore.getState().applyRemote('document', { note: 'poison', tags: [], pinned: false, updatedAt: Number.MAX_SAFE_INTEGER });
  expect(useAnnotationStore.getState().annotations.document.note).toBe('keep');
  useAnnotationStore.getState().update('document', { note: 'edit' });
  expect(useAnnotationStore.getState().annotations.document.updatedAt).toBe(1001);
  useAnnotationStore.getState().update('document', { note: '' });
  await flushAnnotationSave();
  expect(repository.updateCorpusAnnotations).toHaveBeenLastCalledWith('A', { document: null }, { document: 1002 }, {});
});

it('retains legacy poisoned content but removes its clock authority on hydration', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(1000);
  repository.getCorpusRecord.mockResolvedValue({ annotations: { document: { note: 'keep me', tags: [], pinned: false, updatedAt: Number.MAX_SAFE_INTEGER } }, annotationVersions: { document: Number.MAX_SAFE_INTEGER } });
  await ensureAnnotationsLoaded('A');
  expect(useAnnotationStore.getState().annotations.document).toMatchObject({ note: 'keep me', updatedAt: 0 });
  useAnnotationStore.getState().update('document', { note: 'edited' });
  expect(useAnnotationStore.getState().annotations.document.updatedAt).toBe(1000);
});

it('recovers a healthy journal over a poisoned tombstone and ignores poisoned journals', async () => {
  repository.getCorpusRecord.mockResolvedValue({ annotations: {}, annotationVersions: { document: Number.MAX_SAFE_INTEGER } });
  journalAnnotation('A', 'document', { note: 'healthy recovery', tags: [], pinned: false, updatedAt: 100 });
  journalAnnotation('A', 'document', { note: 'poison', tags: [], pinned: false, updatedAt: Number.MAX_SAFE_INTEGER });
  journalAnnotation('A', 'document', null, Number.MAX_SAFE_INTEGER);
  expect(recoverAnnotations('A')).toHaveLength(1);
  await ensureAnnotationsLoaded('A');
  expect(useAnnotationStore.getState().annotations.document.note).toBe('healthy recovery');
});

it('keeps edits and deletion recoverable after accepting the peer skew ceiling', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(1000);
  const ceiling = 1000 + 24 * 60 * 60 * 1000;
  const value = { note: 'peer', tags: [], pinned: false, updatedAt: ceiling };
  repository.getCorpusRecord.mockResolvedValue({ annotations: { document: value } });
  await ensureAnnotationsLoaded('A');
  useAnnotationStore.getState().applyRemote('document', { ...value, note: 'too far', updatedAt: ceiling + 1 });
  expect(useAnnotationStore.getState().annotations.document.note).toBe('peer');
  useAnnotationStore.getState().applyRemote('document', value);
  useAnnotationStore.getState().update('document', { note: 'local' });
  useAnnotationStore.getState().update('document', { note: 'local again' });
  expect(useAnnotationStore.getState().annotations.document.updatedAt).toBe(ceiling + 2);
  _resetAnnotationsForTests();
  await ensureAnnotationsLoaded('A');
  expect(useAnnotationStore.getState().annotations.document.note).toBe('local again');
  useAnnotationStore.getState().update('document', { note: '' });
  _resetAnnotationsForTests();
  await ensureAnnotationsLoaded('A');
  expect(useAnnotationStore.getState().annotations.document).toBeUndefined();
  await flushAnnotationSave();
  expect(repository.updateCorpusAnnotations).toHaveBeenLastCalledWith('A', { document: null }, { document: ceiling + 3 }, {});
});

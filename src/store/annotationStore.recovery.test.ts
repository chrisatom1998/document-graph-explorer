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
  });
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
  expect(repository.updateCorpusAnnotations).toHaveBeenCalledWith('A', { document: null });
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

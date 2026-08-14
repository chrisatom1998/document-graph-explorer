import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocAnnotationRecord } from '../persistence/db';

const { getCorpusRecordMock, updateCorpusAnnotationsMock } = vi.hoisted(() => ({
  getCorpusRecordMock: vi.fn(),
  updateCorpusAnnotationsMock: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../persistence/corpusRepository', () => ({
  getCorpusRecord: getCorpusRecordMock,
  updateCorpusAnnotations: updateCorpusAnnotationsMock,
}));

import {
  MAX_ANNOTATION_KEY_CHARS,
  MAX_ANNOTATION_NOTE_CHARS,
  MAX_ANNOTATION_RECORDS,
  MAX_ANNOTATION_TAGS,
} from './annotationSanitize';
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

  it('bounds an oversized record pushed by a peer', async () => {
    await ensureAnnotationsLoaded('corpus-1');
    useAnnotationStore.getState().applyRemote('doc', {
      note: 'x'.repeat(MAX_ANNOTATION_NOTE_CHARS + 1000),
      tags: Array.from({ length: MAX_ANNOTATION_TAGS + 10 }, (_, i) => `tag-${i}`),
      pinned: false,
      updatedAt: 10,
    });
    const stored = useAnnotationStore.getState().annotations.doc!;
    expect(stored.note).toHaveLength(MAX_ANNOTATION_NOTE_CHARS);
    expect(stored.tags).toHaveLength(MAX_ANNOTATION_TAGS);
  });

  it('refuses new remote keys at capacity but keeps serving existing ones', async () => {
    const annotations: Record<string, unknown> = {};
    for (let i = 0; i < MAX_ANNOTATION_RECORDS; i++) {
      annotations[`key-${i}`] = { note: 'n', tags: [], pinned: false, updatedAt: 1 };
    }
    getCorpusRecordMock.mockResolvedValue({ annotations });
    await ensureAnnotationsLoaded('corpus-full');

    // A peer cannot grow the store past the cap...
    useAnnotationStore
      .getState()
      .applyRemote('flood', { note: 'flood', tags: [], pinned: false, updatedAt: 5 });
    expect(useAnnotationStore.getState().annotations.flood).toBeUndefined();

    // ...but edits and deletes of records already held still apply, so a full
    // store does not freeze out the legitimate collaborator.
    useAnnotationStore
      .getState()
      .applyRemote('key-0', { note: 'edited', tags: [], pinned: false, updatedAt: 9 });
    expect(useAnnotationStore.getState().annotations['key-0']?.note).toBe('edited');

    useAnnotationStore.getState().applyRemote('key-1', null);
    expect(useAnnotationStore.getState().annotations['key-1']).toBeUndefined();
  });

  it('ignores a remote write under an unusable key', async () => {
    await ensureAnnotationsLoaded('corpus-1');
    const before = { ...useAnnotationStore.getState().annotations };
    useAnnotationStore
      .getState()
      .applyRemote('k'.repeat(MAX_ANNOTATION_KEY_CHARS + 1), {
        note: 'n',
        tags: [],
        pinned: false,
        updatedAt: 1,
      });
    expect(useAnnotationStore.getState().annotations).toEqual(before);
  });

  it('ignores a remote write under a prototype-polluting key', async () => {
    await ensureAnnotationsLoaded('corpus-1');
    useAnnotationStore.getState().applyRemote('__proto__', {
      note: 'pwned',
      tags: [],
      pinned: false,
      updatedAt: 1,
    });
    useAnnotationStore.getState().applyRemote('constructor', {
      note: 'pwned',
      tags: [],
      pinned: false,
      updatedAt: 1,
    });
    const stored = useAnnotationStore.getState().annotations;
    expect(Object.hasOwn(stored, '__proto__')).toBe(false);
    expect(Object.hasOwn(stored, 'constructor')).toBe(false);
    expect(Object.prototype).not.toHaveProperty('note');
  });

  it('does not treat inherited prototype names as existing records at capacity', async () => {
    const annotations: Record<string, unknown> = {};
    for (let i = 0; i < MAX_ANNOTATION_RECORDS; i++) {
      annotations[`key-${i}`] = { note: 'n', tags: [], pinned: false, updatedAt: 1 };
    }
    getCorpusRecordMock.mockResolvedValue({ annotations });
    await ensureAnnotationsLoaded('corpus-full');

    useAnnotationStore.getState().applyRemote('constructor', {
      note: 'bypass',
      tags: [],
      pinned: false,
      updatedAt: 5,
    });
    expect(Object.hasOwn(useAnnotationStore.getState().annotations, 'constructor')).toBe(
      false,
    );
    expect(Object.keys(useAnnotationStore.getState().annotations)).toHaveLength(
      MAX_ANNOTATION_RECORDS,
    );
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

  it('a debounced write is dropped (not misdirected) after an out-of-band re-hydration', async () => {
    await ensureAnnotationsLoaded('corpus-A');
    useAnnotationStore.getState().update('doc', { note: 'A note' });
    useAnnotationStore.getState().hydrate('corpus-B', {});
    await vi.advanceTimersByTimeAsync(400);
    expect(updateCorpusAnnotationsMock).not.toHaveBeenCalled();
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
    await ensureAnnotationsLoaded('corpus-1');
    expect(useAnnotationStore.getState().scope).toBeNull();

    getCorpusRecordMock.mockResolvedValue({ annotations: {} });
    await ensureAnnotationsLoaded('corpus-1');
    expect(useAnnotationStore.getState().scope).toBe('corpus-1');
    warn.mockRestore();
  });

  it('edits without a hydrated scope are ignored rather than persisted nowhere', () => {
    useAnnotationStore.getState().update('doc', { note: 'orphan' });
    expect(useAnnotationStore.getState().annotations['doc']).toBeUndefined();
  });

  // Caps only bound untrusted writes if a local save survives its own reload.
  // Clamping at hydration alone silently ate the tail of a long local note.
  it('bounds a local edit at write time so it reloads byte-identical', async () => {
    getCorpusRecordMock.mockResolvedValue({ annotations: {} });
    await ensureAnnotationsLoaded('corpus-1');
    useAnnotationStore.getState().update('doc', {
      note: 'x'.repeat(MAX_ANNOTATION_NOTE_CHARS + 500),
      tags: Array.from({ length: MAX_ANNOTATION_TAGS + 10 }, (_, i) => `t${i}`),
    });

    const saved = useAnnotationStore.getState().annotations['doc'];
    expect(saved.note).toHaveLength(MAX_ANNOTATION_NOTE_CHARS);
    expect(saved.tags).toHaveLength(MAX_ANNOTATION_TAGS);

    await flushAnnotationSave();
    const [, patch] = updateCorpusAnnotationsMock.mock.calls.at(-1) as [
      string,
      Record<string, unknown>,
    ];
    getCorpusRecordMock.mockResolvedValue({ annotations: patch });
    _resetAnnotationsForTests();
    await ensureAnnotationsLoaded('corpus-1');
    expect(useAnnotationStore.getState().annotations['doc']).toEqual(saved);
  });

  it('refuses a new local key at capacity instead of losing it on reload', async () => {
    const full: Record<string, DocAnnotationRecord> = {};
    for (let i = 0; i < MAX_ANNOTATION_RECORDS; i++) {
      full[`doc-${i}`] = { note: 'n', tags: [], pinned: false, updatedAt: 1 };
    }
    getCorpusRecordMock.mockResolvedValue({ annotations: full });
    await ensureAnnotationsLoaded('corpus-1');

    useAnnotationStore.getState().update('one-too-many', { note: 'dropped' });
    expect(useAnnotationStore.getState().annotations['one-too-many']).toBeUndefined();

    // Editing a record already held still works at the cap.
    useAnnotationStore.getState().update('doc-0', { note: 'edited' });
    expect(useAnnotationStore.getState().annotations['doc-0'].note).toBe('edited');
  });

  it('ignores a local edit under a key that would reshape the map', async () => {
    getCorpusRecordMock.mockResolvedValue({ annotations: {} });
    await ensureAnnotationsLoaded('corpus-1');
    useAnnotationStore.getState().update('__proto__', { note: 'polluted' });
    const a = useAnnotationStore.getState().annotations;
    expect(Object.getPrototypeOf(a)).toBe(Object.prototype);
    expect(Object.keys(a)).toEqual([]);
  });
});

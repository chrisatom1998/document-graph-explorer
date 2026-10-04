import { afterEach, describe, expect, it } from 'vitest';
import {
  captureDirtyDocs,
  clearRuntimeStores,
  dirtyDocIds,
  markDocsClean,
  markDocsDirty,
} from './runtimeStores';

afterEach(clearRuntimeStores);

describe('document save generations', () => {
  it('does not acknowledge the same document in a replaced workspace', () => {
    markDocsDirty(['shared-id']);
    const outgoing = captureDirtyDocs();
    clearRuntimeStores();
    markDocsDirty(['shared-id']);

    expect(markDocsClean(outgoing)).toEqual([]);
    expect(dirtyDocIds.has('shared-id')).toBe(true);
    expect(markDocsClean(captureDirtyDocs())).toEqual(['shared-id']);
    expect(dirtyDocIds.size).toBe(0);
  });
});

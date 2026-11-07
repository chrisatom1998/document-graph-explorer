import { describe, expect, it } from 'vitest';
import { applyDesign, designFromSearch, searchWithDesign, useDesignStore } from './designMode';

describe('design switch', () => {
  it('stays off without the parameter, so the shipped UI is the default', () => {
    expect(designFromSearch('')).toBeNull();
    expect(designFromSearch('?eval=retrieval')).toBeNull();
  });
  it('reads a, b and c, and treats anything else as the current UI with the picker shown', () => {
    expect(designFromSearch('?design=a')).toBe('a');
    expect(designFromSearch('?design=B')).toBe('b');
    expect(designFromSearch('?x=1&design=c')).toBe('c');
    expect(designFromSearch('?design=current')).toBe('current');
    expect(designFromSearch('?design=zzz')).toBe('current');
  });
  it('rewrites only the design parameter', () => {
    expect(searchWithDesign('?eval=retrieval&design=a', 'c')).toBe('?eval=retrieval&design=c');
    expect(searchWithDesign('', 'b')).toBe('?design=b');
  });
  it('marks the root element and the store, and clears both for the current UI', () => {
    const root = { dataset: {} as Record<string, string> } as unknown as HTMLElement;
    applyDesign('b', root);
    expect(root.dataset.design).toBe('b');
    expect(useDesignStore.getState().design).toBe('b');
    applyDesign('current', root);
    expect(root.dataset.design).toBeUndefined();
    expect(useDesignStore.getState().design).toBeNull();
  });
});

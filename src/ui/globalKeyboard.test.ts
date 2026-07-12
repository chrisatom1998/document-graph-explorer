// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { shouldIgnoreGlobalKey } from './globalKeyboard';

describe('global keyboard routing', () => {
  it('lets Escape leave a typing target and reach the panel-close cascade', () => {
    const input = document.createElement('input');

    expect(shouldIgnoreGlobalKey({ key: 'Escape', target: input })).toBe(false);
    expect(shouldIgnoreGlobalKey({ key: 'a', target: input })).toBe(true);
  });
});

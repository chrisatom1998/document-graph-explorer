import { describe, expect, it } from 'vitest';
import { applyDesign } from './designMode';

describe('night session theme', () => {
  it('marks the document so the Night Session styles apply', () => {
    const root = { dataset: {} as Record<string, string> } as unknown as HTMLElement;
    applyDesign(root);
    expect(root.dataset.design).toBe('a');
  });
});

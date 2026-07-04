import { describe, expect, it } from 'vitest';
import { collectViewerLinks } from './openDocument';

describe('collectViewerLinks', () => {
  it('appends url-only targets not covered by labelled links', () => {
    const out = collectViewerLinks(
      [{ text: 'Docs', url: 'https://a.example/docs' }],
      ['https://b.example/extra'],
    );
    expect(out).toEqual([
      { text: 'Docs', url: 'https://a.example/docs' },
      { text: '', url: 'https://b.example/extra' },
    ]);
  });

  it('does not duplicate urls already present in labelled links', () => {
    const out = collectViewerLinks(
      [{ text: 'Docs', url: 'https://a.example/docs' }],
      ['https://a.example/docs'],
    );
    expect(out).toEqual([{ text: 'Docs', url: 'https://a.example/docs' }]);
  });

  it('keeps labelled links first, labels intact', () => {
    const out = collectViewerLinks(
      [
        { text: 'One', url: 'https://one.example' },
        { text: 'Two', url: 'https://two.example' },
      ],
      ['https://three.example'],
    );
    expect(out.map((l) => l.text)).toEqual(['One', 'Two', '']);
  });

  it('returns [] when both inputs are empty', () => {
    expect(collectViewerLinks([], [])).toEqual([]);
  });
});

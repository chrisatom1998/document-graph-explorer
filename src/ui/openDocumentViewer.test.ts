import { describe, expect, it } from 'vitest';
import { escapeHtml, hrefFor, linkifyLine } from './openDocumentViewer';

describe('escapeHtml', () => {
  it('escapes the standard HTML-sensitive characters', () => {
    expect(escapeHtml('&')).toBe('&amp;');
    expect(escapeHtml('<')).toBe('&lt;');
    expect(escapeHtml('>')).toBe('&gt;');
    expect(escapeHtml('"')).toBe('&quot;');
  });

  it('escapes apostrophes', () => {
    expect(escapeHtml("it's")).toBe('it&#39;s');
    expect(escapeHtml("O'Brien's")).toBe('O&#39;Brien&#39;s');
  });

  it('escapes a mix of all special characters in one pass', () => {
    expect(escapeHtml(`<a href="x">it's & "fine"</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;it&#39;s &amp; &quot;fine&quot;&lt;/a&gt;',
    );
  });

  it('leaves plain text untouched', () => {
    expect(escapeHtml('plain text, nothing special')).toBe('plain text, nothing special');
  });
});

describe('hrefFor', () => {
  it('accepts http(s) URLs as-is', () => {
    expect(hrefFor('https://example.com/docs')).toBe('https://example.com/docs');
    expect(hrefFor('http://example.com')).toBe('http://example.com');
  });

  it('upgrades bare www. links to https', () => {
    expect(hrefFor('www.example.com')).toBe('https://www.example.com');
  });

  it('passes mailto: links through unchanged', () => {
    expect(hrefFor('mailto:a@b.com')).toBe('mailto:a@b.com');
  });

  it('converts bare emails to mailto:', () => {
    expect(hrefFor('a@b.com')).toBe('mailto:a@b.com');
  });

  it('returns null for relative paths / bare filenames (graph edges, not web links)', () => {
    expect(hrefFor('notes/foo.md')).toBeNull();
    expect(hrefFor('foo.md')).toBeNull();
    expect(hrefFor('not a link at all')).toBeNull();
  });

  it('rejects non-http(s) schemes (e.g. javascript:) to prevent script-URL injection', () => {
    expect(hrefFor('javascript:alert(1)')).toBeNull();
  });
});

describe('linkifyLine', () => {
  it('escapes plain text with no links', () => {
    expect(linkifyLine('plain <text> & stuff')).toBe('plain &lt;text&gt; &amp; stuff');
  });

  it('turns a bare URL into an anchor and escapes the surrounding text', () => {
    const out = linkifyLine('see https://example.com/docs for <details>');
    expect(out).toContain('<a class="doc-link" href="https://example.com/docs"');
    expect(out).toContain('&lt;details&gt;');
  });

  it('trims trailing sentence punctuation off the URL and keeps it outside the anchor', () => {
    const out = linkifyLine('read this (https://example.com).');
    expect(out).toContain('href="https://example.com"');
    expect(out).toContain('>https://example.com</a>).');
  });

  it('linkifies a bare email as a mailto: anchor', () => {
    const out = linkifyLine('contact a@b.com today');
    expect(out).toContain('href="mailto:a@b.com"');
  });

  it('escapes an apostrophe inside the surrounding text (not inside a link)', () => {
    expect(linkifyLine("it's fine")).toBe('it&#39;s fine');
  });

  it('handles multiple links on one line', () => {
    const out = linkifyLine('a: https://a.example b: https://b.example');
    expect(out).toContain('href="https://a.example"');
    expect(out).toContain('href="https://b.example"');
  });
});

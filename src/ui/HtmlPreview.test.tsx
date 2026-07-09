// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import HtmlPreview from './HtmlPreview';

describe('HtmlPreview sanitizer', () => {
  it('renders a data: image', () => {
    const html = '<img src="data:image/png;base64,AAAA" alt="inline" />';
    const { container } = render(<HtmlPreview html={html} />);
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('src')).toBe('data:image/png;base64,AAAA');
  });

  it('renders a blob: image', () => {
    const html = '<img src="blob:http://localhost/abc-123" alt="blob" />';
    const { container } = render(<HtmlPreview html={html} />);
    expect(container.querySelector('img')).not.toBeNull();
  });

  it('blocks a remote http(s) image and shows a placeholder instead of the <img>', () => {
    const html = '<img src="https://evil.example/tracker.png" alt="remote" />';
    const { container } = render(<HtmlPreview html={html} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toMatch(/remote image blocked/i);
  });

  it('blocks a javascript: "image" the same way', () => {
    const html = '<img src="javascript:alert(1)" alt="xss" />';
    const { container } = render(<HtmlPreview html={html} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toMatch(/remote image blocked/i);
  });

  it('allows http(s)/mailto links but keeps unsafe schemes as plain text', () => {
    const html = `
      <a href="https://example.com">safe</a>
      <a href="mailto:a@b.com">mail</a>
      <a href="javascript:alert(1)">unsafe</a>
    `;
    const { container } = render(<HtmlPreview html={html} />);
    const anchors = container.querySelectorAll('a');
    expect(anchors.length).toBe(2);
    expect([...anchors].map((a) => a.getAttribute('href'))).toEqual([
      'https://example.com',
      'mailto:a@b.com',
    ]);
    // The unsafe-scheme link's text still renders — just unwrapped, not a link.
    expect(container.textContent).toContain('unsafe');
  });

  it('never executes/renders <script> content', () => {
    const html = '<div>hello</div><script>window.__pwned = true;</script>';
    const { container } = render(<HtmlPreview html={html} />);
    expect(container.querySelector('script')).toBeNull();
    expect((window as unknown as Record<string, unknown>).__pwned).toBeUndefined();
  });

  it('falls back to a plain pre-wrap dump above MAX_RENDER_CHARS', async () => {
    const { MAX_RENDER_CHARS } = await import('./HtmlPreview');
    const huge = `<p>${'x'.repeat(MAX_RENDER_CHARS + 10)}</p>`;
    const { container } = render(<HtmlPreview html={huge} />);
    expect(container.querySelector('p')).toBeNull();
    expect(container.textContent).toContain('x'.repeat(50));
  });
});

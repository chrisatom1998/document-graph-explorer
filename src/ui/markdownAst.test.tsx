// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import type { Root } from 'mdast';
import { renderMarkdownChildren, type MarkdownRenderOptions } from './markdownAst';

const processor = unified().use(remarkParse).use(remarkGfm);

function renderMd(md: string, opts: MarkdownRenderOptions = {}) {
  const tree = processor.parse(md) as Root;
  return render(<div>{renderMarkdownChildren(tree.children, 'md', opts)}</div>);
}

describe('markdownAst link filtering (SAFE_LINK_PROTOCOL)', () => {
  it('renders an http(s) link as a real anchor', () => {
    const { container } = renderMd('[docs](https://example.com/docs)');
    const a = container.querySelector('a');
    expect(a).not.toBeNull();
    expect(a?.getAttribute('href')).toBe('https://example.com/docs');
  });

  it('renders a mailto: link as a real anchor', () => {
    const { container } = renderMd('[mail](mailto:a@b.com)');
    const a = container.querySelector('a');
    expect(a?.getAttribute('href')).toBe('mailto:a@b.com');
  });

  it('drops the anchor (but keeps the label text) for a javascript: link', () => {
    const { container } = renderMd('[click me](javascript:alert(1))');
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toContain('click me');
  });

  it('drops the anchor for a data: link too', () => {
    const { container } = renderMd('[x](data:text/html,<script>alert(1)</script>)');
    expect(container.querySelector('a')).toBeNull();
  });

  it('with resolveInternalLink: a doc match renders as an internal-link button regardless of protocol', () => {
    const { container } = renderMd('[note](relative/note.md)', {
      resolveInternalLink: (target) => (target === 'relative/note.md' ? 'doc-1' : null),
    });
    const btn = container.querySelector('button.md-link--internal');
    expect(btn).not.toBeNull();
    expect(container.querySelector('a')).toBeNull();
  });

  it('with resolveInternalLink: an unmatched but safe-protocol link still renders as a real anchor', () => {
    const { container } = renderMd('[ext](https://example.com)', {
      resolveInternalLink: () => null,
    });
    const a = container.querySelector('a');
    expect(a?.getAttribute('href')).toBe('https://example.com');
  });

  it('with resolveInternalLink: an unmatched, unsafe-protocol link renders as an unresolved internal link, not a live anchor', () => {
    const { container } = renderMd('[bad](javascript:alert(1))', {
      resolveInternalLink: () => null,
    });
    expect(container.querySelector('a')).toBeNull();
    expect(container.querySelector('.md-link--unresolved')).not.toBeNull();
  });
});

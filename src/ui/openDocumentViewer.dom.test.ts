// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDocumentViewer } from './openDocumentViewer';
import type { DocNode, LinkRef } from '../model/types';

const node: DocNode = {
  id: 'doc1',
  kind: 'document',
  title: '<img src=x onerror>',
  fileType: 'md',
  summary: '</script><img src=x onerror>',
  topics: ['<script>alert(1)</script>'],
  entities: [],
  keywords: [],
  wordCount: 12,
  cluster: 0,
  degree: 0,
  status: 'ok',
};

describe('openDocumentViewer browser HTML', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('drops hostile extracted links and writes escaped viewer HTML', () => {
    const writes: string[] = [];
    const close = vi.fn();
    vi.spyOn(window, 'open').mockReturnValue({
      document: {
        write: (html: string) => writes.push(html),
        close,
      },
    } as unknown as Window);
    const links: LinkRef[] = [
      { text: 'Script', url: 'javascript:alert(1)' },
      { text: 'Data', url: 'data:text/html,<script>x</script>' },
      { text: 'File', url: 'file:///Users/Owner/secret.txt' },
      { text: 'Safe', url: 'https://safe.example/"onmouseover="x' },
    ];

    openDocumentViewer(
      node,
      '<img src=x onerror>\n```js\n</script><img src=x onerror=x>\n```',
      '',
      links,
    );

    expect(close).toHaveBeenCalledTimes(1);
    expect(writes).toHaveLength(1);
    const html = writes[0];
    expect(html).toContain('&lt;img');
    expect(html).toContain('&lt;/script&gt;');
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain('href="data:');
    expect(html).not.toContain('href="file:');
    expect(html).toContain('href="https://safe.example/&quot;onmouseover=&quot;x"');
    expect(html).not.toContain('href="https://safe.example/"onmouseover="x"');
  });
});

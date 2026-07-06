/**
 * Renders assistant chat replies as Markdown.
 *
 * mdast -> React, built by hand (no dangerouslySetInnerHTML, no extra deps):
 * unified + remark-parse produce an mdast tree, remark-gfm extends the
 * parser for tables/strikethrough/autolinks, and renderMarkdownChildren
 * (shared with DocumentMarkdown — see ../ui/markdownAst) turns each node
 * into the matching React element. Anything without a case (raw html,
 * footnotes, images, ...) falls back to its plain-text content via
 * mdast-util-to-string, so nothing is ever injected as real HTML.
 *
 * NOTE ON THREADING: remark's markdown parsing pulls in an HTML entity
 * decoder that resolves through `document` in some transitive deps, which
 * crashes if it ever runs inside a Web Worker (this project has hit that
 * before). ChatMarkdown is only ever rendered by ChatPanel on the MAIN
 * THREAD, so that's not a concern here — just don't move chat rendering
 * into a worker later.
 */

import { useMemo, type ReactNode } from 'react';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import type { Root } from 'mdast';
import { renderMarkdownChildren } from '../ui/markdownAst';

// One processor for the module: constructing unified() + resolving plugins on
// every parse is measurable when a streaming reply re-parses per delta.
const processor = unified().use(remarkParse).use(remarkGfm);

/**
 * Renders `text` as Markdown. Parses on the main thread with unified +
 * remark-parse + remark-gfm (see file header) and walks the resulting mdast
 * tree into React elements. Headings render as heavy paragraphs (chat
 * bubbles don't need real h1-h6s) and there's no internal-link resolution —
 * that's DocumentMarkdown's job.
 */
export default function ChatMarkdown({ text }: { text: string }): ReactNode {
  const tree = useMemo<Root | null>(() => {
    try {
      return processor.parse(text);
    } catch {
      return null;
    }
  }, [text]);

  if (!tree) {
    return <p className="chat-bubble__text">{text}</p>;
  }

  return (
    <div className="chat-md">
      {renderMarkdownChildren(tree.children, 'md', { flattenHeadings: true })}
    </div>
  );
}

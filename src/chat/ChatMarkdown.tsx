/**
 * Renders assistant chat replies as Markdown.
 *
 * mdast -> React, built by hand (no dangerouslySetInnerHTML, no extra deps):
 * unified + remark-parse produce an mdast tree, remark-gfm extends the
 * parser for tables/strikethrough/autolinks, and the recursive switch below
 * turns each node into the matching React element. Anything without a case
 * (raw html, footnotes, images, ...) falls back to its plain-text content
 * via mdast-util-to-string, so nothing is ever injected as real HTML.
 *
 * NOTE ON THREADING: remark's markdown parsing pulls in an HTML entity
 * decoder that resolves through `document` in some transitive deps, which
 * crashes if it ever runs inside a Web Worker (this project has hit that
 * before). ChatMarkdown is only ever rendered by ChatPanel on the MAIN
 * THREAD, so that's not a concern here — just don't move chat rendering
 * into a worker later.
 */

import { Fragment, useMemo, type ReactNode } from 'react';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { toString as mdastToString } from 'mdast-util-to-string';
import type { Root, RootContent } from 'mdast';

const SAFE_LINK_PROTOCOL = /^(https?:|mailto:)/i;

// One processor for the module: constructing unified() + resolving plugins on
// every parse is measurable when a streaming reply re-parses per delta.
const processor = unified().use(remarkParse).use(remarkGfm);

function renderChildren(nodes: RootContent[], keyPrefix: string): ReactNode[] {
  return nodes.map((node, i) => renderNode(node, `${keyPrefix}-${i}`));
}

function renderNode(node: RootContent, key: string): ReactNode {
  switch (node.type) {
    case 'paragraph':
      return <p key={key}>{renderChildren(node.children, key)}</p>;

    case 'heading':
      // Chat bubbles don't need real h1-h6s — render as a heavier paragraph.
      return (
        <p key={key} className="chat-md-heading">
          {renderChildren(node.children, key)}
        </p>
      );

    case 'strong':
      return <strong key={key}>{renderChildren(node.children, key)}</strong>;

    case 'emphasis':
      return <em key={key}>{renderChildren(node.children, key)}</em>;

    case 'delete':
      return <del key={key}>{renderChildren(node.children, key)}</del>;

    case 'inlineCode':
      return <code key={key}>{node.value}</code>;

    case 'code':
      return (
        <pre key={key} className="chat-md-pre">
          <code>{node.value}</code>
        </pre>
      );

    case 'list': {
      const items = node.children.map((item, i) => renderNode(item, `${key}-${i}`));
      return node.ordered ? (
        <ol key={key} start={typeof node.start === 'number' ? node.start : undefined}>
          {items}
        </ol>
      ) : (
        <ul key={key}>{items}</ul>
      );
    }

    case 'listItem':
      return <li key={key}>{renderChildren(node.children, key)}</li>;

    case 'link': {
      const children = renderChildren(node.children, key);
      if (!SAFE_LINK_PROTOCOL.test(node.url)) {
        // Only http(s)/mailto are followable — anything else (javascript:,
        // data:, relative app paths that don't exist, ...) renders as text.
        return <Fragment key={key}>{children}</Fragment>;
      }
      return (
        <a key={key} href={node.url} target="_blank" rel="noopener noreferrer">
          {children}
        </a>
      );
    }

    case 'blockquote':
      return <blockquote key={key}>{renderChildren(node.children, key)}</blockquote>;

    case 'thematicBreak':
      return <hr key={key} />;

    case 'break':
      return <br key={key} />;

    case 'table': {
      const [headRow, ...bodyRows] = node.children;
      return (
        <div key={key} className="chat-md-table-wrap">
          <table>
            {headRow && (
              <thead>
                <tr>
                  {headRow.children.map((cell, ci) => (
                    <th key={`${key}-th-${ci}`}>{renderChildren(cell.children, `${key}-th-${ci}`)}</th>
                  ))}
                </tr>
              </thead>
            )}
            <tbody>
              {bodyRows.map((row, ri) => (
                <tr key={`${key}-tr-${ri}`}>
                  {row.children.map((cell, ci) => (
                    <td key={`${key}-td-${ri}-${ci}`}>
                      {renderChildren(cell.children, `${key}-td-${ri}-${ci}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    case 'text':
      return node.value;

    default:
      // Unknown/unsupported node (raw html, images, footnotes, ...) — fall
      // back to its plain text rather than dropping or unsafely injecting it.
      return mdastToString(node);
  }
}

/**
 * Renders `text` as Markdown. Parses on the main thread with unified +
 * remark-parse + remark-gfm (see file header) and walks the resulting mdast
 * tree into React elements.
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

  return <div className="chat-md">{renderChildren(tree.children, 'md')}</div>;
}

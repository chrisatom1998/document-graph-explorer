/**
 * Shared mdast -> React renderer used by ChatMarkdown (assistant chat
 * bubbles) and DocumentMarkdown (the SidePanel's Obsidian-style document
 * preview). One recursive walk, parameterized by MarkdownRenderOptions, so
 * the two surfaces can't drift apart on how the same node types render.
 *
 * Same safety rule as before: no dangerouslySetInnerHTML, ever. Anything
 * without a case (raw html, images, footnotes, ...) falls back to its
 * plain-text content via mdast-util-to-string.
 */

import { Fragment, type ReactNode } from 'react';
import { toString as mdastToString } from 'mdast-util-to-string';
import type { RootContent } from 'mdast';

export const SAFE_LINK_PROTOCOL = /^(https?:|mailto:)/i;

// Obsidian-style [[Note]] / [[Note|Alias]] wikilinks. remark has no notion of
// these — they arrive as literal text — so they're matched with a regex over
// each text leaf, only when enableWikilinks is set (chat replies never use
// this syntax, so there's no reason to scan for it there).
const WIKILINK_RE = /\[\[([^[\]|]+)(?:\|([^[\]]+))?\]\]/g;

export interface MarkdownRenderOptions {
  /** Chat bubbles: render headings as a bold paragraph, not a real <hN>. */
  flattenHeadings?: boolean;
  /** Resolve a link href / wikilink target to a doc id already in the graph. */
  resolveInternalLink?: (target: string) => string | null;
  /** Navigate to a resolved internal doc id (ignored when absent). */
  onNavigate?: (docId: string) => void;
  /** Recognize Obsidian-style [[wikilinks]] inside plain text. */
  enableWikilinks?: boolean;
}

/** A link that either jumps to a doc in the graph, or is shown unresolved. */
function renderInternalLink(
  key: string,
  label: ReactNode,
  docId: string | null,
  opts: MarkdownRenderOptions,
): ReactNode {
  if (docId) {
    return (
      <button
        key={key}
        type="button"
        className="md-link md-link--internal"
        onClick={() => opts.onNavigate?.(docId)}
      >
        {label}
      </button>
    );
  }
  return (
    <span
      key={key}
      className="md-link md-link--unresolved"
      title="No matching document in this graph"
    >
      {label}
    </span>
  );
}

function renderTextWithWikilinks(value: string, key: string, opts: MarkdownRenderOptions): ReactNode {
  if (!opts.enableWikilinks || !value.includes('[[')) return value;
  const parts: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of value.matchAll(WIKILINK_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) parts.push(value.slice(last, idx));
    const target = m[1].trim();
    const alias = m[2]?.trim();
    const docId = opts.resolveInternalLink ? opts.resolveInternalLink(target) : null;
    parts.push(renderInternalLink(`${key}-wl-${i}`, alias || target, docId, opts));
    last = idx + m[0].length;
    i += 1;
  }
  if (last === 0) return value; // no wikilinks found
  if (last < value.length) parts.push(value.slice(last));
  return <Fragment key={key}>{parts}</Fragment>;
}

export function renderMarkdownChildren(
  nodes: RootContent[],
  keyPrefix: string,
  opts: MarkdownRenderOptions,
): ReactNode[] {
  return nodes.map((node, i) => renderMarkdownNode(node, `${keyPrefix}-${i}`, opts));
}

export function renderMarkdownNode(node: RootContent, key: string, opts: MarkdownRenderOptions): ReactNode {
  switch (node.type) {
    case 'paragraph':
      return <p key={key}>{renderMarkdownChildren(node.children, key, opts)}</p>;

    case 'heading': {
      if (opts.flattenHeadings) {
        return (
          <p key={key} className="chat-md-heading">
            {renderMarkdownChildren(node.children, key, opts)}
          </p>
        );
      }
      const depth = Math.min(6, Math.max(1, node.depth)) as 1 | 2 | 3 | 4 | 5 | 6;
      const children = renderMarkdownChildren(node.children, key, opts);
      const className = `md-heading md-h${depth}`;
      switch (depth) {
        case 1:
          return <h1 key={key} className={className}>{children}</h1>;
        case 2:
          return <h2 key={key} className={className}>{children}</h2>;
        case 3:
          return <h3 key={key} className={className}>{children}</h3>;
        case 4:
          return <h4 key={key} className={className}>{children}</h4>;
        case 5:
          return <h5 key={key} className={className}>{children}</h5>;
        default:
          return <h6 key={key} className={className}>{children}</h6>;
      }
    }

    case 'strong':
      return <strong key={key}>{renderMarkdownChildren(node.children, key, opts)}</strong>;

    case 'emphasis':
      return <em key={key}>{renderMarkdownChildren(node.children, key, opts)}</em>;

    case 'delete':
      return <del key={key}>{renderMarkdownChildren(node.children, key, opts)}</del>;

    case 'inlineCode':
      return <code key={key}>{node.value}</code>;

    case 'code':
      return (
        <pre key={key} className="chat-md-pre">
          <code>{node.value}</code>
        </pre>
      );

    case 'list': {
      const items = node.children.map((item, i) => renderMarkdownNode(item, `${key}-${i}`, opts));
      return node.ordered ? (
        <ol key={key} start={typeof node.start === 'number' ? node.start : undefined}>
          {items}
        </ol>
      ) : (
        <ul key={key}>{items}</ul>
      );
    }

    case 'listItem':
      return <li key={key}>{renderMarkdownChildren(node.children, key, opts)}</li>;

    case 'link': {
      const children = renderMarkdownChildren(node.children, key, opts);
      if (opts.resolveInternalLink) {
        const docId = opts.resolveInternalLink(node.url);
        if (docId) return renderInternalLink(key, children, docId, opts);
        if (SAFE_LINK_PROTOCOL.test(node.url)) {
          return (
            <a key={key} href={node.url} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          );
        }
        // Relative path that isn't external and didn't match a doc — show it
        // as an unresolved link (Obsidian-style) rather than dropping it.
        return renderInternalLink(key, children, null, opts);
      }
      if (!SAFE_LINK_PROTOCOL.test(node.url)) {
        return <Fragment key={key}>{children}</Fragment>;
      }
      return (
        <a key={key} href={node.url} target="_blank" rel="noopener noreferrer">
          {children}
        </a>
      );
    }

    case 'blockquote':
      return <blockquote key={key}>{renderMarkdownChildren(node.children, key, opts)}</blockquote>;

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
                    <th key={`${key}-th-${ci}`}>{renderMarkdownChildren(cell.children, `${key}-th-${ci}`, opts)}</th>
                  ))}
                </tr>
              </thead>
            )}
            <tbody>
              {bodyRows.map((row, ri) => (
                <tr key={`${key}-tr-${ri}`}>
                  {row.children.map((cell, ci) => (
                    <td key={`${key}-td-${ri}-${ci}`}>
                      {renderMarkdownChildren(cell.children, `${key}-td-${ri}-${ci}`, opts)}
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
      return renderTextWithWikilinks(node.value, key, opts);

    default:
      // Unknown/unsupported node (raw html, images, footnotes, ...) — fall
      // back to its plain text rather than dropping or unsafely injecting it.
      return mdastToString(node);
  }
}

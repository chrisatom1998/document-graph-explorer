/**
 * Safe, sanitized HTML preview for the SidePanel document reader's .html
 * documents — the same "show it like the real file" treatment as
 * DocumentMarkdown/PdfPreview/CsvPreview. Needs the ORIGINAL bytes (the
 * pipeline's extracted text has already stripped every tag — see
 * pipeline/parsers/html.ts) so callers should pass the original file's
 * decoded bytes; see SidePanel's use of persistence/originals.
 *
 * SECURITY: never uses dangerouslySetInnerHTML. Parses via DOMParser (no
 * script execution — DOMParser-created documents are inert) and walks the
 * resulting tree, converting each node to a React element from a strict
 * allowlist:
 *   - script/style/iframe/object/embed/form/input/etc. are DANGEROUS_TAGS —
 *     dropped entirely, node AND descendants.
 *   - a small KNOWN_TAGS set (headings, lists, tables, emphasis, ...) is
 *     rendered as the matching real element.
 *   - anything else (e.g. <font>, <center>) is "unwrapped" — its children
 *     still render so content isn't silently lost, but the tag itself and
 *     any attributes it carried are dropped.
 * Only a few attributes ever survive the trip: `href`/`src` (protocolchecked), `alt`, `colSpan`/`rowSpan`, `start`. class/id/style/on* and
 * everything else are dropped, so no CSS- or event-handler-based injection
 * survives either.
 */

import { createElement, Fragment, useMemo, type ReactNode } from 'react';
import { SAFE_LINK_PROTOCOL } from './markdownAst';

// Remote (http/https) images are deliberately excluded: loading them would
// leak the fact that this document was opened (and when) to whatever host
// serves the image, breaking the "documents never leave this browser"
// guarantee. Only protocols that stay local/embedded survive.
const SAFE_IMG_PROTOCOL = /^(data:|blob:)/i;

/** Never rendered — node AND descendants are dropped entirely. */
const DANGEROUS_TAGS = new Set([
  'script', 'style', 'iframe', 'object', 'embed', 'applet', 'form', 'input',
  'button', 'textarea', 'select', 'option', 'link', 'meta', 'base',
  'template', 'noscript', 'audio', 'video', 'source', 'track', 'canvas',
  'svg', 'math', 'title', 'head',
]);

/** Rendered as the plain matching element with no special attribute handling. */
const SIMPLE_TAGS = new Set([
  'p', 'div', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'li', 'table', 'thead', 'tbody', 'tfoot', 'tr',
  'strong', 'b', 'em', 'i', 'u', 's', 'del', 'blockquote',
  'pre', 'code', 'small', 'sub', 'sup', 'figure', 'figcaption',
]);

/** Above this, skip the DOM walk (perf safety net) and fall back to a plain dump. */
export const MAX_RENDER_CHARS = 8_000_000;

function renderChildren(node: Node, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  let i = 0;
  for (const child of Array.from(node.childNodes)) {
    out.push(renderNode(child, `${keyPrefix}-${i}`));
    i += 1;
  }
  return out;
}

function renderNode(node: Node, key: string): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return null; // comments, etc. — never rendered
  }

  const el = node as Element;
  const tag = el.tagName.toLowerCase();

  if (DANGEROUS_TAGS.has(tag)) return null;

  const children = renderChildren(el, key);

  if (tag === 'a') {
    const href = (el.getAttribute('href') ?? '').trim();
    if (SAFE_LINK_PROTOCOL.test(href)) {
      return (
        <a key={key} href={href} target="_blank" rel="noopener noreferrer">
          {children}
        </a>
      );
    }
    return <Fragment key={key}>{children}</Fragment>;
  }

  if (tag === 'img') {
    const src = (el.getAttribute('src') ?? '').trim();
    if (!SAFE_IMG_PROTOCOL.test(src)) {
      return (
        <span key={key} className="html-doc__blocked-img" title={src || undefined}>
          🖼 Remote image blocked
        </span>
      );
    }
    return <img key={key} src={src} alt={el.getAttribute('alt') ?? ''} loading="lazy" />;
  }

  if (tag === 'br') return <br key={key} />;
  if (tag === 'hr') return <hr key={key} />;

  if (tag === 'td' || tag === 'th') {
    const colSpan = Number(el.getAttribute('colspan'));
    const rowSpan = Number(el.getAttribute('rowspan'));
    return createElement(
      tag,
      {
        key,
        colSpan: colSpan > 0 ? colSpan : undefined,
        rowSpan: rowSpan > 0 ? rowSpan : undefined,
      },
      children,
    );
  }

  if (tag === 'ol') {
    const start = Number(el.getAttribute('start'));
    return createElement('ol', { key, start: start > 0 ? start : undefined }, children);
  }

  if (SIMPLE_TAGS.has(tag)) {
    return createElement(tag, { key }, children);
  }

  // Unknown/unsupported tag — keep the content, drop the wrapper.
  return <Fragment key={key}>{children}</Fragment>;
}

interface HtmlPreviewProps {
  html: string;
  className?: string;
}

export default function HtmlPreview({ html, className }: HtmlPreviewProps) {
  const tree = useMemo<ReactNode[] | null>(() => {
    if (html.length > MAX_RENDER_CHARS) return null;
    try {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      return renderChildren(doc.body, 'html');
    } catch {
      return null;
    }
  }, [html]);

  const wrapClass = className ? `html-doc ${className}` : 'html-doc';

  if (!tree) {
    return (
      <div className={wrapClass} style={{ whiteSpace: 'pre-wrap' }}>
        {html}
      </div>
    );
  }

  return <div className={wrapClass}>{tree}</div>;
}

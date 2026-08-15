/**
 * Obsidian-style rendered markdown preview for the SidePanel document
 * reader (spec §7.3). Renders real headings/lists/tables/code, and turns
 * relative links + [[wikilinks]] that resolve to another ingested document
 * into an in-app jump (selects that node + frames the camera) instead of a
 * dead link — mirroring Obsidian's internal-link navigation.
 *
 * Needs the RAW markdown source (link/heading syntax intact), not the
 * pipeline's extracted plain text (pipeline/parsers/markdown.ts strips all
 * markdown syntax for search/embedding). Callers should pass the original
 * file's decoded bytes; see SidePanel's use of persistence/originals.
 */

import { useMemo } from 'react';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import type { Root } from 'mdast';
import { renderMarkdownChildren } from './markdownAst';
import { resolveLinkTarget, type LinkIndex } from '../graph/linkResolver';
import VirtualText from './VirtualText';

const processor = unified().use(remarkParse).use(remarkGfm);

import { MAX_RENDER_CHARS, getFallbackExcerpt } from './readerUtils';

export { MAX_RENDER_CHARS };

interface DocumentMarkdownProps {
  text: string;
  linkIndex: LinkIndex;
  onNavigate: (docId: string) => void;
  className?: string;
  highlight?: string | null;
}

export default function DocumentMarkdown({ text, linkIndex, onNavigate, className, highlight }: DocumentMarkdownProps) {
  const tree = useMemo<Root | null>(() => {
    if (text.length > MAX_RENDER_CHARS) return null;
    try {
      return processor.parse(text);
    } catch {
      return null;
    }
  }, [text]);

  const wrapClass = className ? `md-doc ${className}` : 'md-doc';

  // The element tree is the expensive part (a long doc yields thousands of
  // elements) — rebuild it only when the source or link wiring changes, not
  // on every parent re-render.
  const rendered = useMemo(
    () =>
      tree
        ? renderMarkdownChildren(tree.children, 'doc', {
            enableWikilinks: true,
            resolveInternalLink: (target) => resolveLinkTarget(target, linkIndex),
            onNavigate,
          })
        : null,
    [tree, linkIndex, onNavigate],
  );

  // Oversized / unparseable: show a bounded plain-text excerpt via VirtualText
  // instead of mounting an 8 MB+ text node that freezes the main thread.
  if (!tree) {
    const excerpt = getFallbackExcerpt(text);
    return <VirtualText text={excerpt} className={wrapClass} highlight={highlight} />;
  }

  return <div className={wrapClass}>{rendered}</div>;
}

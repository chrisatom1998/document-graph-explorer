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

/**
 * Above this, skip the mdast walk (perf safety net for pathological inputs)
 * and fall back to a plain dump. Real-world exported docs (e.g. a Google
 * Docs "Download as Markdown") can easily run several MB — a 400 KB cap
 * silently downgraded those to the raw, unstripped-syntax plain-text
 * reader, which looked broken. 8 MB comfortably covers realistic docs while
 * still guarding against multi-MB one-off pastes tanking the main thread.
 */
export const MAX_RENDER_CHARS = 8_000_000;

/** Cap on the plain-text fallback so a single huge line can't freeze the DOM. */
const FALLBACK_EXCERPT_CHARS = 200_000;

interface DocumentMarkdownProps {
  text: string;
  linkIndex: LinkIndex;
  onNavigate: (docId: string) => void;
  className?: string;
}

export default function DocumentMarkdown({ text, linkIndex, onNavigate, className }: DocumentMarkdownProps) {
  const tree = useMemo<Root | null>(() => {
    if (text.length > MAX_RENDER_CHARS) return null;
    try {
      return processor.parse(text);
    } catch {
      return null;
    }
  }, [text]);

  const wrapClass = className ? `md-doc ${className}` : 'md-doc';

  // Oversized / unparseable: show a bounded plain-text excerpt via VirtualText
  // instead of mounting an 8 MB+ text node that freezes the main thread.
  if (!tree) {
    const excerpt =
      text.length > FALLBACK_EXCERPT_CHARS
        ? `${text.slice(0, FALLBACK_EXCERPT_CHARS)}\n\n… (truncated)`
        : text;
    return <VirtualText text={excerpt} className={wrapClass} />;
  }

  return (
    <div className={wrapClass}>
      {renderMarkdownChildren(tree.children, 'doc', {
        enableWikilinks: true,
        resolveInternalLink: (target) => resolveLinkTarget(target, linkIndex),
        onNavigate,
      })}
    </div>
  );
}

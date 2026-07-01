/**
 * Structure-aware Markdown parser (spec §4.2): remark mdast walk for the
 * heading tree, link/definition URLs, and plain text. Worker-safe.
 */

import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { visit } from 'unist-util-visit';
import { toString as mdToString } from 'mdast-util-to-string';
import type {
  Definition,
  Heading,
  Link,
  ListItem,
  Root,
  RootContent,
  TableRow,
} from 'mdast';
import { cleanFilename, decodeText, type ParserResult } from './txt';

const processor = unified().use(remarkParse).use(remarkGfm);

/**
 * Text of one top-level block. Lists/blockquotes/tables get per-item /
 * per-row newlines so line-based boilerplate detection sees real lines.
 */
function blockText(node: RootContent): string {
  switch (node.type) {
    case 'list':
      return node.children
        .map((item: ListItem) => item.children.map(blockText).join('\n'))
        .join('\n');
    case 'blockquote':
      return node.children.map(blockText).join('\n');
    case 'table':
      return node.children
        .map((row: TableRow) => row.children.map((cell) => mdToString(cell)).join(' '))
        .join('\n');
    default:
      return mdToString(node);
  }
}

export function parseMarkdown(bytes: ArrayBuffer, name: string): ParserResult {
  const raw = decodeText(bytes);
  const tree: Root = processor.parse(raw);

  let title = '';
  const headings: string[] = [];
  const mdLinkTargets: string[] = [];

  visit(tree, 'heading', (node: Heading) => {
    const text = mdToString(node).trim();
    if (!text) return;
    headings.push(text);
    if (!title && node.depth === 1) title = text; // first depth-1 heading
  });
  visit(tree, 'link', (node: Link) => {
    if (node.url) mdLinkTargets.push(node.url);
  });
  visit(tree, 'definition', (node: Definition) => {
    if (node.url) mdLinkTargets.push(node.url);
  });

  // join block nodes with newlines so line-based boilerplate detection works
  const text = tree.children
    .map(blockText)
    .filter((block) => block.length > 0)
    .join('\n');

  return {
    title: title || cleanFilename(name),
    text,
    headings,
    mdLinkTargets,
    status: 'ok',
  };
}

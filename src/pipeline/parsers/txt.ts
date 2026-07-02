/**
 * Plain-text parser (.txt/.log and 'other' text-ish types) plus shared
 * helpers for the other parsers. Worker-safe (no DOM).
 */

import type { LinkRef, NodeStatus } from '../../model/types';

/** Common result shape for the worker-side parsers (txt/md/html). */
export interface ParserResult {
  title: string;
  text: string;
  headings: string[];
  mdLinkTargets: string[];
  docLinks: LinkRef[];
  status: NodeStatus;
  warning?: string;
}

/** "deploy-guide_v2.md" -> "Deploy Guide V2" */
export function cleanFilename(name: string): string {
  const base = name.replace(/\\/g, '/').split('/').pop() ?? name;
  const noExt = base.replace(/\.[A-Za-z0-9]{1,8}$/, '');
  const spaced = noExt.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!spaced) return base;
  return spaced
    .split(' ')
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
    .join(' ');
}

/** Tolerant UTF-8 decode (invalid sequences become U+FFFD, never throws). */
export function decodeText(bytes: ArrayBuffer): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

export function parseTxt(bytes: ArrayBuffer, name: string): ParserResult {
  return {
    title: cleanFilename(name),
    text: decodeText(bytes),
    headings: [],
    mdLinkTargets: [],
    docLinks: [],
    status: 'ok',
  };
}

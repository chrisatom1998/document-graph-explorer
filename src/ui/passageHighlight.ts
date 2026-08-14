/**
 * Locate a retrieved passage inside reader text and wrap it for display.
 *
 * Chunks are space-joined words (see chunker.ts) while source documents keep
 * newlines, and rendered markdown/HTML/CSV often concatenate blocks without
 * those separators. Matching collapses or strips delimiters, then maps the
 * range back onto the original haystack so the reader can scroll and <mark> it.
 */

export interface PassageRange {
  start: number;
  end: number;
}

interface Normalized {
  text: string;
  /** original haystack index for each character in `text`. */
  map: number[];
}

function normalizeWithMap(value: string): Normalized {
  const chars: string[] = [];
  const map: number[] = [];
  let pendingSpace: number | null = null;
  for (let i = 0; i < value.length; i++) {
    if (/\s/.test(value[i])) {
      if (chars.length > 0) pendingSpace ??= i;
      continue;
    }
    if (pendingSpace !== null) {
      chars.push(' ');
      map.push(pendingSpace);
      pendingSpace = null;
    }
    chars.push(value[i].toLowerCase());
    map.push(i);
  }
  return { text: chars.join(''), map };
}

function collapsedNeedle(needle: string): string {
  return needle.replace(/\s+/g, ' ').trim().toLowerCase();
}

function compactWithMap(value: string, keep: (ch: string) => boolean): Normalized {
  const chars: string[] = [];
  const map: number[] = [];
  for (let i = 0; i < value.length; i++) {
    if (!keep(value[i])) continue;
    chars.push(value[i].toLowerCase());
    map.push(i);
  }
  return { text: chars.join(''), map };
}

function rangeAt(h: Normalized, idx: number, length: number): PassageRange | null {
  if (idx < 0 || length <= 0 || idx + length > h.map.length) return null;
  return { start: h.map[idx], end: h.map[idx + length - 1] + 1 };
}

function searchCompact(
  haystack: string,
  needle: string,
  keep: (ch: string) => boolean,
): PassageRange | null {
  const n = compactWithMap(needle, keep);
  if (!n.text) return null;
  const h = compactWithMap(haystack, keep);
  if (!h.text) return null;
  const idx = h.text.indexOf(n.text);
  if (idx >= 0) return rangeAt(h, idx, n.text.length);
  if (n.text.length > 48) {
    const probe = n.text.slice(0, 48);
    const p = h.text.indexOf(probe);
    if (p >= 0) {
      const span = Math.min(n.text.length, 160, h.map.length - p);
      return rangeAt(h, p, span);
    }
  }
  return null;
}

/**
 * First range in `haystack` that matches `needle`, or null. Prefers an exact
 * substring, then a whitespace-normalized match, then delimiter-stripped
 * matches (block-level DOM / pretty-printed JSON), then the leading 48 chars
 * of a long needle (chat snippets are truncated).
 */
export function findPassageRange(haystack: string, needle: string): PassageRange | null {
  const trimmed = needle.trim();
  if (!trimmed || !haystack) return null;

  const exact = haystack.indexOf(trimmed);
  if (exact >= 0) return { start: exact, end: exact + trimmed.length };

  const n = collapsedNeedle(trimmed);
  if (!n) return null;
  const h = normalizeWithMap(haystack);
  if (h.text.length === 0) return null;

  const idx = h.text.indexOf(n);
  if (idx >= 0) {
    const start = h.map[idx];
    const last = h.map[idx + n.length - 1];
    return { start, end: last + 1 };
  }

  if (n.length > 48) {
    const probe = n.slice(0, 48);
    const p = h.text.indexOf(probe);
    if (p >= 0) {
      const span = Math.min(n.length, 160);
      const start = h.map[p];
      const last = h.map[Math.min(h.map.length - 1, p + span - 1)];
      return { start, end: last + 1 };
    }
  }

  return (
    searchCompact(haystack, trimmed, (ch) => !/\s/.test(ch)) ??
    searchCompact(haystack, trimmed, (ch) => /[a-zA-Z0-9]/.test(ch))
  );
}

export const PASSAGE_MARK_CLASS = 'passage-mark';

export function scrollPassageIntoView(el: Element | null): void {
  if (el && typeof el.scrollIntoView === 'function') {
    el.scrollIntoView({ block: 'center', behavior: 'auto' });
  }
}

export function unwrapPassageMarks(root: ParentNode): void {
  const marks = root.querySelectorAll(`mark.${PASSAGE_MARK_CLASS}`);
  for (const mark of marks) {
    const parent = mark.parentNode;
    if (!parent) continue;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
    parent.normalize();
  }
}

function textNodesUnder(root: Node): Text[] {
  const out: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node: Node | null = walker.nextNode();
  while (node) {
    out.push(node as Text);
    node = walker.nextNode();
  }
  return out;
}

function wrapTextSlice(node: Text, from: number, to: number): HTMLElement {
  const target = from > 0 ? node.splitText(from) : node;
  if (to - from < target.data.length) target.splitText(to - from);
  const mark = document.createElement('mark');
  mark.className = PASSAGE_MARK_CLASS;
  target.parentNode!.insertBefore(mark, target);
  mark.appendChild(target);
  return mark;
}

/**
 * Wrap the first match of `needle` inside `root`. Returns the first <mark>
 * so callers can scroll it into view. No-op (and returns null) when the
 * passage is not present in the rendered text — e.g. a PDF canvas.
 */
export function wrapPassageInElement(root: HTMLElement, needle: string): HTMLElement | null {
  unwrapPassageMarks(root);
  const haystack = root.textContent ?? '';
  const range = findPassageRange(haystack, needle);
  if (!range) return null;

  const nodes = textNodesUnder(root);
  let offset = 0;
  let firstMark: HTMLElement | null = null;
  for (const node of nodes) {
    const len = node.data.length;
    const nodeStart = offset;
    const nodeEnd = offset + len;
    offset = nodeEnd;
    const from = Math.max(0, range.start - nodeStart);
    const to = Math.min(len, range.end - nodeStart);
    if (to <= from) continue;
    const mark = wrapTextSlice(node, from, to);
    firstMark ??= mark;
    if (nodeEnd >= range.end) break;
  }
  return firstMark;
}

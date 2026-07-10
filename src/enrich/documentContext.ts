import { DOCUMENT_AI_MAX_CONTEXT_CHARS } from '../config';

export type DocumentContextAction = 'summarize' | 'outline' | 'ask';

export interface DocumentContext {
  text: string;
  truncated: boolean;
}

function terms(text: string): string[] {
  return [...new Set(text.toLowerCase().match(/[a-z0-9][a-z0-9_-]{2,}/g) ?? [])];
}

function sections(text: string): string[] {
  const paragraphs = text.split(/\n\s*\n+/).map((part) => part.trim()).filter(Boolean);
  if (paragraphs.length === 0) return [];
  const out: string[] = [];
  let current = '';
  for (const paragraph of paragraphs) {
    if (current && current.length + paragraph.length + 2 > 8_000) {
      out.push(current);
      current = paragraph;
    } else {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
    }
  }
  if (current) out.push(current);
  return out;
}

function clipSections(selected: string[], maxChars: number): string {
  const out: string[] = [];
  let used = 0;
  for (const section of selected) {
    const remaining = maxChars - used;
    if (remaining <= 0) break;
    const clipped = section.length > remaining ? section.slice(0, remaining).trimEnd() : section;
    if (clipped) out.push(clipped);
    used += clipped.length + 2;
  }
  return out.join('\n\n');
}

/**
 * Keeps remote document AI requests safely bounded. Questions use the most
 * lexically relevant sections; summaries/outlines sample the document in its
 * original order so openings, middle decisions, and conclusions all survive.
 */
export function prepareDocumentContext(
  text: string,
  action: DocumentContextAction,
  question?: string,
  maxChars: number = DOCUMENT_AI_MAX_CONTEXT_CHARS,
): DocumentContext {
  const clean = text.trim();
  if (clean.length <= maxChars) return { text: clean, truncated: false };

  const all = sections(clean);
  if (all.length === 0) return { text: clean.slice(0, maxChars), truncated: true };

  if (action === 'ask' && question?.trim()) {
    const queryTerms = terms(question);
    const ranked = all
      .map((section, index) => {
        const lower = section.toLowerCase();
        const hits = queryTerms.reduce((count, term) => count + (lower.includes(term) ? 1 : 0), 0);
        return { section, index, score: hits / Math.max(1, queryTerms.length) };
      })
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .filter((entry) => entry.score > 0);
    if (ranked.length > 0) {
      return {
        text: clipSections(ranked.map((entry) => entry.section), maxChars),
        truncated: true,
      };
    }
  }

  const count = Math.max(1, Math.floor(maxChars / 8_000));
  const chosen = new Set<number>();
  for (let i = 0; i < count; i++) {
    chosen.add(Math.min(all.length - 1, Math.floor((i * all.length) / count)));
  }
  return {
    text: clipSections([...chosen].sort((a, b) => a - b).map((index) => all[index]), maxChars),
    truncated: true,
  };
}

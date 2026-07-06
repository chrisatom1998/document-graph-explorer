/**
 * Pretty-printed, syntax-highlighted JSON view for the SidePanel document
 * reader's .json documents — same "show it like the real file" treatment as
 * CsvPreview/DocumentMarkdown/PdfPreview. The raw bytes for this file type
 * ARE the extracted text (verbatim decode, see pipeline/parsers/txt.ts), so
 * this renders directly off the already-cached full text, no async fetch.
 *
 * Falls back to a plain pre-wrap dump of the raw text when it isn't valid
 * JSON (e.g. a truncated/oversized extraction) rather than showing nothing.
 */

import { useMemo, type ReactNode } from 'react';

const JSON_TOKEN_RE =
  /("(?:\\u[0-9a-fA-F]{4}|\\[^u]|[^\\"])*"(\s*:)?|\btrue\b|\bfalse\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;

function classify(token: string): string {
  if (/"\s*:$/.test(token)) return 'json-key';
  if (token.startsWith('"')) return 'json-string';
  if (token === 'true' || token === 'false') return 'json-bool';
  if (token === 'null') return 'json-null';
  return 'json-number';
}

function renderHighlighted(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(JSON_TOKEN_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) parts.push(text.slice(last, idx));
    const token = m[0];
    parts.push(
      <span key={i} className={classify(token)}>
        {token}
      </span>,
    );
    last = idx + token.length;
    i += 1;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

interface JsonPreviewProps {
  text: string;
  className?: string;
}

export default function JsonPreview({ text, className }: JsonPreviewProps) {
  const pretty = useMemo(() => {
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      return null;
    }
  }, [text]);

  const wrapClass = className ? `json-preview ${className}` : 'json-preview';

  if (pretty === null) {
    return (
      <div className={wrapClass} style={{ whiteSpace: 'pre-wrap' }}>
        {text}
      </div>
    );
  }

  return (
    <pre className={wrapClass}>
      <code>{renderHighlighted(pretty)}</code>
    </pre>
  );
}

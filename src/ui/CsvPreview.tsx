/**
 * Renders CSV text as an actual table — the SidePanel document reader's
 * "show it like the real file" treatment for .csv, matching how
 * DocumentMarkdown handles .md and PdfPreview handles .pdf. The raw bytes
 * for this file type ARE the extracted text (pipeline/parsers/txt.ts is a
 * verbatim decode, no transformation), so no async original-fetch is
 * needed — this can render directly off the already-cached full text.
 *
 * Parsing is a small RFC4180-ish state machine: quoted fields, embedded
 * commas/newlines, and "" as an escaped quote.
 */

import { useMemo } from 'react';

/** Above this many data rows, render only the first N (perf safety net for huge exports). */
const MAX_ROWS = 5000;

/** Parse CSV text into rows of string cells. PURE. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (c === ',') {
      pushField();
      i += 1;
      continue;
    }
    if (c === '\r') {
      i += 1;
      continue;
    }
    if (c === '\n') {
      pushRow();
      i += 1;
      continue;
    }
    field += c;
    i += 1;
  }
  if (field.length > 0 || row.length > 0) pushRow();

  // Drop a single fully-blank trailing row — a trailing newline artifact,
  // not a real data row.
  if (rows.length > 0 && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === '') {
    rows.pop();
  }
  return rows;
}

interface CsvPreviewProps {
  text: string;
  className?: string;
}

export default function CsvPreview({ text, className }: CsvPreviewProps) {
  const rows = useMemo(() => parseCsv(text), [text]);
  const wrapClass = className ? `csv-preview ${className}` : 'csv-preview';

  if (rows.length === 0) {
    return <div className={wrapClass}>Empty CSV.</div>;
  }

  const [header, ...body] = rows;
  const truncated = body.length > MAX_ROWS;
  const visibleBody = truncated ? body.slice(0, MAX_ROWS) : body;

  return (
    <div className={wrapClass}>
      <div className="csv-preview__scroll">
        <table>
          <thead>
            <tr>
              {header.map((cell, i) => (
                <th key={i}>{cell}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleBody.map((r, ri) => (
              <tr key={ri}>
                {r.map((cell, ci) => (
                  <td key={ci}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {truncated && (
        <p className="csv-preview__truncated">
          Showing first {MAX_ROWS.toLocaleString()} of {body.length.toLocaleString()} rows.
        </p>
      )}
    </div>
  );
}

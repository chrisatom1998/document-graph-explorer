/**
 * Minimal deterministic text→PDF generator for the demo corpus — no
 * dependencies, byte-stable output (no timestamps, no randomness), so
 * generated demo documents remain `reconstructable` across sessions.
 *
 * Emits PDF 1.4 with uncompressed content streams, Helvetica/WinAnsi text,
 * and a /Title info entry (parsePdf prefers metadata titles). Lines starting
 * with `# ` / `## ` render as bold headings; everything else is 10pt body
 * text, word-wrapped at spaces so filenames and reference tokens are never
 * split across lines (reference-edge detection matches them in body text).
 *
 * Kept erasable-syntax-only so Node's type stripping can import it directly
 * from scripts/ (see scripts/convert-demo-samples-to-pdf.mjs).
 */

const PAGE_WIDTH = 612; // US Letter, pt
const PAGE_HEIGHT = 792;
const MARGIN = 54;
const BODY_SIZE = 10;
const H1_SIZE = 15;
const H2_SIZE = 11.5;

interface StyledLine {
  text: string;
  size: number;
  bold: boolean;
  /** extra vertical gap above the line (heading breathing room) */
  gapAbove: number;
}

/** Approximate max characters per line for Helvetica at a given size. */
function maxChars(size: number): number {
  const usable = PAGE_WIDTH - MARGIN * 2;
  return Math.max(20, Math.floor(usable / (size * 0.52)));
}

/** Wrap at spaces only — never inside a word/filename. */
function wrapLine(text: string, limit: number): string[] {
  if (text.length <= limit) return [text];
  const words = text.split(' ');
  const out: string[] = [];
  let current = '';
  for (const word of words) {
    if (current.length === 0) {
      current = word;
    } else if (current.length + 1 + word.length <= limit) {
      current += ' ' + word;
    } else {
      out.push(current);
      current = word;
    }
  }
  if (current.length > 0) out.push(current);
  return out;
}

function styleLines(text: string): StyledLine[] {
  const lines: StyledLine[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r/g, '').trimEnd();
    let size = BODY_SIZE;
    let bold = false;
    let gapAbove = 0;
    let content = line;
    if (line.startsWith('## ')) {
      size = H2_SIZE;
      bold = true;
      gapAbove = 6;
      content = line.slice(3);
    } else if (line.startsWith('# ')) {
      size = H1_SIZE;
      bold = true;
      gapAbove = 4;
      content = line.slice(2);
    }
    if (content.length === 0) {
      lines.push({ text: '', size: BODY_SIZE, bold: false, gapAbove: 0 });
      continue;
    }
    const limit = maxChars(size);
    for (const wrapped of wrapLine(content, limit)) {
      lines.push({ text: wrapped, size, bold, gapAbove });
      gapAbove = 0; // only the first wrapped segment carries the gap
    }
  }
  return lines;
}

/** cp1252 codes for the non-Latin-1 characters the demo text actually uses. */
const CP1252: Record<string, number> = {
  '€': 0x80, // €
  '…': 0x85, // …
  '‘': 0x91, // '
  '’': 0x92, // '
  '“': 0x93, // "
  '”': 0x94, // "
  '•': 0x95, // •
  '–': 0x96, // –
  '—': 0x97, // —
  '™': 0x99, // ™
};

/**
 * Escape a JS string into a parenthesized PDF string literal containing only
 * ASCII: backslash escapes for delimiters, octal escapes for WinAnsi bytes
 * above 126, '?' for anything unmappable.
 */
function pdfString(text: string): string {
  let out = '(';
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 63;
    let byte: number;
    if (code >= 32 && code <= 126) byte = code;
    else if (code >= 0xa0 && code <= 0xff) byte = code;
    else byte = CP1252[ch] ?? 63; // '?'
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) {
      out += '\\' + String.fromCharCode(byte);
    } else if (byte > 126) {
      out += '\\' + byte.toString(8).padStart(3, '0');
    } else {
      out += String.fromCharCode(byte);
    }
  }
  return out + ')';
}

/**
 * Info-dictionary strings are read as PDFDocEncoding (NOT WinAnsi — its
 * 0x80–0x9F block differs, turning an em dash into 'Š'). Encode the title as
 * UTF-16BE with BOM instead, octal-escaped so the file stays pure ASCII.
 */
function pdfUtf16String(text: string): string {
  let out = '(\\376\\377';
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    out += '\\' + (code >> 8).toString(8).padStart(3, '0');
    out += '\\' + (code & 0xff).toString(8).padStart(3, '0');
  }
  return out + ')';
}

function paginate(lines: StyledLine[]): StyledLine[][] {
  const pages: StyledLine[][] = [];
  let page: StyledLine[] = [];
  let y = PAGE_HEIGHT - MARGIN;
  for (const line of lines) {
    const advance = line.size * 1.4 + line.gapAbove;
    if (y - advance < MARGIN && page.length > 0) {
      pages.push(page);
      page = [];
      y = PAGE_HEIGHT - MARGIN;
    }
    y -= advance;
    page.push(line);
  }
  if (page.length > 0) pages.push(page);
  return pages.length > 0 ? pages : [[{ text: ' ', size: BODY_SIZE, bold: false, gapAbove: 0 }]];
}

function pageContentStream(lines: StyledLine[]): string {
  let y = PAGE_HEIGHT - MARGIN;
  let out = '';
  for (const line of lines) {
    y -= line.size * 1.4 + line.gapAbove;
    if (line.text.length === 0) continue; // blank line: vertical space only
    const font = line.bold ? '/F2' : '/F1';
    out += `BT ${font} ${line.size} Tf 1 0 0 1 ${MARGIN} ${y.toFixed(1)} Tm ${pdfString(line.text)} Tj ET\n`;
  }
  return out;
}

/**
 * Render `text` (light markdown: `#`/`##` headings, blank lines) into a
 * complete single-font PDF with `title` as its metadata title.
 */
export function textToPdfBytes(title: string, text: string): ArrayBuffer {
  const pages = paginate(styleLines(text));

  // Fixed objects: 1 Catalog, 2 Pages, 3 F1, 4 F2, 5 Info.
  // Then per page i: object 6+2i (Page) and 7+2i (Contents).
  const objects: string[] = [];
  const pageObjNums = pages.map((_, i) => 6 + 2 * i);
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push(
    `<< /Type /Pages /Kids [${pageObjNums.map((n) => `${n} 0 R`).join(' ')}] /Count ${pages.length} >>`,
  );
  objects.push(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  );
  objects.push(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
  );
  objects.push(
    `<< /Title ${pdfUtf16String(title)} /Producer (Document Graph Explorer demo corpus) >>`,
  );
  for (const [i, page] of pages.entries()) {
    const stream = pageContentStream(page);
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
        `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${pageObjNums[i]! + 1} 0 R >>`,
    );
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}endstream`);
  }

  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (const [i, obj] of objects.entries()) {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  }
  const xrefOffset = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  body +=
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 5 0 R >>\n` +
    `startxref\n${xrefOffset}\n%%EOF\n`;

  // The body is pure ASCII (pdfString octal-escapes everything above 126),
  // so a charCode copy is a faithful byte encoding.
  const bytes = new Uint8Array(body.length);
  for (let i = 0; i < body.length; i++) bytes[i] = body.charCodeAt(i) & 0xff;
  return bytes.buffer;
}

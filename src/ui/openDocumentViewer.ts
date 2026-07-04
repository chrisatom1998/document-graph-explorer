/**
 * Opens a document's content in a beautifully styled viewer tab.
 * Self-contained HTML with premium dark-mode design, reading progress,
 * and intelligent text formatting.
 */

import type { DocNode, LinkRef } from '../model/types';
import { hexFor } from '../scene/palette';

const MIME_MAP: Record<string, string> = {
  md: 'Markdown', txt: 'Plain Text', html: 'HTML',
  json: 'JSON', yaml: 'YAML', csv: 'CSV',
  docx: 'Word', pptx: 'PowerPoint', xlsx: 'Excel',
  pdf: 'PDF', other: 'Document',
};

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// http(s) URLs, www. URLs, and bare emails. Kept simple/greedy; trailing
// sentence punctuation is trimmed back onto the surrounding text below.
const INLINE_URL_RE = /(https?:\/\/[^\s<]+|www\.[^\s<]+|[^\s<@]+@[^\s<@]+\.[a-zA-Z]{2,})/g;

/** A web link the original document contained, or null if the token isn't one. */
function hrefFor(token: string): string | null {
  if (/^https?:\/\//i.test(token)) return token;
  if (/^www\./i.test(token)) return `https://${token}`;
  if (/^mailto:/i.test(token)) return token;
  if (/^[^\s<@]+@[^\s<@]+\.[a-zA-Z]{2,}$/.test(token)) return `mailto:${token}`;
  return null; // relative paths / bare filenames are graph edges, not web links
}

function anchor(href: string, text: string): string {
  // The scheme is constrained to http(s)/mailto by hrefFor, so no javascript:
  // URLs can slip through; still escape both attribute and text.
  return `<a class="doc-link" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer nofollow">${escapeHtml(text)}</a>`;
}

/**
 * Escape a line of body text AND turn any bare URLs / emails it contains into
 * clickable links — the viewer renders extracted text, where markdown/HTML
 * link *syntax* is already gone but visible URLs survive as plain text.
 */
function linkifyLine(raw: string): string {
  let out = '';
  let last = 0;
  for (const m of raw.matchAll(INLINE_URL_RE)) {
    const idx = m.index ?? 0;
    out += escapeHtml(raw.slice(last, idx));
    let token = m[0];
    // pull common trailing punctuation back out of the URL (e.g. "see (url).")
    const trail = token.match(/[.,;:!?)\]}'"]+$/);
    let tail = '';
    if (trail) {
      tail = token.slice(token.length - trail[0].length);
      token = token.slice(0, token.length - trail[0].length);
    }
    const href = hrefFor(token);
    out += href ? anchor(href, token) : escapeHtml(token);
    out += escapeHtml(tail);
    last = idx + m[0].length;
  }
  out += escapeHtml(raw.slice(last));
  return out;
}

/**
 * Lightly format text for display: detect markdown headings, fenced code
 * blocks, horizontal rules, and blank lines. Returns HTML string.
 */
function formatContent(text: string, fileType: string): string {
  // For structured data files, wrap the entire content in a code block
  if (['json', 'yaml', 'csv'].includes(fileType)) {
    return `<pre class="code-block"><code>${escapeHtml(text)}</code></pre>`;
  }

  const lines = text.split('\n');
  const out: string[] = [];
  let inCode = false;
  let codeLines: string[] = [];
  let codeLang = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Fenced code blocks
    if (line.trimStart().startsWith('```')) {
      if (!inCode) {
        inCode = true;
        codeLang = line.trimStart().slice(3).trim();
        codeLines = [];
        continue;
      } else {
        out.push(
          `<pre class="code-block"${codeLang ? ` data-lang="${escapeHtml(codeLang)}"` : ''}><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`,
        );
        inCode = false;
        continue;
      }
    }

    if (inCode) {
      codeLines.push(line);
      continue;
    }

    // Horizontal rules
    if (/^(\s*[-*_]\s*){3,}$/.test(line)) {
      out.push('<hr class="divider" />');
      continue;
    }

    // Headings (markdown style)
    const headingMatch = line.match(/^(#{1,6})\s+(.*)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = escapeHtml(headingMatch[2]);
      out.push(`<h${level} class="doc-heading doc-h${level}">${text}</h${level}>`);
      continue;
    }

    // Blank lines → paragraph breaks
    if (line.trim() === '') {
      out.push('<div class="spacer"></div>');
      continue;
    }

    // Regular text line — escape and linkify any bare URLs/emails
    out.push(`<p class="doc-line">${linkifyLine(line)}</p>`);
  }

  // Close unclosed code block
  if (inCode) {
    out.push(
      `<pre class="code-block"><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`,
    );
  }

  return out.join('\n');
}

export function openDocumentViewer(
  node: DocNode,
  fullText: string,
  clusterName: string,
  links: LinkRef[] = [],
): void {
  const isMono = ['txt', 'json', 'yaml', 'csv', 'other'].includes(node.fileType);
  const typeLabel = MIME_MAP[node.fileType] ?? 'Document';
  const clusterColor = hexFor(node.cluster);
  const wordCount = node.wordCount.toLocaleString();
  const readTime = Math.max(1, Math.ceil(node.wordCount / 238));
  const content = formatContent(fullText, node.fileType);
  const title = escapeHtml(node.title);
  const topics = node.topics.slice(0, 6);

  // Web links the original document contained — including those hidden behind
  // markdown/HTML anchor text, whose URLs were stripped from the visible text
  // during extraction. Each is numbered and paired with its label so the
  // reader can tell which link goes with which piece of text. Relative/
  // intra-corpus links are graph edges, not shown here.
  const webLinks: { label: string; href: string }[] = [];
  const seenHrefs = new Set<string>();
  for (const l of links) {
    const href = hrefFor(l.url.trim());
    if (!href || seenHrefs.has(href)) continue;
    seenHrefs.add(href);
    const label = l.text.trim();
    webLinks.push({ label: label && label !== href ? label : '', href });
    if (webLinks.length >= 200) break;
  }
  const linksSection =
    webLinks.length > 0
      ? `
  <section class="links-section">
    <div class="links-section__label">Links in this document</div>
    <ol class="links-list">
      ${webLinks
        .map(
          ({ label, href }) =>
            `<li>${label ? `<span class="links-list__label">${escapeHtml(label)}</span>` : ''}${anchor(
              href,
              href,
            )}</li>`,
        )
        .join('\n      ')}
    </ol>
  </section>`
      : '';

  // Open synchronously (user gesture) to avoid popup blockers
  const w = window.open('', '_blank');
  if (!w) return;

  w.document.write(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title} — Knowledge Nebula</title>
<style>
  :root {
    --bg-deep: #07080f;
    --bg-surface: #0d0f1a;
    --bg-card: #12142a;
    --bg-code: #0a0c18;
    --border: rgba(140, 150, 255, 0.08);
    --border-glow: rgba(140, 150, 255, 0.15);
    --text-primary: #e4e8f7;
    --text-secondary: #9ca3c4;
    --text-faint: #5e6488;
    --accent: ${clusterColor};
    --accent-glow: ${clusterColor}33;
    --purple: #8f7bff;
    /* System stacks only — no web-font fetch, so opening a document never
       reaches the network (honors the app's "documents never leave this
       browser" guarantee, and matches the main app's own font vars). */
    --font-reading: system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    --font-mono: ui-monospace, 'SFMono-Regular', Menlo, Consolas, 'Liberation Mono', monospace;
  }

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  html {
    scroll-behavior: smooth;
    scrollbar-width: thin;
    scrollbar-color: rgba(143,123,255,0.25) transparent;
  }
  ::-webkit-scrollbar { width: 6px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb {
    background: rgba(143,123,255,0.25);
    border-radius: 3px;
  }
  ::-webkit-scrollbar-thumb:hover { background: rgba(143,123,255,0.4); }

  body {
    background: var(--bg-deep);
    color: var(--text-primary);
    font-family: var(--font-reading);
    font-size: 15px;
    line-height: 1.8;
    -webkit-font-smoothing: antialiased;
    overflow-x: hidden;
  }

  /* ─── Reading progress bar ─── */
  .progress-bar {
    position: fixed; top: 0; left: 0;
    width: 0%; height: 3px;
    background: linear-gradient(90deg, var(--accent), var(--purple));
    z-index: 100;
    transition: width 80ms ease-out;
    box-shadow: 0 0 12px var(--accent-glow);
  }

  /* ─── Background orbs ─── */
  .bg-orb {
    position: fixed;
    border-radius: 50%;
    filter: blur(100px);
    opacity: 0.08;
    pointer-events: none;
    z-index: 0;
  }
  .bg-orb-1 {
    width: 600px; height: 600px;
    top: -200px; right: -150px;
    background: var(--accent);
    animation: float1 20s ease-in-out infinite;
  }
  .bg-orb-2 {
    width: 500px; height: 500px;
    bottom: -200px; left: -100px;
    background: var(--purple);
    animation: float2 25s ease-in-out infinite;
  }
  @keyframes float1 {
    0%, 100% { transform: translate(0, 0); }
    50% { transform: translate(-40px, 30px); }
  }
  @keyframes float2 {
    0%, 100% { transform: translate(0, 0); }
    50% { transform: translate(30px, -40px); }
  }

  /* ─── Hero header ─── */
  .hero {
    position: relative;
    z-index: 1;
    max-width: 820px;
    margin: 0 auto;
    padding: 80px 48px 40px;
    animation: fadeUp 600ms ease-out both;
  }
  @keyframes fadeUp {
    from { opacity: 0; transform: translateY(16px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .hero__type {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--accent);
    margin-bottom: 16px;
  }
  .hero__type-dot {
    width: 8px; height: 8px;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 8px var(--accent-glow);
  }

  .hero__title {
    font-size: clamp(28px, 4vw, 40px);
    font-weight: 700;
    line-height: 1.2;
    color: var(--text-primary);
    margin-bottom: 20px;
    letter-spacing: -0.02em;
  }

  .hero__meta {
    display: flex;
    flex-wrap: wrap;
    gap: 20px;
    font-size: 13px;
    color: var(--text-secondary);
    padding-bottom: 24px;
    border-bottom: 1px solid var(--border);
  }
  .hero__meta-item {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .hero__meta-icon {
    opacity: 0.5;
    font-size: 14px;
  }

  .hero__topics {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 16px;
  }
  .topic-chip {
    display: inline-block;
    padding: 4px 14px;
    font-size: 12px;
    font-weight: 500;
    color: var(--text-secondary);
    background: rgba(143, 123, 255, 0.06);
    border: 1px solid rgba(143, 123, 255, 0.12);
    border-radius: 999px;
    transition: all 200ms ease;
  }
  .topic-chip:hover {
    border-color: rgba(143, 123, 255, 0.3);
    background: rgba(143, 123, 255, 0.1);
    color: var(--text-primary);
  }

  /* ─── Summary card ─── */
  .summary-card {
    position: relative;
    z-index: 1;
    max-width: 820px;
    margin: 0 auto;
    padding: 0 48px;
    animation: fadeUp 600ms 100ms ease-out both;
  }
  .summary-card__inner {
    background: var(--bg-card);
    border: 1px solid var(--border-glow);
    border-radius: 16px;
    padding: 24px 28px;
    margin-bottom: 8px;
  }
  .summary-card__label {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-faint);
    margin-bottom: 10px;
  }
  .summary-card__text {
    font-size: 15px;
    line-height: 1.7;
    color: var(--text-secondary);
    font-style: italic;
  }

  /* ─── Document body ─── */
  .doc-body {
    position: relative;
    z-index: 1;
    max-width: 820px;
    margin: 0 auto;
    padding: 40px 48px 120px;
    animation: fadeUp 600ms 200ms ease-out both;
  }

  .doc-line {
    margin: 0;
    font-family: ${isMono ? 'var(--font-mono)' : 'var(--font-reading)'};
    font-size: ${isMono ? '13px' : '15.5px'};
    line-height: ${isMono ? '1.65' : '1.85'};
    color: var(--text-primary);
    overflow-wrap: anywhere;
  }

  .spacer { height: 14px; }

  .doc-heading {
    color: var(--text-primary);
    font-weight: 650;
    margin-top: 40px;
    margin-bottom: 8px;
    position: relative;
    letter-spacing: -0.01em;
  }
  .doc-h1 { font-size: 28px; margin-top: 48px; }
  .doc-h2 { font-size: 22px; margin-top: 40px; }
  .doc-h3 { font-size: 18px; }
  .doc-h4 { font-size: 16px; }
  .doc-h5, .doc-h6 { font-size: 14px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-secondary); }

  .doc-h1::after, .doc-h2::after {
    content: '';
    display: block;
    width: 40px; height: 3px;
    margin-top: 10px;
    background: linear-gradient(90deg, var(--accent), transparent);
    border-radius: 2px;
  }

  /* ─── Code blocks ─── */
  .code-block {
    position: relative;
    background: var(--bg-code);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 20px 24px;
    margin: 16px 0;
    overflow-x: auto;
    font-family: var(--font-mono);
    font-size: 13px;
    line-height: 1.6;
    color: #c4caef;
    tab-size: 4;
  }
  .code-block::before {
    content: attr(data-lang);
    position: absolute;
    top: 8px; right: 14px;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-faint);
    opacity: 0.6;
  }
  .code-block code {
    font-family: inherit;
    font-size: inherit;
    background: none;
    padding: 0;
  }

  .divider {
    border: none;
    height: 1px;
    background: linear-gradient(90deg, transparent, var(--border-glow), transparent);
    margin: 32px 0;
  }

  /* ─── Inline links (bare URLs/emails in the body) ─── */
  .doc-link {
    color: var(--accent);
    text-decoration: none;
    border-bottom: 1px solid var(--accent-glow);
    transition: color 150ms ease, border-color 150ms ease;
    word-break: break-word;
  }
  .doc-link:hover {
    color: var(--purple);
    border-bottom-color: var(--accent);
  }

  /* ─── Links section (URLs hidden behind markdown/HTML labels) ─── */
  .links-section {
    position: relative;
    z-index: 1;
    max-width: 820px;
    margin: 0 auto;
    padding: 0 48px 100px;
    animation: fadeUp 600ms 250ms ease-out both;
  }
  .links-section__label {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-faint);
    margin-bottom: 14px;
    padding-top: 24px;
    border-top: 1px solid var(--border);
  }
  .links-list {
    list-style: decimal;
    padding-left: 26px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    color: var(--text-faint); /* the numeric markers */
  }
  .links-list li {
    padding-left: 4px;
  }
  .links-list__label {
    display: block;
    color: var(--text-primary);
    font-size: 13.5px;
    font-weight: 500;
    margin-bottom: 2px;
  }
  .links-list a {
    color: var(--text-secondary);
    text-decoration: none;
    font-size: 12.5px;
    word-break: break-all;
    border-bottom: 1px solid transparent;
    transition: color 150ms ease, border-color 150ms ease;
  }
  .links-list a:hover {
    color: var(--accent);
    border-bottom-color: var(--accent-glow);
  }

  /* ─── Back to top ─── */
  .back-to-top {
    position: fixed;
    bottom: 32px; right: 32px;
    width: 44px; height: 44px;
    border-radius: 50%;
    border: 1px solid var(--border-glow);
    background: rgba(18, 20, 42, 0.85);
    backdrop-filter: blur(12px);
    color: var(--text-secondary);
    font-size: 18px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transform: translateY(10px);
    transition: all 250ms ease;
    z-index: 50;
  }
  .back-to-top.visible {
    opacity: 1;
    transform: translateY(0);
  }
  .back-to-top:hover {
    border-color: var(--accent);
    color: var(--accent);
    background: rgba(143, 123, 255, 0.08);
  }

  /* ─── Responsive ─── */
  @media (max-width: 700px) {
    .hero, .summary-card, .doc-body, .links-section { padding-left: 24px; padding-right: 24px; }
    .hero { padding-top: 48px; }
    .hero__title { font-size: 24px; }
  }

  /* ─── Selection ─── */
  ::selection {
    background: rgba(143, 123, 255, 0.3);
    color: #fff;
  }
</style>
</head>
<body>
  <div class="progress-bar" id="progress"></div>
  <div class="bg-orb bg-orb-1"></div>
  <div class="bg-orb bg-orb-2"></div>

  <header class="hero">
    <div class="hero__type">
      <span class="hero__type-dot"></span>
      ${typeLabel} · ${clusterName ? escapeHtml(clusterName) : `Cluster ${node.cluster}`}
    </div>
    <h1 class="hero__title">${title}</h1>
    <div class="hero__meta">
      <span class="hero__meta-item">
        <span class="hero__meta-icon">📝</span>
        ${wordCount} words
      </span>
      <span class="hero__meta-item">
        <span class="hero__meta-icon">⏱</span>
        ${readTime} min read
      </span>
      <span class="hero__meta-item">
        <span class="hero__meta-icon">🔗</span>
        ${node.degree} connection${node.degree === 1 ? '' : 's'}
      </span>
    </div>
    ${topics.length > 0 ? `
    <div class="hero__topics">
      ${topics.map((t) => `<span class="topic-chip">${escapeHtml(t)}</span>`).join('\n      ')}
    </div>
    ` : ''}
  </header>

  ${node.summary ? `
  <div class="summary-card">
    <div class="summary-card__inner">
      <div class="summary-card__label">Summary</div>
      <p class="summary-card__text">${escapeHtml(node.summary)}</p>
    </div>
  </div>
  ` : ''}

  <main class="doc-body">
    ${content}
  </main>
${linksSection}
  <button class="back-to-top" id="btt" title="Back to top" onclick="window.scrollTo({top:0,behavior:'smooth'})">↑</button>

  <script>
    const bar = document.getElementById('progress');
    const btt = document.getElementById('btt');
    window.addEventListener('scroll', () => {
      const h = document.documentElement.scrollHeight - window.innerHeight;
      const pct = h > 0 ? (window.scrollY / h) * 100 : 0;
      bar.style.width = pct + '%';
      btt.classList.toggle('visible', window.scrollY > 400);
    }, { passive: true });
  </script>
</body>
</html>`);
  w.document.close();
}

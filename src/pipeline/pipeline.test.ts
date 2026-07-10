/**
 * Unit tests for the pure extraction-pipeline modules.
 * Written against the module contracts (not the implementations) so they
 * double as an interface check on the pipeline subsystem.
 */
import { describe, expect, it } from 'vitest';
import { tokenize, termFreq } from './tokenize';
import { computeIdf, topKeywords, keywordEdges } from './tfidf';
import { referenceEdges } from './links';
import { extractEntities } from './entities';
import { chunkText } from './chunker';
import { findBoilerplateLines, stripBoilerplate } from './boilerplate';
import { MAX_DUPLICATE_PAIRS, semanticEdges } from './similarity';
import { DUP_SIM_THRESHOLD, MAX_EMBED_TEXT_BYTES, SIM_THRESHOLD, SIM_TOP_K } from '../config';
import { parseMarkdown } from './parsers/markdown';
import { parseHtml } from './parsers/html';
import { labelForRect, type PdfTextSpan } from './parsers/pdfLinkLabels';

// ---------------------------------------------------------------------------
// tokenize
// ---------------------------------------------------------------------------
describe('tokenize', () => {
  it('lowercases, strips stopwords and short/numeric tokens', () => {
    const tokens = tokenize('The Kafka consumer LAG is 42 and the retry policy applies');
    expect(tokens).toContain('kafka');
    expect(tokens).toContain('consumer');
    expect(tokens).toContain('lag');
    expect(tokens).toContain('retry');
    expect(tokens).not.toContain('the'); // stopword
    expect(tokens).not.toContain('is'); // short + stopword
    expect(tokens).not.toContain('42'); // numeric
  });

  it('termFreq counts occurrences', () => {
    const { tf, total } = termFreq(['kafka', 'kafka', 'consumer']);
    expect(tf['kafka']).toBe(2);
    expect(tf['consumer']).toBe(1);
    expect(total).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// markdown parser
// ---------------------------------------------------------------------------
describe('parseMarkdown', () => {
  it('extracts headings, links, definitions, and readable text in a worker-safe way', () => {
    const markdown = [
      '# Deploy Guide',
      '',
      'See [Incident Runbook](incident-runbook.md) and [Oncall][oncall].',
      '',
      '## Rollout',
      '- Ship via **canary**.',
      '',
      '[oncall]: oncall-rotation.md',
    ].join('\n');
    const bytes = new TextEncoder().encode(markdown).buffer;

    const parsed = parseMarkdown(bytes, 'deploy-guide.md');

    expect(parsed.title).toBe('Deploy Guide');
    expect(parsed.headings).toEqual(['Deploy Guide', 'Rollout']);
    expect(parsed.mdLinkTargets).toEqual([
      'oncall-rotation.md',
      'incident-runbook.md',
      'oncall-rotation.md',
    ]);
    // labelled links pair each URL with the text it was attached to
    expect(parsed.docLinks).toEqual([
      { text: 'Incident Runbook', url: 'incident-runbook.md' },
      { text: 'Oncall', url: 'oncall-rotation.md' },
    ]);
    expect(parsed.text).toContain('See Incident Runbook and Oncall.');
    expect(parsed.text).toContain('Ship via canary.');
  });

  it('uses the filename for the node title, not the first heading', () => {
    const markdown = ['# Introduction', '', 'Actual body text.'].join('\n');
    const bytes = new TextEncoder().encode(markdown).buffer;

    const parsed = parseMarkdown(bytes, 'customer-onboarding-playbook.md');

    expect(parsed.title).toBe('Customer Onboarding Playbook');
    expect(parsed.headings).toEqual(['Introduction']);
  });
});

// ---------------------------------------------------------------------------
// html parser — anchor href capture (so links survive extraction)
// ---------------------------------------------------------------------------
describe('parseHtml', () => {
  it('captures <a href> targets and skips in-page anchors', () => {
    const html = [
      '<html><head><title>Docs</title></head><body>',
      '<h1>Guide</h1>',
      '<p>See the <a href="https://example.com/setup">setup page</a> and',
      "the <a href='runbook.html'>runbook</a>.</p>",
      '<p><a href="#top">back to top</a></p>',
      '</body></html>',
    ].join('\n');
    const bytes = new TextEncoder().encode(html).buffer;

    const parsed = parseHtml(bytes, 'guide.html');

    expect(parsed.mdLinkTargets).toEqual(['https://example.com/setup', 'runbook.html']);
    // labelled links pair each href with its anchor text
    expect(parsed.docLinks).toEqual([
      { text: 'setup page', url: 'https://example.com/setup' },
      { text: 'runbook', url: 'runbook.html' },
    ]);
    // the visible text keeps the anchor labels, not the URLs
    expect(parsed.text).toContain('setup page');
    expect(parsed.text).not.toContain('https://example.com/setup');
  });

  it('uses the filename when HTML has headings but no <title> metadata', () => {
    const html = '<main><h1>Introduction</h1><p>Actual body text.</p></main>';
    const bytes = new TextEncoder().encode(html).buffer;

    const parsed = parseHtml(bytes, 'customer-onboarding-playbook.html');

    expect(parsed.title).toBe('Customer Onboarding Playbook');
    expect(parsed.headings).toEqual(['Introduction']);
  });

  it('uses <title> metadata ahead of the filename', () => {
    const html = '<title>Canonical HTML Title</title><main><h1>Introduction</h1></main>';
    const bytes = new TextEncoder().encode(html).buffer;

    const parsed = parseHtml(bytes, 'draft.html');

    expect(parsed.title).toBe('Canonical HTML Title');
  });
});

// ---------------------------------------------------------------------------
// pdf link labels — text-under-rect geometry (pure; pdf.js itself untestable here)
// ---------------------------------------------------------------------------
describe('labelForRect', () => {
  // baseline (tx, ty) at the given point; width in the same user-space units
  const span = (str: string, tx: number, ty: number, width: number): PdfTextSpan => ({
    str,
    transform: [10, 0, 0, 10, tx, ty],
    width,
  });

  it('collects the spans whose baseline and extent fall inside the rect', () => {
    const spans = [
      span('Before', 0, 100, 30),
      span('click', 40, 100, 25),
      span('here', 70, 100, 20),
      span('after.', 95, 100, 30),
    ];
    // rect covers "click here" only: x 38..92, y 96..110 (baseline 100 inside)
    expect(labelForRect(spans, [38, 96, 92, 110])).toBe('click here');
  });

  it('excludes spans on other lines (baseline outside the rect vertically)', () => {
    const spans = [span('link text', 40, 100, 40), span('next line', 40, 80, 40)];
    expect(labelForRect(spans, [38, 96, 92, 110])).toBe('link text');
  });

  it('takes a whole long span when the link covers most of the rect within it', () => {
    // one long item; the link rect is a small region inside it — glyph-level
    // splitting isn't possible, so the whole item is better than nothing
    const spans = [span('See the deployment guide for details', 0, 100, 200)];
    expect(labelForRect(spans, [60, 96, 120, 110])).toBe(
      'See the deployment guide for details',
    );
  });

  it('rejects spans with <50% horizontal overlap when the rect is wide', () => {
    // rect 0..100; span 90..150 overlaps only 10 of its 60 width
    const spans = [span('mostly outside', 90, 100, 60)];
    expect(labelForRect(spans, [0, 96, 100, 110])).toBe('');
  });

  it('handles flipped rect corner order and empty inputs', () => {
    const spans = [span('ok', 10, 50, 10)];
    expect(labelForRect(spans, [25, 60, 5, 45])).toBe('ok'); // corners swapped
    expect(labelForRect([], [0, 0, 100, 100])).toBe('');
    expect(labelForRect(spans, [0, 0])).toBe(''); // malformed rect
  });

  it('caps very long labels with an ellipsis', () => {
    const long = 'word '.repeat(60).trim();
    const label = labelForRect([span(long, 0, 100, 500)], [0, 96, 500, 110]);
    expect(label.length).toBeLessThanOrEqual(140);
    expect(label.endsWith('…')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// TF-IDF
// ---------------------------------------------------------------------------
describe('tfidf', () => {
  const docs = [
    { id: 'a', tf: { kafka: 5, deploy: 1, common: 2 } },
    { id: 'b', tf: { kafka: 3, consumer: 4, common: 2 } },
    { id: 'c', tf: { deploy: 6, terraform: 3, common: 2 } },
    { id: 'd', tf: { onboarding: 4, common: 2 } },
  ];

  it('rare terms get higher idf than ubiquitous ones', () => {
    const idf = computeIdf(docs);
    expect(idf.get('terraform')!).toBeGreaterThan(idf.get('common')!);
    expect(idf.get('kafka')!).toBeGreaterThan(idf.get('common')!);
  });

  it('topKeywords ranks by tf*idf and respects n', () => {
    const idf = computeIdf(docs);
    const top = topKeywords(docs[0].tf, 8, idf, 2);
    expect(top.length).toBeLessThanOrEqual(2);
    expect(top[0]).toBe('kafka'); // high tf, decent idf beats 'common'
    expect(top).not.toContain('common');
  });

  it('keywordEdges connects docs sharing >= minShared keywords, with evidence', () => {
    const idf = computeIdf(docs);
    const keywordsByDoc: Record<string, string[]> = {
      a: ['kafka', 'consumer', 'deploy'],
      b: ['kafka', 'consumer'],
      c: ['deploy', 'terraform'],
      d: ['onboarding'],
    };
    const edges = keywordEdges(docs, keywordsByDoc, idf, { minShared: 2, edgesPerDoc: 5 });
    const ab = edges.find(
      (e) =>
        (e.source === 'a' && e.target === 'b') || (e.source === 'b' && e.target === 'a'),
    );
    expect(ab).toBeDefined();
    expect(ab!.kind).toBe('keyword');
    expect(ab!.weight).toBeGreaterThan(0);
    expect(ab!.weight).toBeLessThanOrEqual(1);
    expect(ab!.evidence.length).toBeGreaterThan(0);
    expect(ab!.evidence.join(' ')).toMatch(/kafka|consumer/);
    // d shares nothing >= 2 — no edges touch it
    expect(edges.some((e) => e.source === 'd' || e.target === 'd')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// reference edges (links + title mentions)
// ---------------------------------------------------------------------------
describe('referenceEdges', () => {
  const docs = [
    {
      id: 'deploy',
      title: 'Deploy Guide',
      fileName: 'deploy-guide.md',
      textLower: 'how we ship. see the incident runbook when things break.',
      mdLinkTargets: ['incident-runbook.md'],
    },
    {
      id: 'runbook',
      title: 'Incident Runbook',
      fileName: 'incident-runbook.md',
      textLower: 'steps for sev1. escalate per oncall.',
      mdLinkTargets: [],
    },
    {
      id: 'oncall',
      title: 'Oncall',
      fileName: 'oncall.md',
      textLower: 'rotations and paging.',
      mdLinkTargets: [],
    },
  ];

  it('md link target to another doc creates a hard reference edge with evidence', () => {
    const edges = referenceEdges(docs, 5);
    const link = edges.find(
      (e) =>
        (e.source === 'deploy' && e.target === 'runbook') ||
        (e.source === 'runbook' && e.target === 'deploy'),
    );
    expect(link).toBeDefined();
    expect(link!.kind).toBe('reference');
    expect(link!.weight).toBeGreaterThanOrEqual(0.85);
    expect(link!.evidence.length).toBeGreaterThan(0);
  });

  it('title mention in text creates a reference edge', () => {
    const edges = referenceEdges(docs, 5);
    // 'incident runbook' appears in deploy's text — same pair as the link,
    // so evidence should exist either merged or as its own edge; the pair must exist.
    const pair = edges.filter(
      (e) =>
        (e.source === 'deploy' && e.target === 'runbook') ||
        (e.source === 'runbook' && e.target === 'deploy'),
    );
    expect(pair.length).toBeGreaterThanOrEqual(1);
  });

  it('does not self-reference and respects min title length', () => {
    const edges = referenceEdges(docs, 8); // 'Oncall' (6) too short now
    expect(edges.some((e) => e.source === e.target)).toBe(false);
    expect(
      edges.some(
        (e) =>
          (e.source === 'runbook' && e.target === 'oncall') ||
          (e.source === 'oncall' && e.target === 'runbook'),
      ),
    ).toBe(false);
  });

  it('ignores external URLs that share a basename with a local doc', () => {
    // An external link to a same-named file must NOT create a doc-to-doc edge.
    // Mention text is stripped so the only possible edge would be the link.
    const external = [
      { ...docs[0], textLower: 'how we ship.', mdLinkTargets: ['https://x.io/incident-runbook.md'] },
      { ...docs[1], textLower: 'sev1 steps.' },
    ];
    expect(referenceEdges(external, 5)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// entities
// ---------------------------------------------------------------------------
describe('extractEntities', () => {
  it('finds code identifiers and acronyms', () => {
    const text =
      'The AuthService uses JWT and OIDC. Call refresh_token_flow via AuthService. ' +
      'The refresh_token_flow rotates keys. JWT expiry is 15m. OIDC discovery required.';
    const entities = extractEntities(text);
    expect(entities).toContain('AuthService');
    expect(entities).toContain('refresh_token_flow');
    expect(entities).toContain('JWT');
  });
});

// ---------------------------------------------------------------------------
// chunker
// ---------------------------------------------------------------------------
describe('chunkText', () => {
  it('short text yields exactly one non-empty chunk', () => {
    const { chunks, truncated } = chunkText('A short document about deployment.');
    expect(chunks.length).toBe(1);
    expect(chunks[0].length).toBeGreaterThan(0);
    expect(truncated).toBe(false);
  });

  it('long text yields multiple overlapping chunks', () => {
    const para = 'word '.repeat(400).trim(); // ~400 words ≈ 520 tokens
    const text = Array.from({ length: 5 }, (_, i) => `Paragraph ${i}. ${para}`).join('\n\n');
    const { chunks } = chunkText(text);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.length).toBeGreaterThan(0);
      // The production chunker uses a conservative word heuristic so evidence
      // windows stay focused for retrieval.
      expect(c.split(/\s+/).length).toBeLessThanOrEqual(148);
    }
  });

  it('empty / whitespace-only text yields no chunks', () => {
    expect(chunkText('').chunks).toEqual([]);
    expect(chunkText('   \n\n  ').chunks).toEqual([]);
  });

  it('flags truncation and stays within the byte budget when over the embed cap', () => {
    // MAX_EMBED_TEXT_BYTES is 200 KB; build a document comfortably past it as
    // many distinct paragraphs so chunking produces multiple packable chunks.
    const para = Array.from({ length: 60 }, (_, i) => `sentence ${i} about the system`).join(' ');
    const text = Array.from({ length: 400 }, (_, i) => `Section ${i}. ${para}`).join('\n\n');
    const { chunks, truncated } = chunkText(text);
    expect(truncated).toBe(true);
    expect(chunks.length).toBeGreaterThan(0);
    const bytes = chunks.reduce((sum, c) => sum + new TextEncoder().encode(c).byteLength, 0);
    expect(bytes).toBeLessThanOrEqual(MAX_EMBED_TEXT_BYTES);
  });

  it('never returns empty for a single pathological oversized chunk', () => {
    // one giant unbroken "word" (e.g. a minified blob) that alone exceeds the cap
    const blob = 'x'.repeat(MAX_EMBED_TEXT_BYTES * 2);
    const { chunks, truncated } = chunkText(blob);
    expect(truncated).toBe(true);
    expect(chunks.length).toBe(1);
    expect(chunks[0].length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// boilerplate
// ---------------------------------------------------------------------------
describe('boilerplate', () => {
  it('detects lines repeated across most docs and strips them', () => {
    const footer = 'confidential — nimbus labs internal use only, do not distribute';
    const docLines = [
      ['alpha content here', footer],
      ['beta content here', footer],
      ['gamma content here', footer],
      ['delta content here', footer],
      ['epsilon unique line'],
    ];
    const bp = findBoilerplateLines(docLines);
    expect(bp.has(footer)).toBe(true);
    const stripped = stripBoilerplate(`alpha content here\n${footer}`, bp);
    expect(stripped).toContain('alpha content here');
    expect(stripped.toLowerCase()).not.toContain('confidential');
  });

  it('does not flag lines in few docs', () => {
    const docLines = [
      ['unique line one that is long enough to be considered'],
      ['unique line two that is long enough to be considered'],
      ['unique line three that is long enough to be considered'],
      ['unique line four that is long enough to be considered'],
    ];
    const bp = findBoilerplateLines(docLines);
    expect(bp.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// semantic similarity edge rule (spec §5.2: sim ≥ threshold AND mutual top-k)
// ---------------------------------------------------------------------------
describe('semanticEdges', () => {
  const dims = 4;
  function unit(v: number[]): number[] {
    const n = Math.hypot(...v);
    return v.map((x) => x / n);
  }
  function pack(vecs: number[][]): Float32Array {
    const out = new Float32Array(vecs.length * dims);
    vecs.forEach((v, i) => out.set(unit(v), i * dims));
    return out;
  }

  it('connects similar pairs above threshold with evidence, skips dissimilar', () => {
    const ids = ['a', 'b', 'c'];
    const vectors = pack([
      [1, 0.05, 0, 0],
      [1, 0.1, 0, 0], // a·b ≈ 0.998 — well above threshold
      [0, 0, 1, 0], // orthogonal to both
    ]);
    const { edges } = semanticEdges(ids, vectors, dims, {
      threshold: SIM_THRESHOLD,
      topK: SIM_TOP_K,
    });
    const ab = edges.find(
      (e) =>
        (e.source === 'a' && e.target === 'b') || (e.source === 'b' && e.target === 'a'),
    );
    expect(ab).toBeDefined();
    expect(ab!.kind).toBe('semantic');
    expect(ab!.weight).toBeGreaterThan(0);
    expect(ab!.weight).toBeLessThanOrEqual(1);
    expect(ab!.evidence.length).toBeGreaterThan(0);
    expect(edges.some((e) => e.source === 'c' || e.target === 'c')).toBe(false);
  });

  it('emits no duplicate pairs and no self-edges', () => {
    const ids = ['a', 'b', 'c', 'd'];
    const vectors = pack([
      [1, 0, 0, 0],
      [0.98, 0.2, 0, 0],
      [0.97, 0.24, 0, 0],
      [0.99, 0.14, 0, 0],
    ]);
    const { edges } = semanticEdges(ids, vectors, dims, { threshold: 0.62, topK: 5 });
    const seen = new Set<string>();
    for (const e of edges) {
      expect(e.source).not.toBe(e.target);
      const key = [e.source, e.target].sort().join('|');
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
    expect(edges.length).toBeGreaterThan(0);
  });

  it('top-k rule caps neighbors: with k=1 each doc keeps at most its best pair', () => {
    const ids = ['a', 'b', 'c'];
    // a~b strongly, a~c a bit less, b~c least
    const vectors = pack([
      [1, 0, 0, 0],
      [0.995, 0.1, 0, 0],
      [0.9, 0.436, 0, 0],
    ]);
    const { edges } = semanticEdges(ids, vectors, dims, { threshold: 0.62, topK: 1 });
    // mutual top-1: only a-b qualifies (a's best is b, b's best is a)
    expect(edges.length).toBe(1);
    const only = edges[0];
    expect([only.source, only.target].sort()).toEqual(['a', 'b']);
  });

  it('flags a near-duplicate pair crowded out of its mutual top-k edge', () => {
    // b has 3 near-duplicates (c, d, e) all closer to it than a is, so with
    // topK=1 the mutual-top-k rule can never connect a-b with an edge — but
    // a-b still clears the duplicate threshold and must be reported.
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const vectors = pack([
      [1, 0.06, 0, 0], // a: cos(a,b) ≈ 0.9997 — a's best match is b
      [1, 0, 0, 0], // b
      [1, 0.001, 0, 0], // c: nearly identical to b
      [1, 0.002, 0, 0], // d: nearly identical to b
      [1, 0.003, 0, 0], // e: nearly identical to b
    ]);
    const { edges, duplicates } = semanticEdges(ids, vectors, dims, {
      threshold: 0.62,
      topK: 1,
      dupThreshold: DUP_SIM_THRESHOLD,
    });
    // b's single top-k slot goes to c (its closest neighbor), so no a-b edge
    const ab = edges.find(
      (e) =>
        (e.source === 'a' && e.target === 'b') || (e.source === 'b' && e.target === 'a'),
    );
    expect(ab).toBeUndefined();
    // but the duplicate scan still finds it — that's the whole point
    const dup = duplicates.find(
      (d) => (d.a === 'a' && d.b === 'b') || (d.a === 'b' && d.b === 'a'),
    );
    expect(dup).toBeDefined();
    expect(dup!.sim).toBeGreaterThanOrEqual(DUP_SIM_THRESHOLD);
  });

  it('caps reported duplicates and keeps the highest-similarity pairs', () => {
    // 34 identical docs produce C(34,2) = 561 sim-1.0 pairs — more than the
    // cap — plus one weaker 0.95-sim pair listed FIRST so it must be evicted,
    // not just never inserted. Without a cap this array is O(n²).
    const weakPair = [
      [0, 1, 0, 0],
      [0, 1, 0.32, 0], // cos ≈ 0.953 vs its partner, ~0 vs the clones
    ];
    const clones = Array.from({ length: 34 }, () => [1, 0, 0, 0]);
    const vecs = [...weakPair, ...clones];
    const ids = vecs.map((_, i) => `doc${i}`);
    const { duplicates } = semanticEdges(ids, pack(vecs), dims, {
      threshold: 0.62,
      topK: 1,
      dupThreshold: 0.93,
    });
    expect(duplicates.length).toBe(MAX_DUPLICATE_PAIRS);
    for (const d of duplicates) expect(d.sim).toBeGreaterThan(0.99);
  });

  it('omitting dupThreshold reports no duplicates', () => {
    const ids = ['a', 'b'];
    const vectors = pack([
      [1, 0, 0, 0],
      [1, 0, 0, 0], // identical
    ]);
    const { duplicates } = semanticEdges(ids, vectors, dims, { threshold: 0.62, topK: 5 });
    expect(duplicates).toEqual([]);
  });
});

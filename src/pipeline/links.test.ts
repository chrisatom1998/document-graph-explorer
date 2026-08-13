/**
 * Parity harness for the indexed mention scan.
 *
 * referenceEdges used to compare every document against every other one; it now
 * scans each document once against an index of all titles/filenames. The
 * observable output must be identical, so these tests run the original pairwise
 * algorithm as an oracle and require both to agree — including edge ids,
 * weights, and the order of merged evidence strings.
 */
import { describe, expect, it } from 'vitest';
import {
  importPathCandidates,
  referenceEdges,
  testSubjectOf,
  WIKILINK_PREFIX,
  type ReferenceDocInput,
} from './links';
import type { Edge } from '../model/types';
import { isExternalUrl, normalizeLinkTarget } from './urlUtils';

const LINK_WEIGHT = 1.0;
const MENTION_WEIGHT = 0.85;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function mentionRegex(loweredNeedle: string): RegExp {
  return new RegExp(`(?<![a-z0-9_])${escapeRegExp(loweredNeedle)}(?![a-z0-9_])`);
}

/** The pre-optimization implementation, verbatim, as the source of truth. */
function referenceEdgesOracle(docs: ReferenceDocInput[], minTitleLen: number): Edge[] {
  const byFileName = new Map<string, ReferenceDocInput[]>();
  for (const doc of docs) {
    const key = normalizeLinkTarget(doc.fileName);
    if (!key) continue;
    let list = byFileName.get(key);
    if (!list) {
      list = [];
      byFileName.set(key, list);
    }
    list.push(doc);
  }

  interface PairAcc { a: string; b: string; weight: number; evidence: string[] }
  const pairs = new Map<string, PairAcc>();
  const addRef = (idA: string, idB: string, weight: number, evidence: string): void => {
    if (idA === idB) return;
    const a = idA < idB ? idA : idB;
    const b = idA < idB ? idB : idA;
    const key = `${a} ${b}`;
    const cur = pairs.get(key);
    if (!cur) {
      pairs.set(key, { a, b, weight, evidence: [evidence] });
      return;
    }
    cur.weight = Math.max(cur.weight, weight);
    if (!cur.evidence.includes(evidence)) cur.evidence.push(evidence);
  };

  for (const doc of docs) {
    for (const target of doc.mdLinkTargets) {
      if (isExternalUrl(target)) continue;
      const base = normalizeLinkTarget(target);
      if (!base) continue;
      const matches = byFileName.get(base);
      if (!matches) continue;
      for (const other of matches) {
        addRef(doc.id, other.id, LINK_WEIGHT, `links to '${other.fileName}'`);
      }
    }
  }

  for (const target of docs) {
    const patterns: { rx: RegExp; needle: string; label: string }[] = [];
    const title = target.title.trim();
    if (title.length >= minTitleLen) {
      const lowered = title.toLowerCase();
      patterns.push({ rx: mentionRegex(lowered), needle: lowered, label: title });
    }
    const fileName = target.fileName.trim();
    if (fileName.length >= minTitleLen && fileName.toLowerCase() !== title.toLowerCase()) {
      const lowered = fileName.toLowerCase();
      patterns.push({ rx: mentionRegex(lowered), needle: lowered, label: fileName });
    }
    if (patterns.length === 0) continue;

    for (const doc of docs) {
      if (doc.id === target.id) continue;
      for (const pattern of patterns) {
        if (!doc.textLower.includes(pattern.needle)) continue;
        if (!pattern.rx.test(doc.textLower)) continue;
        addRef(doc.id, target.id, MENTION_WEIGHT, `mentions '${pattern.label}'`);
        break;
      }
    }
  }

  return [...pairs.values()].map((pair): Edge => ({
    id: `${pair.a}->${pair.b}:reference`,
    source: pair.a,
    target: pair.b,
    kind: 'reference',
    weight: pair.weight,
    evidence: pair.evidence,
  }));
}

function doc(
  id: string,
  title: string,
  fileName: string,
  text: string,
  mdLinkTargets: string[] = [],
): ReferenceDocInput {
  return { id, title, fileName, textLower: text.toLowerCase(), mdLinkTargets };
}

function expectParity(docs: ReferenceDocInput[], minTitleLen = 5): Edge[] {
  const actual = referenceEdges(docs, minTitleLen);
  const expected = referenceEdgesOracle(docs, minTitleLen);
  const sort = (edges: Edge[]): Edge[] => [...edges].sort((a, b) => a.id.localeCompare(b.id));
  expect(sort(actual)).toEqual(sort(expected));
  return actual;
}

describe('referenceEdges mention scanning matches the pairwise oracle', () => {
  it('handles boundary traps around a shared title', () => {
    const docs = [
      doc('a', 'Incident Runbook', 'incident-runbook.md', 'nothing here'),
      // suffix, prefix, punctuation-adjacent, and an exact hit
      doc('b', 'Beta', 'beta.md', 'see incident runbooks for more'),
      doc('c', 'Gamma', 'gamma.md', 'xincident runbook is unrelated'),
      doc('d', 'Delta', 'delta.md', 'read the incident runbook.'),
      doc('e', 'Epsilon', 'epsilon.md', 'the INCIDENT RUNBOOK, again'),
    ];
    const edges = expectParity(docs);
    const hits = edges.filter((e) => e.evidence?.some((ev) => ev.includes('Incident Runbook')));
    expect(hits.map((e) => [e.source, e.target].sort().join('-'))).toEqual(['a-d', 'a-e']);
  });

  it('prefers the title label when a doc matches both title and filename', () => {
    const docs = [
      doc('a', 'Capacity Plan', 'capacity-notes.md', 'nothing'),
      doc('b', 'Beta', 'beta.md', 'the capacity plan and capacity-notes.md both'),
    ];
    const edges = expectParity(docs);
    expect(edges[0].evidence).toEqual(["mentions 'Capacity Plan'"]);
  });

  it('falls back to the filename when only it appears', () => {
    const docs = [
      doc('a', 'Capacity Plan', 'capacity-notes.md', 'nothing'),
      doc('b', 'Beta', 'beta.md', 'see capacity-notes.md'),
    ];
    const edges = expectParity(docs);
    expect(edges[0].evidence).toEqual(["mentions 'capacity-notes.md'"]);
  });

  it('matches needles that start with punctuation', () => {
    const docs = [
      doc('a', '.env settings', '.env-settings.md', 'nothing'),
      doc('b', 'Beta', 'beta.md', 'check the .env settings first'),
      doc('c', 'Gamma', 'gamma.md', 'my.env settings should not match'),
    ];
    expectParity(docs);
  });

  it('handles needles with no word characters at all', () => {
    const docs = [
      doc('a', '-----', '-----.md', 'nothing'),
      doc('b', 'Beta', 'beta.md', 'a ----- divider'),
    ];
    expectParity(docs);
  });

  it('keeps mutual mentions and link evidence merged in the same order', () => {
    const docs = [
      doc('a', 'Alpha Report', 'alpha.md', 'refers to the beta summary', ['beta.md']),
      doc('b', 'Beta Summary', 'beta.md', 'refers to the alpha report'),
    ];
    const edges = expectParity(docs);
    expect(edges).toHaveLength(1);
    expect(edges[0].evidence).toEqual([
      "links to 'beta.md'",
      "mentions 'Alpha Report'",
      "mentions 'Beta Summary'",
    ]);
  });

  it('respects minTitleLen', () => {
    const docs = [
      doc('a', 'Log', 'log.md', 'nothing'),
      doc('b', 'Beta', 'beta.md', 'the log says otherwise'),
    ];
    expect(referenceEdges(docs, 5)).toEqual([]);
    expectParity(docs, 5);
    expectParity(docs, 3);
  });

  it('agrees with the oracle across a corpus with colliding first tokens', () => {
    // Many titles sharing an anchor token is the degenerate case for the index.
    const titles = [
      'Meeting Notes January', 'Meeting Notes February', 'Meeting Notes March',
      'Incident Review Alpha', 'Incident Review Beta', 'Release Checklist',
      'Release Notes 2026', 'Capacity Planning Guide', 'On-call Handoff',
      'Security Assessment 2026',
    ];
    const docs: ReferenceDocInput[] = titles.map((title, i) =>
      doc(
        `d${i}`,
        title,
        `${title.toLowerCase().replace(/\s+/g, '-')}.md`,
        // Each doc quotes a couple of the others, plus near-miss variants.
        [
          `see ${titles[(i + 1) % titles.length]} for context`,
          `and ${titles[(i + 3) % titles.length]}.`,
          `${titles[(i + 2) % titles.length]}x should not match`,
          'meeting notes without a month',
        ].join(' '),
        i % 3 === 0 ? [`${titles[(i + 4) % titles.length].toLowerCase().replace(/\s+/g, '-')}.md`] : [],
      ),
    );
    const edges = expectParity(docs);
    expect(edges.length).toBeGreaterThan(10);
  });
});

// Not run through expectParity: the oracle deliberately fans a shared-name
// mention out to every same-name doc, which is the bug under test.
describe('referenceEdges mention ambiguity on folder drops', () => {
  it('does not reconnect same-name files via filename mentions', () => {
    const docs: ReferenceDocInput[] = [
      {
        id: 'a',
        title: 'Notes',
        fileName: 'notes.md',
        path: 'docs/notes.md',
        textLower: 'see util.ts for the helper',
        mdLinkTargets: [],
      },
      {
        id: 'b',
        title: 'Util',
        fileName: 'util.ts',
        path: 'src/auth/util.ts',
        textLower: 'export helper',
        mdLinkTargets: [],
      },
      {
        id: 'c',
        title: 'Util',
        fileName: 'util.ts',
        path: 'src/billing/util.ts',
        textLower: 'export other helper',
        mdLinkTargets: [],
      },
    ];
    const edges = referenceEdges(docs, 5);
    expect(edges.filter((e) => e.evidence.some((ev) => ev.startsWith('mentions')))).toEqual([]);
  });

  it('drops duplicated filename-derived titles too', () => {
    // Two README.md files share both the fileName needle and the title
    // cleanFilename derives from it; neither may fan out.
    const docs: ReferenceDocInput[] = [
      {
        id: 'a',
        title: 'Notes',
        fileName: 'notes.md',
        path: 'docs/notes.md',
        textLower: 'check the README and README.md in each package',
        mdLinkTargets: [],
      },
      {
        id: 'b',
        title: 'README',
        fileName: 'README.md',
        path: 'pkg/one/README.md',
        textLower: 'one',
        mdLinkTargets: [],
      },
      {
        id: 'c',
        title: 'README',
        fileName: 'README.md',
        path: 'pkg/two/README.md',
        textLower: 'two',
        mdLinkTargets: [],
      },
    ];
    const edges = referenceEdges(docs, 5);
    expect(edges.filter((e) => e.evidence.some((ev) => ev.startsWith('mentions')))).toEqual([]);
  });

  it('still mention-edges unique titles alongside ambiguous filenames', () => {
    const docs: ReferenceDocInput[] = [
      {
        id: 'a',
        title: 'Notes',
        fileName: 'notes.md',
        path: 'docs/notes.md',
        textLower: 'the capacity plan mentions util.ts',
        mdLinkTargets: [],
      },
      {
        id: 'b',
        title: 'Capacity Plan',
        fileName: 'capacity-plan.md',
        path: 'docs/capacity-plan.md',
        textLower: 'plan body',
        mdLinkTargets: [],
      },
      {
        id: 'c',
        title: 'Util',
        fileName: 'util.ts',
        path: 'src/auth/util.ts',
        textLower: 'export helper',
        mdLinkTargets: [],
      },
      {
        id: 'd',
        title: 'Util',
        fileName: 'util.ts',
        path: 'src/billing/util.ts',
        textLower: 'export other helper',
        mdLinkTargets: [],
      },
    ];
    const edges = referenceEdges(docs, 5);
    const mentions = edges.filter((e) => e.evidence.some((ev) => ev.startsWith('mentions')));
    expect(mentions.map((e) => [e.source, e.target].sort().join('-'))).toEqual(['a-b']);
    expect(mentions[0].evidence).toEqual(["mentions 'Capacity Plan'"]);
  });
});

describe('referenceEdges path-aware import resolution', () => {
  it('resolves extensionless relative imports to the neighboring source file', () => {
    const docs: ReferenceDocInput[] = [
      {
        id: 'a',
        title: 'Session',
        fileName: 'session.ts',
        path: 'src/auth/session.ts',
        textLower: 'import token',
        mdLinkTargets: ['./token'],
      },
      {
        id: 'b',
        title: 'Token',
        fileName: 'token.ts',
        path: 'src/auth/token.ts',
        textLower: 'export token',
        mdLinkTargets: [],
      },
      {
        id: 'c',
        title: 'Other Token',
        fileName: 'token.ts',
        path: 'src/other/token.ts',
        textLower: 'unrelated',
        mdLinkTargets: [],
      },
    ];
    const edges = referenceEdges(docs, 5);
    const ref = edges.find((e) => e.kind === 'reference' && e.evidence.some((ev) => ev.startsWith('links to')));
    expect(ref).toMatchObject({ source: 'a', target: 'b' });
    expect(ref?.evidence).toContain("links to 'token.ts'");
  });

  it('resolves ./dir to dir/index.ts', () => {
    const docs: ReferenceDocInput[] = [
      {
        id: 'a',
        title: 'App',
        fileName: 'app.ts',
        path: 'src/app.ts',
        textLower: 'import helpers',
        mdLinkTargets: ['./helpers'],
      },
      {
        id: 'b',
        title: 'Index',
        fileName: 'index.ts',
        path: 'src/helpers/index.ts',
        textLower: 'export helpers',
        mdLinkTargets: [],
      },
    ];
    const edges = referenceEdges(docs, 5);
    expect(edges.some((e) => e.source === 'a' && e.target === 'b')).toBe(true);
  });

  // Not run through expectParity: the oracle is basename-only and would
  // deliberately fan out to both same-name files, which is the bug under test.
  it('does not fan out a bare #include to an unrelated same-name header', () => {
    const docs: ReferenceDocInput[] = [
      {
        id: 'a',
        title: 'Main',
        fileName: 'main.c',
        path: 'src/main.c',
        textLower: '#include "util.h"',
        mdLinkTargets: ['util.h'],
      },
      {
        id: 'b',
        title: 'Inc Util',
        fileName: 'util.h',
        path: 'inc/util.h',
        textLower: '',
        mdLinkTargets: [],
      },
      {
        id: 'c',
        title: 'Other Util',
        fileName: 'util.h',
        path: 'other/util.h',
        textLower: '',
        mdLinkTargets: [],
      },
    ];
    const edges = referenceEdges(docs, 5);
    const linkEdges = edges.filter((e) => e.evidence.some((ev) => ev.startsWith('links to')));
    expect(linkEdges).toEqual([]);
  });

  it('keeps a markdown link edge when the href carries a #fragment (folder drop)', () => {
    // `[see](guide.md#install)` from a doc WITH a path: resolution is
    // path-authoritative, so the fragment must not poison the byPath key.
    const docs: ReferenceDocInput[] = [
      {
        id: 'a',
        title: 'Intro',
        fileName: 'intro.md',
        path: 'docs/intro.md',
        textLower: 'see the guide',
        mdLinkTargets: ['guide.md#install'],
      },
      {
        id: 'b',
        title: 'Guide',
        fileName: 'guide.md',
        path: 'docs/guide.md',
        textLower: 'installation steps',
        mdLinkTargets: [],
      },
    ];
    const edges = referenceEdges(docs, 5);
    const link = edges.find((e) => e.evidence.some((ev) => ev.startsWith('links to')));
    expect(link).toMatchObject({ source: 'a', target: 'b' });
    expect(link?.evidence).toContain("links to 'guide.md'");
  });

  it('resolves ./relative markdown links with fragments and queries', () => {
    const docs: ReferenceDocInput[] = [
      {
        id: 'a',
        title: 'Intro',
        fileName: 'intro.md',
        path: 'docs/intro.md',
        textLower: '',
        mdLinkTargets: ['./guide.md#section', './faq.md?highlight=x'],
      },
      {
        id: 'b',
        title: 'Guide',
        fileName: 'guide.md',
        path: 'docs/guide.md',
        textLower: '',
        mdLinkTargets: [],
      },
      {
        id: 'c',
        title: 'Faq',
        fileName: 'faq.md',
        path: 'docs/faq.md',
        textLower: '',
        mdLinkTargets: [],
      },
    ];
    const edges = referenceEdges(docs, 5);
    const linked = edges
      .filter((e) => e.evidence.some((ev) => ev.startsWith('links to')))
      .map((e) => [e.source, e.target].sort().join('-'))
      .sort();
    expect(linked).toEqual(['a-b', 'a-c']);
  });

  it('does not fan out an in-page-only #fragment link', () => {
    const docs: ReferenceDocInput[] = [
      {
        id: 'a',
        title: 'Intro',
        fileName: 'intro.md',
        path: 'docs/intro.md',
        textLower: '',
        mdLinkTargets: ['#only-hash'],
      },
      {
        id: 'b',
        title: 'Guide',
        fileName: 'guide.md',
        path: 'docs/guide.md',
        textLower: '',
        mdLinkTargets: [],
      },
    ];
    const edges = referenceEdges(docs, 5);
    expect(edges.filter((e) => e.evidence.some((ev) => ev.startsWith('links to')))).toEqual([]);
  });

  it('importPathCandidates strips fragments/queries and resolves sibling filenames', () => {
    expect(importPathCandidates('docs/intro.md', 'guide.md#install')).toContain('docs/guide.md');
    expect(importPathCandidates('docs/intro.md', './guide.md#section')).toContain('docs/guide.md');
    expect(importPathCandidates('docs/intro.md', 'guide.md?query=1')).toContain('docs/guide.md');
    expect(importPathCandidates('docs/intro.md', '#install')).toEqual([]);
    // bare module names still do NOT resolve against the importing file's dir
    expect(importPathCandidates('src/main.py', 'os')).not.toContain('src/os');
  });

  it('mixed-language integration: true structural edges, no same-name gluing', () => {
    // A mixed folder: markdown docs + source + two same-basename files in
    // different directories (the "done when" scenario).
    const d = (
      id: string,
      fileName: string,
      path: string,
      text: string,
      mdLinkTargets: string[] = [],
      codeSymbols: string[] = [],
    ): ReferenceDocInput => ({
      id,
      title: fileName.replace(/\.\w+$/, ''),
      fileName,
      path,
      textLower: text.toLowerCase(),
      mdLinkTargets,
      codeSymbols,
    });
    const docs = [
      d('readme', 'README.md', 'README.md',
        'overview. drag files onto the DropZone component. see src/auth/util.ts for token helpers.',
        ['docs/user-guide.md']),
      d('guide', 'user-guide.md', 'docs/user-guide.md', 'the user guide body.'),
      d('dropzone', 'DropZone.tsx', 'src/ingest/DropZone.tsx',
        'export function DropZone() {}', ['./util'], ['DropZone']),
      d('ingestutil', 'util.ts', 'src/ingest/util.ts', 'ingest helpers'),
      d('authutil', 'util.ts', 'src/auth/util.ts',
        '// documented in docs/user-guide.md\nexport const token = 1;'),
      d('authtest', 'util.test.ts', 'src/auth/util.test.ts', 'test body without imports'),
    ];
    const edges = referenceEdges(docs, 5);
    const pair = (a: string, b: string): Edge | undefined =>
      edges.find(
        (e) => (e.source === a && e.target === b) || (e.source === b && e.target === a),
      );
    // true structural edges exist:
    expect(pair('readme', 'guide')).toBeDefined(); // explicit md link
    expect(pair('readme', 'dropzone')).toBeDefined(); // unique symbol mention
    expect(pair('readme', 'authutil')).toBeDefined(); // path mention picks the right util.ts
    expect(pair('dropzone', 'ingestutil')).toBeDefined(); // relative import
    expect(pair('authutil', 'guide')).toBeDefined(); // code comment names the doc path
    expect(pair('authtest', 'authutil')).toBeDefined(); // test↔source companion
    // and no false ones:
    expect(pair('readme', 'ingestutil')).toBeUndefined(); // wrong same-name util.ts
    expect(pair('ingestutil', 'authutil')).toBeUndefined(); // same basename ≠ related
    expect(pair('authtest', 'ingestutil')).toBeUndefined(); // test binds to its own dir
  });

  it('resolves a leading-slash href vault-root-relative, not file-relative', () => {
    const candidates = importPathCandidates('MyVault/src/nested.md', '/docs/guide.md');
    expect(candidates).toContain('myvault/docs/guide.md');
    expect(candidates).not.toContain('myvault/src/docs/guide.md');
    // no folder-drop prefix on fromPath: the leading slash just strips
    expect(importPathCandidates('nested.md', '/docs/guide.md')).toContain('docs/guide.md');
  });

  it('links a leading-slash markdown href to the vault-root file, not a nested miss', () => {
    const docs: ReferenceDocInput[] = [
      {
        id: 'a',
        title: 'Nested',
        fileName: 'nested.md',
        path: 'MyVault/src/nested.md',
        textLower: '',
        mdLinkTargets: ['/docs/guide.md'],
      },
      {
        id: 'b',
        title: 'Guide',
        fileName: 'guide.md',
        path: 'MyVault/docs/guide.md',
        textLower: '',
        mdLinkTargets: [],
      },
      {
        id: 'c',
        title: 'Wrong Guide',
        fileName: 'guide.md',
        path: 'MyVault/src/docs/guide.md',
        textLower: '',
        mdLinkTargets: [],
      },
    ];
    const edges = referenceEdges(docs, 5);
    const linkEdges = edges.filter((e) => e.evidence.some((ev) => ev.startsWith('links to')));
    expect(linkEdges).toHaveLength(1);
    expect(linkEdges[0]).toMatchObject({ source: 'a', target: 'b' });
  });

  it('does not attach a bare python import to an unrelated same-stem file', () => {
    const docs: ReferenceDocInput[] = [
      {
        id: 'a',
        title: 'Main',
        fileName: 'main.py',
        path: 'src/main.py',
        textLower: 'import os',
        mdLinkTargets: ['os'],
      },
      {
        id: 'b',
        title: 'Os Module',
        fileName: 'os.ts',
        path: 'src/os.ts',
        textLower: '',
        mdLinkTargets: [],
      },
    ];
    const edges = referenceEdges(docs, 5);
    const linkEdges = edges.filter((e) => e.evidence.some((ev) => ev.startsWith('links to')));
    expect(linkEdges).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// path mentions — prose naming a file by (partial) path
// ---------------------------------------------------------------------------

function pathDoc(
  id: string,
  fileName: string,
  path: string,
  text: string,
  extra: Partial<ReferenceDocInput> = {},
): ReferenceDocInput {
  return {
    id,
    title: fileName.replace(/\.\w+$/, ''),
    fileName,
    path,
    textLower: text.toLowerCase(),
    mdLinkTargets: [],
    ...extra,
  };
}

describe('referenceEdges path mentions', () => {
  const utils = (): ReferenceDocInput[] => [
    pathDoc('auth', 'util.ts', 'src/auth/util.ts', 'export const a = 1;'),
    pathDoc('billing', 'util.ts', 'src/billing/util.ts', 'export const b = 2;'),
  ];
  const mentionsOf = (edges: Edge[]): Edge[] =>
    edges.filter((e) => e.evidence.some((ev) => ev.startsWith('mentions path')));

  it('connects a doc naming a shared-basename file by its unique path', () => {
    const docs = [
      pathDoc('notes', 'notes.md', 'docs/notes.md', 'token helpers live in src/auth/util.ts today.'),
      ...utils(),
    ];
    const mentions = mentionsOf(referenceEdges(docs, 5));
    expect(mentions.map((e) => [e.source, e.target].sort().join('-'))).toEqual(['auth-notes']);
    expect(mentions[0].evidence).toEqual(["mentions path 'src/auth/util.ts'"]);
    expect(mentions[0].weight).toBeCloseTo(0.95);
  });

  it('matches ./-prefixed and extensionless path mentions', () => {
    const docs = [
      pathDoc('a', 'a.md', 'docs/a.md', 'see ./src/auth/util.ts for details.'),
      pathDoc('b', 'b.md', 'docs/b.md', 'the helper in src/auth/util does it.'),
      ...utils(),
    ];
    const mentions = mentionsOf(referenceEdges(docs, 5));
    expect(mentions.map((e) => [e.source, e.target].sort().join('-')).sort()).toEqual([
      'a-auth',
      'auth-b',
    ]);
  });

  it('does not match a suffix of a longer, different path', () => {
    const docs = [
      pathDoc('notes', 'notes.md', 'docs/notes.md', 'the copy in vendor/src/auth/util.ts differs.'),
      ...utils(),
    ];
    expect(mentionsOf(referenceEdges(docs, 5))).toEqual([]);
  });

  it('does not match an extensionless mention that continues into another extension', () => {
    const docs = [
      pathDoc('notes', 'notes.md', 'docs/notes.md', 'read src/auth/util.rs instead.'),
      ...utils(),
    ];
    expect(mentionsOf(referenceEdges(docs, 5))).toEqual([]);
  });

  it('drops path suffixes shared by two files', () => {
    const docs = [
      pathDoc('notes', 'notes.md', 'docs/notes.md', 'check auth/util.ts here.'),
      pathDoc('auth', 'util.ts', 'src/auth/util.ts', ''),
      pathDoc('auth2', 'util.ts', 'other/auth/util.ts', ''),
    ];
    // `auth/util.ts` is claimed by both — ambiguous, no edge; the full paths
    // (src/… vs other/…) remain distinct needles but don't appear in the text.
    expect(mentionsOf(referenceEdges(docs, 5))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// symbol mentions — prose naming a symbol defined in exactly one code file
// ---------------------------------------------------------------------------

describe('referenceEdges symbol mentions', () => {
  const symbolMentions = (edges: Edge[]): Edge[] =>
    edges.filter((e) => e.evidence.some((ev) => ev.startsWith('mentions symbol')));

  it('connects a doc naming a uniquely defined identifier to its definer', () => {
    const docs = [
      pathDoc('guide', 'guide.md', 'docs/guide.md', 'call refresh_token_flow to rotate keys.'),
      pathDoc('auth', 'auth.py', 'src/auth.py', 'def refresh_token_flow(): pass', {
        codeSymbols: ['refresh_token_flow'],
      }),
    ];
    const mentions = symbolMentions(referenceEdges(docs, 5));
    expect(mentions.map((e) => [e.source, e.target].sort().join('-'))).toEqual(['auth-guide']);
    expect(mentions[0].evidence).toEqual(["mentions symbol 'refresh_token_flow'"]);
  });

  it('drops symbols defined in more than one file', () => {
    const docs = [
      pathDoc('guide', 'guide.md', 'docs/guide.md', 'the AuthClient handles retries.'),
      pathDoc('a', 'a.ts', 'src/a.ts', 'export class AuthClient {}', { codeSymbols: ['AuthClient'] }),
      pathDoc('b', 'b.ts', 'src/b.ts', 'export class AuthClient {}', { codeSymbols: ['AuthClient'] }),
    ];
    expect(symbolMentions(referenceEdges(docs, 5))).toEqual([]);
  });

  it('never turns single-word or short symbols into needles', () => {
    const docs = [
      pathDoc('guide', 'guide.md', 'docs/guide.md', 'the index of the main run and props.'),
      pathDoc('code', 'app.ts', 'src/app.ts', '…', {
        codeSymbols: ['Index', 'main', 'run', 'Props', 'AppD'],
      }),
    ];
    expect(symbolMentions(referenceEdges(docs, 5))).toEqual([]);
  });

  it('requires word boundaries around the symbol', () => {
    const docs = [
      pathDoc('guide', 'guide.md', 'docs/guide.md', 'use myDropZones here.'),
      pathDoc('code', 'DropZone.tsx', 'src/DropZone.tsx', '…', { codeSymbols: ['DropZone'] }),
    ];
    expect(symbolMentions(referenceEdges(docs, 5))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// wikilinks — [[Note]] resolves corpus-wide by name, never by fan-out
// ---------------------------------------------------------------------------

describe('referenceEdges wikilinks', () => {
  const linkEdges = (edges: Edge[]): Edge[] =>
    edges.filter((e) => e.evidence.some((ev) => ev.startsWith('links to')));

  it('resolves [[Title]] to the unique doc with that title, despite paths', () => {
    const docs = [
      pathDoc('a', 'index.md', 'vault/index.md', 'see the deploy guide', {
        mdLinkTargets: [`${WIKILINK_PREFIX}Deploy Guide`],
      }),
      { ...pathDoc('b', 'deploy-guide.md', 'vault/ops/deploy-guide.md', 'guide body'), title: 'Deploy Guide' },
    ];
    const links = linkEdges(referenceEdges(docs, 5));
    expect(links.map((e) => [e.source, e.target].sort().join('-'))).toEqual(['a-b']);
  });

  it('resolves [[stem]] and [[stem#section]] by filename stem', () => {
    const docs = [
      pathDoc('a', 'index.md', 'vault/index.md', '', {
        mdLinkTargets: [`${WIKILINK_PREFIX}deploy-guide#rollout`],
      }),
      pathDoc('b', 'deploy-guide.md', 'vault/ops/deploy-guide.md', 'guide body'),
    ];
    const links = linkEdges(referenceEdges(docs, 5));
    expect(links.map((e) => [e.source, e.target].sort().join('-'))).toEqual(['a-b']);
  });

  it('drops wikilinks whose name matches several docs', () => {
    const docs = [
      pathDoc('a', 'index.md', 'vault/index.md', '', {
        mdLinkTargets: [`${WIKILINK_PREFIX}notes`],
      }),
      pathDoc('b', 'notes.md', 'vault/one/notes.md', 'one'),
      pathDoc('c', 'notes.md', 'vault/two/notes.md', 'two'),
    ];
    expect(linkEdges(referenceEdges(docs, 5))).toEqual([]);
  });

  it('resolves a path-style wikilink after a folder ingest, without fanning out', () => {
    // MyVault/projects/alpha.md and MyVault/inbox/alpha.md share a bare stem;
    // [[projects/alpha]] disambiguates by directory and must hit only the
    // projects one, while the bare [[alpha]] must still drop.
    const docs = [
      pathDoc('note', 'index.md', 'MyVault/index.md', '', {
        mdLinkTargets: [`${WIKILINK_PREFIX}projects/alpha`, `${WIKILINK_PREFIX}alpha`],
      }),
      pathDoc('projectsAlpha', 'alpha.md', 'MyVault/projects/alpha.md', 'projects alpha'),
      pathDoc('inboxAlpha', 'alpha.md', 'MyVault/inbox/alpha.md', 'inbox alpha'),
    ];
    const links = linkEdges(referenceEdges(docs, 5));
    expect(links.map((e) => [e.source, e.target].sort().join('-'))).toEqual(['note-projectsAlpha']);
  });
});

// ---------------------------------------------------------------------------
// test↔source companions
// ---------------------------------------------------------------------------

describe('testSubjectOf', () => {
  it('recognizes common test naming conventions', () => {
    expect(testSubjectOf('links.test.ts')?.stem).toBe('links');
    expect(testSubjectOf('links.spec.tsx')?.stem).toBe('links');
    expect(testSubjectOf('parser_test.go')?.stem).toBe('parser');
    expect(testSubjectOf('test_ingest.py')?.stem).toBe('ingest');
    expect(testSubjectOf('ingest_test.py')?.stem).toBe('ingest');
    expect(testSubjectOf('worker_spec.rb')?.stem).toBe('worker');
    expect(testSubjectOf('AuthServiceTest.java')?.stem).toBe('authservice');
  });

  it('rejects non-test files and lookalikes', () => {
    expect(testSubjectOf('links.ts')).toBeNull();
    expect(testSubjectOf('contest.java')).toBeNull(); // no case-folded 'Test' suffix
    expect(testSubjectOf('protest.py')).toBeNull();
    expect(testSubjectOf('latest.go')).toBeNull();
  });
});

describe('referenceEdges test↔source companions', () => {
  const companions = (edges: Edge[]): Edge[] =>
    edges.filter((e) => e.evidence.some((ev) => ev.startsWith('test file for')));

  it('links a Go same-package test to its source without imports', () => {
    const docs = [
      pathDoc('src', 'parser.go', 'pkg/parser.go', 'package pkg'),
      pathDoc('test', 'parser_test.go', 'pkg/parser_test.go', 'package pkg'),
    ];
    const found = companions(referenceEdges(docs, 5));
    expect(found.map((e) => [e.source, e.target].sort().join('-'))).toEqual(['src-test']);
    expect(found[0].evidence).toContain("test file for 'parser.go'");
  });

  it('prefers the mirrored directory when trees are parallel', () => {
    const docs = [
      pathDoc('right', 'links.py', 'src/pipeline/links.py', ''),
      pathDoc('wrong', 'links.py', 'src/graph/links.py', ''),
      pathDoc('test', 'test_links.py', 'tests/pipeline/test_links.py', ''),
    ];
    const found = companions(referenceEdges(docs, 5));
    expect(found.map((e) => [e.source, e.target].sort().join('-'))).toEqual(['right-test']);
  });

  it('links a unique corpus-wide subject across unrelated directories', () => {
    const docs = [
      pathDoc('src', 'links.py', 'src/links.py', ''),
      pathDoc('test', 'test_links.py', 'tests/test_links.py', ''),
    ];
    expect(companions(referenceEdges(docs, 5))).toHaveLength(1);
  });

  it('drops ambiguous subjects instead of guessing', () => {
    const docs = [
      pathDoc('a', 'util.py', 'src/auth/util.py', ''),
      pathDoc('b', 'util.py', 'src/billing/util.py', ''),
      pathDoc('test', 'test_util.py', 'tests/test_util.py', ''),
    ];
    expect(companions(referenceEdges(docs, 5))).toEqual([]);
  });

  it('never pairs across language families', () => {
    const docs = [
      pathDoc('src', 'links.rs', 'src/links.rs', ''),
      pathDoc('test', 'links.test.ts', 'src/links.test.ts', ''),
    ];
    expect(companions(referenceEdges(docs, 5))).toEqual([]);
  });
});

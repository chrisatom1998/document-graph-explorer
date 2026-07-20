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
import { referenceEdges, type ReferenceDocInput } from './links';
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

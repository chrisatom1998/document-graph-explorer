/**
 * Reference edges — the "hard edges" of spec §5.1: explicit markdown links
 * to other documents, and mentions of other documents' titles/filenames in
 * body text. PURE — runs in the aggregator worker and in unit tests.
 */

import type { Edge } from '../model/types';
import { isExternalUrl, normalizeLinkTarget } from './urlUtils';

export interface ReferenceDocInput {
  id: string;
  title: string;
  fileName: string;
  textLower: string;
  mdLinkTargets: string[];
}

const LINK_WEIGHT = 1.0;
const MENTION_WEIGHT = 0.85;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Word-boundary-ish match that stays correct when the needle starts or ends
 * with non-word characters (e.g. filenames): explicit alphanumeric
 * lookarounds instead of \b.
 */
function mentionRegex(loweredNeedle: string): RegExp {
  return new RegExp(`(?<![a-z0-9_])${escapeRegExp(loweredNeedle)}(?![a-z0-9_])`);
}

interface PairAcc {
  a: string;
  b: string;
  weight: number;
  evidence: string[];
}

/** Title (0) is preferred over filename (1) when a doc matches both. */
type MentionKind = 0 | 1;

interface MentionPattern {
  targetId: string;
  /** Lowercased text to find. */
  needle: string;
  /** Original-case text for the evidence string. */
  label: string;
  kind: MentionKind;
  /** First [a-z0-9_] run in the needle, and where it starts. */
  anchor: string;
  anchorOffset: number;
  /** Only for needles with no word characters at all. */
  rx?: RegExp;
}

const WORD_CHAR = /[a-z0-9_]/;
const WORD_RUN = /[a-z0-9_]+/g;

function buildMentionPatterns(
  docs: ReferenceDocInput[],
  minTitleLen: number,
): MentionPattern[] {
  const patterns: MentionPattern[] = [];
  const push = (targetId: string, raw: string, kind: MentionKind): void => {
    const needle = raw.toLowerCase();
    const anchorMatch = /[a-z0-9_]+/.exec(needle);
    patterns.push(
      anchorMatch
        ? {
            targetId,
            needle,
            label: raw,
            kind,
            anchor: anchorMatch[0],
            anchorOffset: anchorMatch.index,
          }
        : // No word characters to anchor on (e.g. "-----"); rare enough to
          // scan with the original regex instead of indexing.
          { targetId, needle, label: raw, kind, anchor: '', anchorOffset: 0, rx: mentionRegex(needle) },
    );
  };

  for (const target of docs) {
    const title = target.title.trim();
    if (title.length >= minTitleLen) push(target.id, title, 0);
    const fileName = target.fileName.trim();
    if (fileName.length >= minTitleLen && fileName.toLowerCase() !== title.toLowerCase()) {
      push(target.id, fileName, 1);
    }
  }
  return patterns;
}

interface MentionIndex {
  byAnchor: Map<string, MentionPattern[]>;
  unanchored: MentionPattern[];
}

function buildMentionIndex(patterns: MentionPattern[]): MentionIndex {
  const byAnchor = new Map<string, MentionPattern[]>();
  const unanchored: MentionPattern[] = [];
  for (const pattern of patterns) {
    if (!pattern.anchor) {
      unanchored.push(pattern);
      continue;
    }
    let list = byAnchor.get(pattern.anchor);
    if (!list) {
      list = [];
      byAnchor.set(pattern.anchor, list);
    }
    list.push(pattern);
  }
  return { byAnchor, unanchored };
}

/**
 * Every pattern this text mentions, found in ONE pass over the text.
 *
 * Equivalent to testing each needle's word-boundary regex against the text,
 * but driven from the text side: walk the text's word runs and only consider
 * needles whose first word run matches. A needle's anchor is always preceded
 * within the needle by non-word characters, so wherever the needle legitimately
 * occurs the text tokenizer starts a run at exactly that offset — nothing a
 * per-needle scan would find is missed. The boundary checks below are the
 * lookarounds in mentionRegex, applied by hand.
 */
function scanMentions(textLower: string, index: MentionIndex): MentionPattern[] {
  const found: MentionPattern[] = [];
  const seen = new Set<MentionPattern>();
  WORD_RUN.lastIndex = 0;
  let run: RegExpExecArray | null;
  while ((run = WORD_RUN.exec(textLower)) !== null) {
    const candidates = index.byAnchor.get(run[0]);
    if (!candidates) continue;
    for (const pattern of candidates) {
      if (seen.has(pattern)) continue;
      const start = run.index - pattern.anchorOffset;
      if (start < 0) continue;
      const end = start + pattern.needle.length;
      if (start > 0 && WORD_CHAR.test(textLower[start - 1])) continue;
      if (end < textLower.length && WORD_CHAR.test(textLower[end])) continue;
      if (!textLower.startsWith(pattern.needle, start)) continue;
      seen.add(pattern);
      found.push(pattern);
    }
  }
  for (const pattern of index.unanchored) {
    if (!seen.has(pattern) && pattern.rx!.test(textLower)) {
      seen.add(pattern);
      found.push(pattern);
    }
  }
  return found;
}

export function referenceEdges(
  docs: ReferenceDocInput[],
  minTitleLen: number,
): Edge[] {
  // index docs by lowercased filename basename
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

  const pairs = new Map<string, PairAcc>();
  const addRef = (idA: string, idB: string, weight: number, evidence: string): void => {
    if (idA === idB) return; // skip self-references
    const a = idA < idB ? idA : idB;
    const b = idA < idB ? idB : idA;
    const key = `${a} ${b}`;
    const cur = pairs.get(key);
    if (!cur) {
      pairs.set(key, { a, b, weight, evidence: [evidence] });
      return;
    }
    cur.weight = Math.max(cur.weight, weight); // keep strongest
    if (!cur.evidence.includes(evidence)) cur.evidence.push(evidence); // merge evidence
  };

  // 1) explicit md link targets -> another doc's fileName
  for (const doc of docs) {
    for (const target of doc.mdLinkTargets) {
      if (isExternalUrl(target)) continue; // external web links aren't doc refs
      const base = normalizeLinkTarget(target);
      if (!base) continue;
      const matches = byFileName.get(base);
      if (!matches) continue;
      for (const other of matches) {
        addRef(doc.id, other.id, LINK_WEIGHT, `links to '${other.fileName}'`);
      }
    }
  }

  // 2) title / filename mentions in body text
  //
  // Indexed rather than compared pairwise: the original scanned every doc's
  // full text once per other doc, so a 2000-doc corpus meant ~4M substring
  // scans over up-to-200KB strings and blew the aggregator's timeout. Each
  // doc's text is now read once against an index of every title/filename.
  const patterns = buildMentionPatterns(docs, minTitleLen);
  const index = buildMentionIndex(patterns);

  // target id -> (doc id -> the pattern to credit), both in `docs` order.
  const hitsByTarget = new Map<string, Map<string, MentionPattern>>();
  for (const doc of docs) {
    for (const pattern of scanMentions(doc.textLower, index)) {
      if (pattern.targetId === doc.id) continue; // skip self-references
      let perTarget = hitsByTarget.get(pattern.targetId);
      if (!perTarget) {
        perTarget = new Map();
        hitsByTarget.set(pattern.targetId, perTarget);
      }
      // Title beats filename, matching the original's first-match-wins order.
      const existing = perTarget.get(doc.id);
      if (!existing || pattern.kind < existing.kind) perTarget.set(doc.id, pattern);
    }
  }

  // Emitted target-major, then doc-order, so evidence lists stay in the same
  // order the pairwise version produced.
  for (const target of docs) {
    const perTarget = hitsByTarget.get(target.id);
    if (!perTarget) continue;
    for (const [docId, pattern] of perTarget) {
      addRef(docId, target.id, MENTION_WEIGHT, `mentions '${pattern.label}'`);
    }
  }

  return [...pairs.values()].map(
    (pair): Edge => ({
      id: `${pair.a}->${pair.b}:reference`,
      source: pair.a,
      target: pair.b,
      kind: 'reference',
      weight: pair.weight,
      evidence: pair.evidence,
    }),
  );
}

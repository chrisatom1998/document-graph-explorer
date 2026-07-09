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
  for (const target of docs) {
    const patterns: { rx: RegExp; needle: string; label: string }[] = [];
    const title = target.title.trim();
    if (title.length >= minTitleLen) {
      const lowered = title.toLowerCase();
      patterns.push({ rx: mentionRegex(lowered), needle: lowered, label: title });
    }
    const fileName = target.fileName.trim();
    if (
      fileName.length >= minTitleLen &&
      fileName.toLowerCase() !== title.toLowerCase()
    ) {
      const lowered = fileName.toLowerCase();
      patterns.push({ rx: mentionRegex(lowered), needle: lowered, label: fileName });
    }
    if (patterns.length === 0) continue;

    for (const doc of docs) {
      if (doc.id === target.id) continue;
      for (const pattern of patterns) {
        // cheap substring prefilter before the regex boundary check
        if (!doc.textLower.includes(pattern.needle)) continue;
        if (!pattern.rx.test(doc.textLower)) continue;
        addRef(doc.id, target.id, MENTION_WEIGHT, `mentions '${pattern.label}'`);
        break;
      }
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

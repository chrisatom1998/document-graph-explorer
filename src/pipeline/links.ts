/**
 * Reference edges — the "hard edges" of spec §5.1: explicit markdown links
 * and wikilinks to other documents, mentions of other documents' titles /
 * filenames / paths / defined symbols in body text, and test↔source
 * companion files. PURE — runs in the aggregator worker and in unit tests.
 */

import type { Edge } from '../model/types';
import { posixBasename, posixDirname, posixJoin, posixNormalize, posixResolveFrom, stripKnownExtension } from '../util/posixPath';
import { isExternalUrl, normalizeLinkTarget } from './urlUtils';

export interface ReferenceDocInput {
  id: string;
  title: string;
  fileName: string;
  /** Repo-relative path when the file was dropped as part of a folder. */
  path?: string;
  textLower: string;
  mdLinkTargets: string[];
  /** Top-level symbols DEFINED in this file (code parser); mention targets. */
  codeSymbols?: string[];
}

/**
 * Wikilink targets (`[[Note]]`) are marked with this prefix by the markdown
 * parser: they name a note by title/stem corpus-wide (Obsidian semantics),
 * so they must not be swallowed by the path-authoritative import resolution.
 */
export const WIKILINK_PREFIX = 'wikilink:';

const LINK_WEIGHT = 1.0;
const MENTION_WEIGHT = 0.85;
const PATH_MENTION_WEIGHT = 0.95;
const SYMBOL_MENTION_WEIGHT = 0.8;
const TEST_COMPANION_WEIGHT = 0.95;

/** Extensions tried when an import omits them (`./foo` → `foo.ts`). */
const RESOLVE_EXTENSIONS = [
  '.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.pyi', '.go', '.rs', '.java', '.kt', '.kts',
  '.h', '.hpp', '.hh', '.c', '.cc', '.cpp', '.cs',
  '.rb', '.php', '.vue', '.svelte', '.css', '.scss',
  '.json', '.md', '.toml',
];

const INDEX_BASENAMES = [
  'index.ts', 'index.tsx', 'index.js', 'index.jsx', 'index.mjs',
  'index.py', '__init__.py', 'mod.rs', 'index.go',
];

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

/**
 * Mention pattern kinds, in preference order when one doc matches several
 * patterns of the same target: title (0) beats filename (1) beats path (2)
 * beats symbol (3).
 */
type MentionKind = 0 | 1 | 2 | 3;

const MENTION_KIND_WEIGHT: Record<MentionKind, number> = {
  0: MENTION_WEIGHT,
  1: MENTION_WEIGHT,
  2: PATH_MENTION_WEIGHT,
  3: SYMBOL_MENTION_WEIGHT,
};

function mentionEvidence(kind: MentionKind, label: string): string {
  if (kind === 2) return `mentions path '${label}'`;
  if (kind === 3) return `mentions symbol '${label}'`;
  return `mentions '${label}'`;
}

interface MentionPattern {
  targetId: string;
  /** Lowercased text to find. */
  needle: string;
  /** Original-case text for the evidence string. */
  label: string;
  kind: MentionKind;
  /** Path needles get stricter boundary checks (see pathBoundaryOk). */
  boundary: 'word' | 'path';
  /** First [a-z0-9_] run in the needle, and where it starts. */
  anchor: string;
  anchorOffset: number;
  /** Only for needles with no word characters at all. */
  rx?: RegExp;
}

const WORD_CHAR = /[a-z0-9_]/;
const WORD_RUN = /[a-z0-9_]+/g;

/**
 * Identifier shapes worth mention-matching: camelCase with ≥2 humps or
 * snake_case with ≥2 parts. Single-word symbols (`Index`, `main`, `run`)
 * lowercase into common English words and would glue unrelated documents.
 */
const CAMEL_SYMBOL = /^[A-Za-z][a-z0-9]*(?:[A-Z][A-Za-z0-9]*)+$/;
const SNAKE_SYMBOL = /^[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+$/;
const MIN_SYMBOL_LEN = 6;

function isLinkableSymbol(symbol: string): boolean {
  if (symbol.length < MIN_SYMBOL_LEN) return false;
  return CAMEL_SYMBOL.test(symbol) || SNAKE_SYMBOL.test(symbol);
}

/** Sentinel owner id for needles shared by multiple documents. */
const AMBIGUOUS_NEEDLE = '';

function buildMentionPatterns(
  docs: ReferenceDocInput[],
  minTitleLen: number,
): MentionPattern[] {
  const patterns: MentionPattern[] = [];
  const push = (targetId: string, raw: string, kind: MentionKind): void => {
    const needle = raw.toLowerCase();
    const boundary: 'word' | 'path' = kind === 2 ? 'path' : 'word';
    const anchorMatch = /[a-z0-9_]+/.exec(needle);
    patterns.push(
      anchorMatch
        ? {
            targetId,
            needle,
            label: raw,
            kind,
            boundary,
            anchor: anchorMatch[0],
            anchorOffset: anchorMatch.index,
          }
        : // No word characters to anchor on (e.g. "-----"); rare enough to
          // scan with the original regex instead of indexing.
          { targetId, needle, label: raw, kind, boundary, anchor: '', anchorOffset: 0, rx: mentionRegex(needle) },
    );
  };

  // A needle claimed by more than one document is not a unique identifier:
  // on a folder drop, several unrelated `util.ts` / `README.md` files share a
  // basename (and the titles derived from it), so a body-text mention of that
  // name says nothing about WHICH file is meant. Those needles are dropped
  // entirely rather than fanned out across the tree; unique titles,
  // filenames, path suffixes, and defined symbols still mention-match.
  const needleOwner = new Map<string, string>();
  const claim = (targetId: string, raw: string): void => {
    const needle = raw.toLowerCase();
    const owner = needleOwner.get(needle);
    if (owner === undefined) needleOwner.set(needle, targetId);
    else if (owner !== targetId) needleOwner.set(needle, AMBIGUOUS_NEEDLE);
  };
  const forEachNeedle = (visit: (targetId: string, raw: string, kind: MentionKind) => void): void => {
    for (const target of docs) {
      const title = target.title.trim();
      if (title.length >= minTitleLen) visit(target.id, title, 0);
      const fileName = target.fileName.trim();
      if (fileName.length >= minTitleLen && fileName.toLowerCase() !== title.toLowerCase()) {
        visit(target.id, fileName, 1);
      }
      // Multi-segment path suffixes: `docs/notes.md` says "see
      // src/auth/util.ts" — the directory disambiguates same-name files
      // that the bare-filename rule above must drop as ambiguous. The
      // extensionless variant catches prose like `src/pipeline/links`.
      const path = posixNormalize(target.path ?? '').replace(/^\//, '');
      if (path.includes('/')) {
        const segments = path.split('/');
        for (let i = 0; i < segments.length - 1; i += 1) {
          const suffix = segments.slice(i).join('/');
          if (suffix.length >= minTitleLen) visit(target.id, suffix, 2);
          const stemmed = stripKnownExtension(suffix);
          if (stemmed !== suffix && stemmed.includes('/') && stemmed.length >= minTitleLen) {
            visit(target.id, stemmed, 2);
          }
        }
      }
      // Symbols DEFINED here: prose naming `DropZone` or `refresh_token_flow`
      // connects to the one file that defines it (cross-type docs↔code).
      for (const symbol of target.codeSymbols ?? []) {
        if (isLinkableSymbol(symbol)) visit(target.id, symbol, 3);
      }
    }
  };
  forEachNeedle(claim);
  forEachNeedle((targetId, raw, kind) => {
    if (needleOwner.get(raw.toLowerCase()) === AMBIGUOUS_NEEDLE) return;
    push(targetId, raw, kind);
  });
  return patterns;
}

/**
 * Boundary rule for path needles, stricter than the word-char lookarounds:
 * a suffix of a LONGER path (`vendor/src/auth/util.ts` when the needle is
 * `src/auth/util.ts`) names a different file, so a preceding `/` is only
 * legal for relative prefixes (`./`, `../`) or a leading `/`. Trailing
 * `.`/`-`/`/` continuing into more word characters (`links.md` vs the
 * extensionless needle `…/links`) also rejects the match.
 */
function pathBoundaryOk(textLower: string, start: number, end: number): boolean {
  const before = start > 0 ? textLower[start - 1] : '';
  if (before) {
    if (WORD_CHAR.test(before) || before === '.' || before === '-') return false;
    if (before === '/') {
      const before2 = start > 1 ? textLower[start - 2] : '';
      if (before2 !== '' && before2 !== '.') return false;
    }
  }
  const after = end < textLower.length ? textLower[end] : '';
  if (after) {
    if (WORD_CHAR.test(after)) return false;
    if (
      (after === '.' || after === '-' || after === '/') &&
      end + 1 < textLower.length &&
      WORD_CHAR.test(textLower[end + 1])
    ) {
      return false;
    }
  }
  return true;
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
      if (pattern.boundary === 'path') {
        if (!pathBoundaryOk(textLower, start, end)) continue;
      } else {
        if (start > 0 && WORD_CHAR.test(textLower[start - 1])) continue;
        if (end < textLower.length && WORD_CHAR.test(textLower[end])) continue;
      }
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
  // index docs by lowercased filename basename, stem (no extension), title,
  // and path
  const byFileName = new Map<string, ReferenceDocInput[]>();
  const byStem = new Map<string, ReferenceDocInput[]>();
  const byTitle = new Map<string, ReferenceDocInput[]>();
  const byPath = new Map<string, ReferenceDocInput[]>();
  const indexPush = (map: Map<string, ReferenceDocInput[]>, key: string, doc: ReferenceDocInput): void => {
    if (!key) return;
    let list = map.get(key);
    if (!list) {
      list = [];
      map.set(key, list);
    }
    list.push(doc);
  };
  for (const doc of docs) {
    const fileKey = normalizeLinkTarget(doc.fileName);
    indexPush(byFileName, fileKey, doc);
    indexPush(byStem, stripKnownExtension(fileKey), doc);
    indexPush(byTitle, doc.title.trim().toLowerCase(), doc);
    const pathKey = posixNormalize(doc.path ?? '').toLowerCase();
    if (pathKey) indexPush(byPath, pathKey, doc);
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

  const matchesFor = (target: string, from: ReferenceDocInput): ReferenceDocInput[] => {
    const found: ReferenceDocInput[] = [];
    const seen = new Set<string>();
    const take = (hits: ReferenceDocInput[] | undefined): void => {
      if (!hits) return;
      for (const hit of hits) {
        if (seen.has(hit.id)) continue;
        seen.add(hit.id);
        found.push(hit);
      }
    };
    if (target.startsWith(WIKILINK_PREFIX)) {
      // Wikilinks name a note by title or filename stem across the whole
      // corpus (Obsidian semantics) — path-authoritative resolution does not
      // apply. A name claimed by several documents is ambiguous and drops.
      let wiki = target.slice(WIKILINK_PREFIX.length).trim();
      const wikiHash = wiki.indexOf('#');
      if (wikiHash >= 0) wiki = wiki.slice(0, wikiHash).trim();
      if (!wiki) return found;
      for (const candidate of importPathCandidates(from.path, wiki)) {
        take(byPath.get(candidate));
      }
      if (found.length > 0) return found;
      const takeUnique = (hits: ReferenceDocInput[] | undefined): void => {
        if (hits && hits.length === 1) take(hits);
      };
      const wikiBase = normalizeLinkTarget(wiki);
      takeUnique(byFileName.get(wikiBase));
      if (found.length > 0) return found;
      takeUnique(byTitle.get(wiki.toLowerCase()));
      if (found.length > 0) return found;
      takeUnique(byStem.get(stripKnownExtension(wikiBase)));
      return found;
    }
    for (const candidate of importPathCandidates(from.path, target)) {
      take(byPath.get(candidate));
    }
    // Path-aware resolution is authoritative whenever the importing doc has a
    // known path: a specifier from a real source file resolves against that
    // file's location, and a miss means the target isn't in the corpus — not
    // that it's fair game for a same-name file elsewhere in the tree. Name/stem
    // fallback only makes sense for markdown-only drops with no path metadata.
    if (from.path) return found;
    const spec = target.trim();
    const base = normalizeLinkTarget(target);
    take(byFileName.get(base));
    // Extensionless stem matching is a guess; keep it for bare names only so
    // module paths (`net/http`, `@scope/pkg`) don't attach to arbitrary files
    // sharing their last segment.
    if (!spec.replace(/^(?:\.\/)+/, '').includes('/')) {
      take(byStem.get(stripKnownExtension(base)));
    }
    return found;
  };

  // 1) explicit md / import / wikilink targets -> another doc
  for (const doc of docs) {
    for (const target of doc.mdLinkTargets) {
      if (isExternalUrl(target)) continue; // external web links aren't doc refs
      for (const other of matchesFor(target, doc)) {
        addRef(doc.id, other.id, LINK_WEIGHT, `links to '${other.fileName}'`);
      }
    }
  }

  // 1b) test↔source companions by naming convention. Import edges already
  // cover tests that import their subject; this catches the layouts that
  // don't (Go same-package tests, `tests/test_foo.py` trees, C, Java).
  for (const doc of docs) {
    const subject = testSubjectOf(doc.fileName);
    if (!subject) continue;
    const candidates = (byStem.get(subject.stem) ?? []).filter(
      (c) =>
        c.id !== doc.id &&
        subject.exts.has(fileExtOf(c.fileName)) &&
        testSubjectOf(c.fileName) === null,
    );
    if (candidates.length === 0) continue;
    const testDir = docDirOf(doc);
    const sameDir = candidates.filter((c) => docDirOf(c) === testDir);
    let chosen: ReferenceDocInput[];
    if (sameDir.length > 0) {
      chosen = sameDir;
    } else {
      // Mirrored trees (`tests/pipeline/…` ↔ `src/pipeline/…`): prefer the
      // candidate sharing the most trailing directory segments. A tie means
      // the subject is ambiguous — drop rather than guess.
      let best = -1;
      let winners: ReferenceDocInput[] = [];
      for (const c of candidates) {
        const score = sharedTrailingSegments(testDir, docDirOf(c));
        if (score > best) {
          best = score;
          winners = [c];
        } else if (score === best) {
          winners.push(c);
        }
      }
      chosen = winners.length === 1 ? winners : [];
    }
    for (const c of chosen) {
      addRef(doc.id, c.id, TEST_COMPANION_WEIGHT, `test file for '${c.fileName}'`);
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
      addRef(
        docId,
        target.id,
        MENTION_KIND_WEIGHT[pattern.kind],
        mentionEvidence(pattern.kind, pattern.label),
      );
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

// ---------------------------------------------------------------------------
// test↔source naming conventions
// ---------------------------------------------------------------------------

const JS_SOURCE_EXTS = new Set(['ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs', 'vue', 'svelte']);
const PY_SOURCE_EXTS = new Set(['py', 'pyi']);
const C_SOURCE_EXTS = new Set(['c', 'cc', 'cpp', 'cxx', 'h', 'hh', 'hpp', 'hxx']);
const JVM_SOURCE_EXTS = new Set(['java', 'kt', 'kts', 'scala']);

interface TestSubject {
  /** Lowercased stem of the file under test (`links` for `links.test.ts`). */
  stem: string;
  /** Extensions a matching source file may carry. */
  exts: Set<string>;
}

/**
 * If `fileName` follows a test-file naming convention, the stem of the file
 * it exercises; null for non-test files. Exported for unit tests.
 */
export function testSubjectOf(fileName: string): TestSubject | null {
  const base = posixBasename(fileName.trim());
  const lower = base.toLowerCase();
  let m = /^(.+)\.(?:test|spec)\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.exec(lower);
  if (m) return { stem: m[1], exts: JS_SOURCE_EXTS };
  m = /^(.+)_test\.go$/.exec(lower);
  if (m) return { stem: m[1], exts: new Set(['go']) };
  m = /^test_(.+)\.py$/.exec(lower) ?? /^(.+)_tests?\.py$/.exec(lower);
  if (m) return { stem: m[1], exts: PY_SOURCE_EXTS };
  m = /^(.+)_(?:spec|test)\.rb$/.exec(lower);
  if (m) return { stem: m[1], exts: new Set(['rb']) };
  m = /^(.+)_test\.(?:c|cc|cpp|cxx)$/.exec(lower) ?? /^test_(.+)\.(?:c|cc|cpp|cxx)$/.exec(lower);
  if (m) return { stem: m[1], exts: C_SOURCE_EXTS };
  // Case-sensitive on purpose: `FooTest.java` is a test of Foo, while
  // `contest.java` is not a test of `con`.
  const jvm = /^(.+)Tests?\.(?:java|kt|kts|scala)$/.exec(base);
  if (jvm) return { stem: jvm[1].toLowerCase(), exts: JVM_SOURCE_EXTS };
  return null;
}

function fileExtOf(fileName: string): string {
  const base = posixBasename(fileName).toLowerCase();
  const dot = base.lastIndexOf('.');
  return dot >= 0 ? base.slice(dot + 1) : '';
}

function docDirOf(doc: ReferenceDocInput): string {
  return posixDirname(posixNormalize(doc.path ?? doc.fileName)).toLowerCase();
}

function sharedTrailingSegments(a: string, b: string): number {
  const as = a ? a.split('/') : [];
  const bs = b ? b.split('/') : [];
  let n = 0;
  while (n < as.length && n < bs.length && as[as.length - 1 - n] === bs[bs.length - 1 - n]) {
    n += 1;
  }
  return n;
}

/**
 * Paths to look up for an import / markdown href. Relative specifiers resolve
 * against the importing file; extensionless names expand to common source
 * suffixes and directory index files.
 */
export function importPathCandidates(fromPath: string | undefined, specifier: string): string[] {
  let spec = specifier.trim();
  if (!spec || isExternalUrl(spec)) return [];
  // Markdown hrefs may carry a #fragment / ?query; only the document path
  // resolves. A pure in-page link (`#section`) targets the linking document
  // itself and yields no candidates.
  const hash = spec.indexOf('#');
  if (hash >= 0) spec = spec.slice(0, hash);
  const query = spec.indexOf('?');
  if (query >= 0) spec = spec.slice(0, query);
  spec = spec.trim();
  if (!spec) return [];
  const roots: string[] = [];
  const relative = spec.startsWith('.') || spec.startsWith('/');
  if (relative && fromPath) roots.push(posixResolveFrom(fromPath, spec));
  else if (!relative) {
    roots.push(posixNormalize(spec).replace(/^\//, ''));
    // A slashless bare specifier still resolves against the linking file's
    // directory when it names an explicit file (`guide.md`, `util.h`) —
    // markdown hrefs and C includes are sibling-relative without `./`. Bare
    // module names (`os`, `react`) stay root-only so language imports don't
    // attach to whatever file shares their stem.
    if (fromPath && (spec.includes('/') || posixBasename(spec).includes('.'))) {
      roots.push(posixResolveFrom(fromPath, spec));
    }
  }
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (path: string): void => {
    const key = path.toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(key);
  };
  for (const root of roots) {
    if (!root) continue;
    add(root);
    const base = posixBasename(root);
    if (!base.includes('.')) {
      for (const ext of RESOLVE_EXTENSIONS) add(`${root}${ext}`);
      for (const index of INDEX_BASENAMES) add(posixJoin(root, index));
    }
  }
  return out;
}

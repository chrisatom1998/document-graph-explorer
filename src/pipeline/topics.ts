/**
 * Topic grouping (spec §5.4 refinement). Turns each document's raw topic
 * labels — whether AI-enriched or the TF-IDF fallback — into the shared
 * topic groups that become topic-hub nodes.
 *
 * Two problems this fixes over the old "exact lowercased string" match:
 *  1. Label variants fragment a topic into several hubs — "Kubernetes",
 *     "kubernetes", "index mappings" vs "index-mappings". Canonicalization
 *     folds case / separator / whitespace variants together.
 *  2. Plurals ("API" vs "APIs") fragment too, but naive stemming false-merges
 *     proper nouns ("Kubernetes" -> "kubernete"). So a trailing-'s' plural is
 *     coalesced ONLY when its singular already exists as a topic in the
 *     corpus — a merge we can prove is safe, never a guess.
 *  3. A topic carried by most of the corpus is noise, not structure — it drags
 *     unrelated clusters together. `maxDocFraction` drops those.
 *
 * PURE — runs in the coordinator and is unit-tested directly.
 */

/**
 * Fold a raw topic label to its comparison key: lowercase, and collapse
 * separators (whitespace, / \ _ - ,) to single spaces. Intra-token symbols
 * like +, #, . survive so "C++", "C#" and ".NET" stay distinct.
 */
export function canonicalizeTopic(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[\s/\\_,-]+/g, ' ')
    .trim();
}

/**
 * TF-IDF also ranks bylines and ticket prefixes highly. Keep its full keyword
 * list for retrieval, but require title evidence or a repeated phrase before
 * presenting a term as a topic. Prefer complete phrases over their fragments.
 */
export function selectFallbackTopics(keywords: string[], title: string, limit = 5): string[] {
  const titleKey = canonicalizeTopic(title.replace(/\b[\p{L}]+[-_]\d+\b/gu, ' '))
    .replace(/[^\p{L}\p{N}+#. ]/gu, ' ')
    .replace(/\s+/g, ' ');
  const titleWords = new Set(titleKey.split(' '));
  const seen = new Set<string>();
  const candidates = keywords.flatMap((label, index) => {
    const key = canonicalizeTopic(label);
    if (!key || seen.has(key)) return [];
    seen.add(key);
    const phrase = key.includes(' ');
    const inTitle = phrase ? ` ${titleKey} `.includes(` ${key} `) : titleWords.has(key);
    if (!phrase && !inTitle) return [];
    return [{ label, key, inTitle, index }];
  });
  // A phrase and its component words convey the same concept in the topic
  // list; removing the fragments makes room for another useful subject.
  const distinct = candidates.filter(({ key }) => !candidates.some((other) =>
    other.key !== key && ` ${other.key} `.includes(` ${key} `),
  ));
  distinct.sort((a, b) => Number(b.inTitle) - Number(a.inTitle) || a.index - b.index);
  return distinct.slice(0, Math.max(0, limit)).map(({ label }) => label);
}

/** Trimmed, whitespace-collapsed original label (keeps its casing for display). */
function displayForm(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

export interface TopicGroup {
  /** canonical key; becomes the `topic:<key>` hub id */
  key: string;
  /** best original-cased label for display */
  label: string;
  /** ids of documents carrying this topic, sorted for stable edge ids */
  docIds: string[];
}

interface Accum {
  docs: Set<string>;
  inferred: boolean;
  titleSupported: boolean;
  /** original label -> occurrence count, for choosing the display form */
  labels: Map<string, number>;
}

/**
 * Group documents' topics into hub candidates.
 *
 * @param docs each document's id and its raw topic labels
 * @param params.minDocs      minimum documents sharing a topic to form a hub
 * @param params.maxDocFraction  drop topics carried by more than this fraction
 *                                of the corpus (ubiquity cap)
 */
export function groupTopics(
  docs: { id: string; topics: string[]; title?: string; topicsSource?: string }[],
  params: { minDocs: number; maxDocFraction: number },
): TopicGroup[] {
  const total = docs.length;
  const map = new Map<string, Accum>();

  for (const doc of docs) {
    // A doc listing the same topic twice (case variants) must count once.
    const countedKeys = new Set<string>();
    for (const raw of doc.topics ?? []) {
      const key = canonicalizeTopic(raw);
      if (!key) continue;
      let acc = map.get(key);
      if (!acc) {
        acc = { docs: new Set(), labels: new Map(), inferred: true, titleSupported: false };
        map.set(key, acc);
      }
      acc.docs.add(doc.id);
      acc.inferred &&= doc.topicsSource === 'tfidf';
      const title = canonicalizeTopic(doc.title ?? '').replace(/[^\p{L}\p{N}+#. ]/gu, ' ').replace(/\s+/g, ' ');
      acc.titleSupported ||= ` ${title} `.includes(` ${key} `);
      const label = displayForm(raw);
      acc.labels.set(label, (acc.labels.get(label) ?? 0) + 1);
      countedKeys.add(key);
    }
  }

  // Plural coalescing: fold "<base>s" into "<base>" when the singular exists.
  // Deterministic key order; single trailing-'s' only, so it never chains.
  for (const key of [...map.keys()].sort()) {
    if (!key.endsWith('s')) continue;
    const base = key.slice(0, -1);
    if (base.length < 2) continue;
    const target = map.get(base);
    const src = map.get(key);
    if (!target || !src || target === src) continue;
    for (const d of src.docs) target.docs.add(d);
    target.inferred &&= src.inferred;
    target.titleSupported ||= src.titleSupported;
    for (const [l, c] of src.labels) {
      target.labels.set(l, (target.labels.get(l) ?? 0) + c);
    }
    map.delete(key);
  }

  // Ubiquity cap: never below minDocs, so a fully-shared topic in a tiny
  // corpus still forms (the whole point of a 2-doc corpus), while a topic in
  // most of a large corpus is dropped as noise.
  const maxDocs = Math.max(params.minDocs, Math.ceil(params.maxDocFraction * total));

  const groups: TopicGroup[] = [];
  for (const [key, acc] of map) {
    const size = acc.docs.size;
    if (size < params.minDocs || size > maxDocs) continue;
    // Repeated body phrases can be incidental. Inferred labels without title
    // evidence need a third source; explicit/AI labels and tiny corpora keep
    // the existing two-document behavior.
    if (acc.inferred && !acc.titleSupported && size < Math.min(total, Math.max(3, params.minDocs))) continue;
    // display label: most frequent, tie-break shortest then lexicographic
    let best = key;
    let bestCount = -1;
    for (const [label, count] of acc.labels) {
      if (
        count > bestCount ||
        (count === bestCount &&
          (label.length < best.length ||
            (label.length === best.length && label < best)))
      ) {
        best = label;
        bestCount = count;
      }
    }
    groups.push({ key, label: best, docIds: [...acc.docs].sort() });
  }

  groups.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return groups;
}

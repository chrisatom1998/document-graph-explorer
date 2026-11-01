export interface LearnedIndex {
  version: number;
  encoder: string;
  revision: string;
  examples?: unknown[];
  heads?: unknown[];
  neighbours?: { k: number; background: string; heads: string[] };
}

interface SplitLearnedIndex {
  version: number;
  encoder: string;
  revision: string;
  examples?: unknown[];
  heads: string[];
  neighbours?: { k: number; background: string; heads: string[] };
}

/** A split index lists head slugs. A monolithic learned.json lists head objects. */
export function isSplitLearnedIndex(raw: unknown): raw is SplitLearnedIndex {
  if (!raw || typeof raw !== 'object') return false;
  const heads = (raw as { heads?: unknown }).heads;
  return Array.isArray(heads) && heads.every(head => typeof head === 'string');
}

/** Rebuild the object ``sanitizeLearnedDjModel`` expects. ``linear`` and ``neighbours`` are keyed by slug. */
export function assembleLearnedModel(index: unknown, linear: Record<string, unknown> = {}, neighbourFiles: Record<string, unknown> = {}): unknown {
  if (!isSplitLearnedIndex(index)) return index;
  const heads = index.heads.map(slug => {
    const head = linear[slug];
    if (!head) throw new Error(`Missing learned head ${slug}`);
    return head;
  });
  let neighbours: { k: number; background: string; heads: unknown[] } | undefined;
  if (index.neighbours) {
    const background = neighbourFiles[index.neighbours.background] as { background?: unknown } | undefined;
    if (!background || typeof background.background !== 'string') throw new Error('Missing neighbour background');
    neighbours = {
      k: index.neighbours.k,
      background: background.background,
      heads: index.neighbours.heads.map(slug => {
        const head = neighbourFiles[slug];
        if (!head) throw new Error(`Missing neighbour head ${slug}`);
        return head;
      }),
    };
  }
  return {
    version: index.version,
    encoder: index.encoder,
    revision: index.revision,
    examples: index.examples ?? [],
    heads,
    ...(neighbours ? { neighbours } : {}),
  };
}

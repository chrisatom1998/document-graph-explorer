export interface SampleQuery {
  terms: string[];
  exclude: string[];
  minBpm: number | null;
  maxBpm: number | null;
  maxSeconds: number | null;
  key: string | null;
  confirmedOnly: boolean;
  similar: boolean;
  clarification: string | null;
}
export const EMPTY_SAMPLE_QUERY: SampleQuery = {
  terms: [], exclude: [], minBpm: null, maxBpm: null, maxSeconds: null,
  key: null, confirmedOnly: false, similar: false, clarification: null,
};

/** Validate at both the model boundary and browser boundary. Never silently drop a filter. */
export function parseSampleQuery(raw: unknown): SampleQuery {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid search instructions. Try a simpler request.');
  const p = raw as Record<string, unknown>;
  for (const k of ['terms', 'exclude']) {
    if (!Array.isArray(p[k]) || p[k].length > 10 || p[k].some(v => typeof v !== 'string' || !v.trim() || v.length > 100)) throw new Error('Invalid search terms.');
  }
  for (const k of ['minBpm', 'maxBpm', 'maxSeconds']) {
    const value = p[k];
    if (value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > (k === 'maxSeconds' ? 86400 : 300))) throw new Error('Invalid search range.');
  }
  if (typeof p.confirmedOnly !== 'boolean' || typeof p.similar !== 'boolean') throw new Error('Invalid search options.');
  if (p.key !== null && (typeof p.key !== 'string' || !/^[A-G](?:#|b|♯|♭)? (?:major|minor)$/.test(p.key))) throw new Error('Invalid musical key.');
  if (p.clarification !== null && (typeof p.clarification !== 'string' || p.clarification.length > 500)) throw new Error('Invalid clarification.');
  if (p.minBpm !== null && p.maxBpm !== null && Number(p.minBpm) > Number(p.maxBpm)) throw new Error('Minimum BPM must not exceed maximum BPM.');
  return Object.fromEntries(Object.keys(EMPTY_SAMPLE_QUERY).map(k => [k, p[k]])) as unknown as SampleQuery;
}

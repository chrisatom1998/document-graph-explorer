/**
 * Spelling variants of the same name, so "Postgres" and "PostgreSQL" (or
 * `dependency_groups` and "Dependency Groups") count as one term when docs are
 * linked and searched.
 *
 * Two layers:
 * - ALIASES: a short hand-checked list of names that are written several
 *   ways but mean exactly one thing. Only unambiguous spellings belong here
 *   ('pg' or 'elastic' alone mean other things too, so they are left out).
 * - entityKey: folds the casing, separators and plural of an identifier or
 *   capitalized phrase, so the same name in camelCase, snake_case and prose
 *   shares one key. Acronyms keep their exact case ('IT' is not 'it').
 *
 * PURE — used by the pipeline worker, the aggregator worker and search.
 */

/** Lowercase variant -> lowercase canonical spelling. */
const ALIASES: Readonly<Record<string, string>> = {
  postgresql: 'postgres',
  pgsql: 'postgres',
  k8s: 'kubernetes',
  otel: 'opentelemetry',
  i18n: 'internationalization',
  l10n: 'localization',
  a11y: 'accessibility',
};

/** Canonical spelling of one lowercase token ('postgresql' -> 'postgres'). */
export function canonicalTerm(token: string): string {
  return ALIASES[token] ?? token;
}

const variantsByCanonical = new Map<string, string[]>();
for (const [variant, canonical] of Object.entries(ALIASES)) {
  const list = variantsByCanonical.get(canonical) ?? [canonical];
  list.push(variant);
  variantsByCanonical.set(canonical, list);
}

/** Every spelling of a lowercase term, itself first ('postgres' -> postgres, postgresql, pgsql). */
export function termVariants(term: string): string[] {
  const all = variantsByCanonical.get(canonicalTerm(term));
  if (!all) return [term];
  return [term, ...all.filter((v) => v !== term)];
}

const ACRONYM_ONLY = /^[A-Z0-9]+$/;

function singular(word: string): string {
  return word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word;
}

/**
 * One key for every spelling of an entity: 'AuthService', 'auth_service' and
 * 'Auth Service' -> 'authservice'; 'TypeVarTuples' -> 'typevartuple';
 * 'PostgreSQL' -> 'postgres'. All-caps acronyms are returned unchanged.
 */
export function entityKey(entity: string): string {
  if (ACRONYM_ONLY.test(entity)) return entity;
  const words = entity
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[\s_]+/)
    .filter((w) => w.length > 0);
  if (words.length === 0) return entity;
  words[words.length - 1] = singular(words[words.length - 1]!);
  const joined = words.join('');
  return canonicalTerm(joined);
}

/**
 * The other spellings of a phrase, one aliased word swapped at a time:
 * 'Postgres Upgrade Plan' -> ['postgresql upgrade plan', 'pgsql upgrade plan'].
 * Lowercase; empty when no word has a known variant.
 */
export function phraseRespellings(phrase: string): string[] {
  const lower = phrase.toLowerCase();
  const out: string[] = [];
  for (const match of lower.matchAll(/[\p{L}\p{N}]+/gu)) {
    const word = match[0];
    const start = match.index ?? 0;
    for (const variant of termVariants(word).slice(1)) {
      out.push(lower.slice(0, start) + variant + lower.slice(start + word.length));
    }
  }
  return out;
}

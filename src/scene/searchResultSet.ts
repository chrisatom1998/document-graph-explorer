/** Reuse membership lookups while the store retains the same results array. */
export function createSearchResultSetCache() {
  let previous: readonly string[] | null = null;
  let ids: ReadonlySet<string> | null = null;
  return (results: readonly string[] | null): ReadonlySet<string> | null => {
    if (results !== previous) {
      previous = results;
      ids = results === null ? null : new Set(results);
    }
    return ids;
  };
}

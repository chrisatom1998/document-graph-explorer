To ensure developer productivity, we cache build outputs in our build runners.

## Implementation
- Cache directories include npm cache, NextJS build cache, and Vitest test caches.
- Invalidations are triggered when lockfiles change.

See also:
- [Monorepo Configuration](monorepo-config.md)
- [GitHub Actions](github-actions.md)
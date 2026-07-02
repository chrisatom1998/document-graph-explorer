To ensure developer productivity, we cache build outputs in our build runners.

## Implementation
- Cache directories include npm cache, NextJS build cache, and Vitest test caches.
- Invalidations are triggered when lockfiles change.
- Build runners are configured in [GitHub Actions](github-actions.md) workflows.

## How It Works
Our [Monorepo Configuration](monorepo-config.md) defines workspace boundaries. Each
workspace gets its own cache key derived from its lockfile hash. The CI pipeline
(see [GitHub Actions](github-actions.md)) restores caches before `npm install` and
saves updated caches after successful builds.

For production builds, the [Bundle Optimization](bundle-optimization.md) step runs
after caching to ensure tree-shaking and code-splitting are applied.

## Debugging Cache Misses
If builds are unexpectedly slow:
1. Check if a lockfile changed upstream (e.g. a dependency audit — see
   [Dependency Auditing](dependency-auditing.md)).
2. Verify the cache key in the CI logs matches the expected hash.
3. Consider clearing the [Docker Best Practices](docker-best-practices.md) layer
   cache if Docker builds are involved.

See also:
- [Web Performance](web-performance.md)
- [NextJS SSR](nextjs-ssr.md)
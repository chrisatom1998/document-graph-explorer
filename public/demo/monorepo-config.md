We manage our UI apps and shared components in a single monorepo using Turborepo.

## Task Graph
Turborepo leverages caching.
- `npm run build` depends on `^build` outputs of packages.
- Shared caches are pushed to GitHub Actions to speed up pull request runs.

See also:
- [GitHub Actions](github-actions.md)
- [Package Registry](package-registry.md)
All continuous integration (CI) workflows are managed via GitHub Actions.

## Pipelines
- **Lint and Format**: Runs ESLint, Prettier, and TypeScript compiler checks on pull requests.
- **Unit Tests**: Runs Vitest test suites.
- **Docker Build**: Builds and pushes Docker images to AWS ECR.

## Build Caching
We cache `node_modules` and build runners to speed up workflow executions.
See also:
- [Linting and Formatting](linting-rules.md)
- [Docker Best Practices](docker-best-practices.md)
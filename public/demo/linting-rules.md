Code quality is enforced using ESLint and Prettier. This prevents stylistic debates during code reviews.

## Configuration
Rules are declared in `.eslintrc.json`.
- We require explicit typescript types on public functions.
- Warnings are treated as compilation failures in CI.
- Git hooks (Husky) auto-run Prettier formatting before commits are created.

See also:
- [GitHub Actions](github-actions.md)
- [Git Branching Model](git-branching.md)
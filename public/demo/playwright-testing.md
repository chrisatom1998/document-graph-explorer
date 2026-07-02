End-to-End (E2E) testing protects critical user flows from regressions. We run Playwright tests in our CI pipeline.

## Writing E2E Tests
- Locators should prioritize user-facing traits (e.g. `page.getByRole('button', { name: 'Submit' })`).
- Mock third-party APIs (such as Stripe payment flows) to avoid network dependencies.
- Ensure test files clean up database seeding scripts upon completion.

See also:
- [GitHub Actions](github-actions.md)
- [Stripe Integration](stripe-integration.md)
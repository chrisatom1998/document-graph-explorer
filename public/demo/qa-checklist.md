Before any major deployment, support and QA teams perform manual validation.

## Checks
- Verify SSO login works (see [SSO Okta Setup](sso-okta-setup.md)).
- Verify payment upgrades complete without errors ([Stripe Payment Integration](stripe-integration.md)).
- Test responsive layouts on mobile devices ([Browser Compatibility](browser-compat.md)).
- Review error logs for exceptions ([Grafana Dashboards](grafana-dashboards.md)).
- Run the [Playwright Testing](playwright-testing.md) suite for regression coverage.
- Confirm [Feature Flags](feature-flags.md) are configured correctly for the release.

## Before Deploying
Walk through the [Deploy Guide](deploy-guide.md) checklist and confirm the
[Rollback Strategies](rollback-strategies.md) are ready if anything goes wrong.

See also:
- [Accessibility Checklist](accessibility-checklist.md)
- [Release Process](release-process.txt)
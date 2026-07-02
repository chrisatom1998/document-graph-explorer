Feature flags allow us to separate code deployments from feature releases. We use LaunchDarkly.

## Guidelines
- **Naming**: Use camelCase for flags (e.g. `enableNewBillingPage`).
- **Overrides**: Developers can override flag states locally in the browser console.
- **Cleanup**: Flags must be removed from the code within 30 days after a feature has shipped to 100% of users.

See also:
- [Deploy Guide](deploy-guide.md)
- [Local Development Setup](local-dev-env.md)
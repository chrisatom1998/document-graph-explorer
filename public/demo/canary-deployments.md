To minimize impact of software bugs, new versions are deployed using canary deployments.

## Execution
- Shift 2% of user traffic to the new version.
- Monitor logs and error rates for 10 minutes.
- If errors spike, trigger automatic rollback.
- If stable, ramp traffic up to 100%.

See also:
- [Deploy Guide](deploy-guide.md)
- [Rollback Strategies](rollback-strategies.md)
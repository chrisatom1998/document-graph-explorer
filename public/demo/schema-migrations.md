All PostgreSQL database schemas are modified using explicit, version-controlled migration scripts. We use SQL-based migrations and enforce zero-downtime rules.

## Zero-Downtime Requirements
1. **Never drop columns**: Mark columns as deprecated, then drop them in a subsequent release once code references are deleted.
2. **Add columns as nullable**: Or provide default values to prevent queries failing during rolling updates.
3. **Use concurrent indexes**: Creating indexes locks tables unless the `CONCURRENTLY` keyword is used.

See also:
- [Postgres Operations](postgres-operations.md)
- [Deploy Guide](deploy-guide.md)
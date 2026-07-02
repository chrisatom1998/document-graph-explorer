When a release triggers alerts, a rollback must be executed. This guide describes the mechanics.

## Action Steps
1. Run rollback commands in the CI console.
2. The load balancer shifts traffic back to the previous image.
3. If database migrations have already executed, ensure they are backward-compatible.

See also:
- [Deploy Guide](deploy-guide.md)
- [Schema Migrations](schema-migrations.md)
Nimbus Labs operates a multi-tenant SaaS architecture. Safeguarding data isolation between tenants is our highest priority.

## Isolation Levels
We enforce logical separation:
- Every table has a `tenant_id` column.
- Database access utilizes Row Level Security (RLS) policies in PostgreSQL to restrict queries automatically.

See also:
- [Postgres Operations](postgres-operations.md)
- [Security Review Process](security-review-process.md)
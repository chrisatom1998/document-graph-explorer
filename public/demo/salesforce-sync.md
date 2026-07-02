Customer purchase history and usage patterns must be synced to Salesforce to assist sales representatives.

## Sync Pipeline
We push data updates from PostgreSQL to Salesforce using a scheduled batch job running every 60 minutes.
- API limit usage is tracked.
- Errors are written to a DLQ (Dead Letter Queue) in our PostgreSQL database for support review.

See also:
- [Postgres Operations](postgres-operations.md)
- [Secrets Management](secrets-management.md)
Connecting directly to PostgreSQL is expensive. To support thousands of concurrent client workers, Nimbus Labs routes all DB traffic through PgBouncer connection pools.

## Configuration
PgBouncer is configured in **Transaction Mode**:
- Connections are returned to the pool as soon as a transaction completes, rather than when the client disconnects.
- Avoid using prepared statements in client code, as they are incompatible with transaction-mode pooling.

## Monitoring Pool Metrics
We watch the `avg_wait` time. High wait times indicate the pool is saturated.
See also:
- [Postgres Operations](postgres-operations.md)
- [API Rate Limiting](api-rate-limiting.txt)
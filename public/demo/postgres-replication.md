Our PostgreSQL instance runs in a primary-secondary replication layout to provide load balancing for reads and automated failover capabilities.

## Replication Strategy
- **Primary Node**: Handles all writes, updates, and schema migrations.
- **Read Replicas**: Multiple read-only instances handle analytical queries and GET request operations.
- **Streaming Replication**: Replicas remain in sync asynchronously.

## Monitoring Lag
Replication lag is monitored. If lag exceeds 10MB of WAL data, read operations are routed back to the primary.
See also:
- [Postgres Operations](postgres-operations.md)
- [Database Backups](database-backups.md)
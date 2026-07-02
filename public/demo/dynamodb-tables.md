DynamoDB is preferred for high-throughput, low-latency, unstructured data storage such as audit logs, event logs, and user notifications.

## Single-Table Design
We utilize single-table design principles:
- **Partition Key (PK)**: Partitioned by resource ID or tenant ID.
- **Sort Key (SK)**: Used to query chronological events or hierarchical relationships.

## Local Secondary Indexes (LSI)
LSIs must be planned before table creation, as they cannot be added post-creation.
See also:
- [Audit Logging](audit-logging.md)
- [Secrets Management](secrets-management.md)
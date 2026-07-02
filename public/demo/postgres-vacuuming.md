PostgreSQL utilizes MVCC (Multi-Version Concurrency Control). Deleted or updated rows remain in the table space until vacuumed, which causes performance degradation (bloat).

## Configuration
We configure aggressive auto-vacuum parameters:
- `autovacuum_vacuum_scale_factor = 0.05` (run vacuum after 5% of rows are updated/deleted).
- `autovacuum_analyze_scale_factor = 0.02` (update statistics after 2% of rows change).

## Monitoring
We monitor index bloat weekly. Reindexing is performed during off-peak hours when index size exceeds table size.
See also:
- [Postgres Operations](postgres-operations.md)
- [Database Backups](database-backups.md)
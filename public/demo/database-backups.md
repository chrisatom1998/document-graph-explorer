This policy outlines our backup schedules, replication configurations, and disaster recovery validations for PostgreSQL and other database stores.

## Schedule and Types
- **Continuous Backups**: Write-Ahead Logs (WAL) are shipped to S3 every 60 seconds (WAL-G).
- **Daily Snapshots**: Automated RDS snapshots taken daily at 02:00 UTC, retained for 35 days.
- **Monthly Archives**: Exported to glacier storage and kept for 7 years for compliance.

## Sandbox Verification
Backups are useless if they cannot be restored. We run automated scripts to test restores weekly.
See also:
- [Postgres Operations](postgres-operations.md)
- [S3 Storage Policy](s3-storage.md)
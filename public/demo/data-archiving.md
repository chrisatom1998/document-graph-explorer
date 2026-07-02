To keep PostgreSQL database performance high, we archive historical transactional data that is no longer accessed on a daily basis.

## Archiving Rules
- **Closed Accounts**: Moved to cold storage tables 90 days after closure.
- **Analytics Logs**: Purged from PostgreSQL after 30 days. Analytical data is written directly to Snowflake or ClickHouse instead.

## Accessing Archived Data
Archived databases can be restored in isolated dev environments for audit verification.
See also:
- [Data Retention Policy](data-retention-policy.md)
- [S3 Storage Policy](s3-storage.md)
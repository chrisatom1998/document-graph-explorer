Under GDPR, customers have the Right to be Forgotten (RTBF) and the Right to Access their data. This guide lists the automated tools we run for compliance.

## Right to be Forgotten (RTBF)
When a user requests deletion, a webhook fires, triggering a worker to:
1. Delete their row from the primary PostgreSQL user database.
2. Scramble their ID in log files (anonymization).
3. Wipe user attachments from S3 bucket directories.

## Data Portability
Data export requests bundle customer schemas into JSON files.
See also:
- [Data Retention Policy](data-retention-policy.md)
- [S3 Storage Policy](s3-storage.md)
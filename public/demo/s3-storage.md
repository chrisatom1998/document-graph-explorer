Nimbus Labs uses Amazon S3 for file storage, user uploads, backup dumps, and analytics data. This policy defines standard access and lifecycle rules for our buckets.

## Lifecycle Management
- **Temp / Upload Buckets**: Files are automatically purged after 7 days using S3 Lifecycle Rules.
- **Audit Logs**: Moved to Glacier Deep Archive after 90 days, retained for 7 years.
- **Backups**: Replicated to a secondary AWS region for disaster recovery.

## Encryption and Public Access
All buckets have "Block Public Access" enabled unless explicitly approved for asset hosting. Default KMS encryption is required.
See also:
- [Data Retention Policy](data-retention-policy.md)
- [Database Backups](database-backups.md)
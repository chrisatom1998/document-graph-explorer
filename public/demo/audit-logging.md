We maintain immutable audit logs for all administrative operations performed in AWS, production servers, and internal customer portals.

## Implementation
Audit logs are written to AWS CloudTrail and shipped to a secure, write-once-read-many (WORM) S3 bucket.
- Log deletion is blocked at the bucket policy level.
- Logs include timestamps, user identities, source IPs, and action results.

## Compliance
Audit log integrity is reviewed by third-party auditors during annual SOC2 compliance audits.
See also:
- [S3 Storage Policy](s3-storage.md)
- [SOC2 Compliance](soc2-compliance.md)
Our backup strategy includes an automated verification sandbox that launches isolated environments to restore and validate database backups.

## Verification Protocol
1. Every Sunday, a sandbox container pulls the latest daily database snapshot from S3.
2. The database is spun up in an isolated network segment.
3. A test suite queries basic integrity indicators (record counts, recent schemas).
4. Results are posted to Slack. Failure alerts trigger immediate incident response.

See also:
- [Database Backups](database-backups.md)
- [Incident Runbook](incident-runbook.md)
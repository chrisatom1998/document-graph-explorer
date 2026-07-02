This protocol outlines the immediate operational procedures required if an active security breach, data leak, or unauthorized access is detected.

## Severity Levels
- **P0**: Active database intrusion or compromise of AWS root account credentials.
- **P1**: Leaked API keys or database credentials with restricted permissions.
- **P2**: Accidental exposure of public logs containing non-PII customer metadata.

## Response Steps
1. Quarantine the affected container or rotate leaked keys immediately.
2. Spin up a secure triage channel on Slack.
3. File a detailed incident summary.

See also:
- [Incident Runbook](incident-runbook.md)
- [Post-mortem Guidelines](post-mortem-guide.md)
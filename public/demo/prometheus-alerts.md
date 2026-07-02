Nimbus Labs monitors system health and resource consumption using Prometheus. Alerts are generated based on query thresholds and routed via Alertmanager to Slack and PagerDuty.

## Alerting Thresholds
We track several critical metrics:
- **CPU / Memory saturation**: Triggered if container usage exceeds 90% for more than 5 minutes.
- **API Error Rates**: Triggered if HTTP 5xx responses exceed 1% of total requests over a 2-minute sliding window.
- **Disk Usage**: Triggered if persistent volume claims (PVC) reach 85% capacity.

## Responding to Alerts
When an alert fires, check the corresponding runbook for troubleshooting steps.
See also:
- [Incident Runbook](incident-runbook.md) for paging escalation.
- [Oncall Rotation](oncall-rotation.md) for the active engineer.
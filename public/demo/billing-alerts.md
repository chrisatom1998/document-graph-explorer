Cloud resource utilization costs can expand rapidly if misconfigured. We run daily billing reviews.

## Alerts Setup
AWS Budgets sends warnings when monthly forecasted costs exceed 110% of budget.
- We check [NAT Gateway](nat-gateway.md) transfer logs for high data transfer costs.
- Sandbox databases must spin down automatically when idle.
- [S3 Storage Policy](s3-storage.md) lifecycle rules archive infrequently accessed data.

## Common Cost Drivers
- **Compute**: [Autoscaling Groups](autoscaling-groups.md) that don't scale down.
- **Data transfer**: Cross-AZ traffic through [VPC Configuration](vpc-config.md).
- **Storage**: Unarchived logs in [Elasticsearch Indexing](elasticsearch-indexing.md).
- **Database**: Oversized [Postgres Operations](postgres-operations.md) instances.

## Response Playbook
When an alert fires:
1. Check the [Grafana Dashboards](grafana-dashboards.md) cost panel.
2. Identify the service via [Datadog Tracing](datadog-tracing.md) resource tags.
3. File a cost-reduction ticket and tag `#platform` in Slack.

See also:
- [Terraform Modules](terraform-modules.md) — infrastructure definitions
- [Data Archiving](data-archiving.md) — reducing storage costs
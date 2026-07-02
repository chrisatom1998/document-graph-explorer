Grafana serves as our primary visualization portal for system metrics, request logs, and application performance tracing. Dashboards are stored as JSON in code and versioned.

## Standard Dashboards
Our standard suite includes:
- **EKS Cluster Overview**: Visualizes CPU/memory allocatable capacity, pod counts, and scheduling delays.
- **Database Operations**: Displays active connection pools, read/write IOPS, and PostgreSQL transaction locks.
- **Application Metrics**: Displays HTTP request latency, throughput, and error codes.

## Editing Dashboards
Do not edit dashboards in the UI directly; they will be overwritten by the deployment pipeline. Update the JSON files in the monitoring repo instead.
See also:
- [Prometheus Alerts](prometheus-alerts.md)
- [Postgres Operations](postgres-operations.md)
Certain plans are billed based on consumption metrics (e.g. gigabytes processed, API query counts).

## Ingestion Pipeline
1. Services write usage events to the Kafka Event Bus.
2. A worker aggregates counts every hour and writes summaries to ClickHouse.
3. At the end of the billing cycle, aggregated usage is pushed to Stripe.

See also:
- [Kafka Event Bus](kafka-event-bus.md)
- [ClickHouse Analytics](clickhouse-analytics.md)
- [Stripe Payment Integration](stripe-integration.md)
For high-volume, real-time analytical reporting, Nimbus Labs utilizes ClickHouse, an open-source column-oriented database management system.

## Ingestion Architecture
ClickHouse directly consumes events from our Kafka cluster. This is configured using the ClickHouse Kafka engine table, which feeds a materialized view.

## Performance
Columnar storage allows us to run aggregate queries over billions of rows in milliseconds, which would lock our PostgreSQL databases.
See also:
- [Kafka Event Bus](kafka-event-bus.md)
- [Postgres Operations](postgres-operations.md)
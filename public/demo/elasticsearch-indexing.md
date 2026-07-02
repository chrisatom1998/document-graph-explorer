For fast text searches, auto-completion, and text mining, Nimbus Labs replicates document metadata and text snippets to an Elasticsearch cluster.

## Index Mappings
Indices are structured with custom tokenizers to optimize search terms:
- **Title Field**: Boosted for higher search relevance.
- **Body Field**: Analyzed using standard English stemming filters.

## Data Ingestion
Updates in PostgreSQL are propagated to Elasticsearch asynchronously using Kafka events to avoid write-path blocking.
See also:
- [Kafka Event Bus](kafka-event-bus.md)
- [Postgres Operations](postgres-operations.md)
For metadata relationships, project linking, and knowledge graph mapping, Nimbus Labs deploys a Neo4j cluster. This powers our relation exploration features.

## Cypher Guidelines
Ensure all queries use parameterized inputs to prevent injection attacks:
- Always index node keys like `id` and `name`.
- Keep path traversals bounded (e.g., `MATCH (n)-[*1..3]-(m)`) to avoid exhausting cluster memory.

## Syncing Graph State
Events published to the Kafka Event Bus keep Neo4j synchronized with our core Postgres tables.
See also:
- [Kafka Event Bus](kafka-event-bus.md)
- [Postgres Operations](postgres-operations.md)
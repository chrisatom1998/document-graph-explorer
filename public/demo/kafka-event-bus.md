# Kafka Event Bus

Kafka is the nervous system between services at Nimbus Labs. If two
services need to react to the same fact — a user upgraded their plan, an
order shipped — that fact should be an event on Kafka, not a webhook one
service calls on the other.

## Topics and partitions

Every topic is created explicitly through `module.kafka_topic` in
Terraform (see [Terraform Modules](terraform-modules.md)) with an explicit
partition count and retention window — we do not rely on cluster defaults,
because a topic that silently inherits a seven-day retention when it
needed thirty is a bad time for whoever's debugging it later. Partition
count is chosen based on expected consumer parallelism: more partitions
means more consumers can process in parallel, but also means more
per-partition overhead, so this is a real decision, not "just set it high."

## Consumer lag

Consumer lag — the gap between the newest message on a partition and what
a consumer has processed — is the single most-watched metric on our Kafka
dashboards. A small, temporary lag spike during a deploy is normal. Lag
that keeps growing means a consumer can't keep up, and it is one of the
most common precursors to a page — see the [Oncall Rotation](oncall-rotation.md)
doc for how lag alerts route, and the [Incident Runbook](incident-runbook.md)
for the actual triage steps once you're paged.

The most infamous internal incident, still referenced in
`#platform` as "the lag incident," happened when a consumer's Postgres
connection pool (see [Postgres Operations](postgres-operations.md)) was
exhausted, so every message took seconds instead of milliseconds to
process, and lag climbed for six hours before anyone noticed the actual
root cause was downstream, not in Kafka itself.

## ledger-worker: our biggest consumer

`ledger-worker`, described in the [Architecture Overview](architecture-overview.md),
is the largest consumer by message volume. It writes every event to
Postgres as the durable record, deduplicating on an idempotency key
because Kafka's at-least-once delivery means the same message can arrive
twice. If you're writing a new consumer, copy ledger-worker's
idempotency pattern rather than re-inventing it.

## Rate limiting and backpressure

Producers are expected to respect the same rate-limiting discipline
described in the API Rate Limiting notes — a service that floods a topic
faster than consumers can drain it is functionally the same problem as an
API client ignoring a 429, just one layer further from the user.

## Local development

Locally, Kafka runs as a single-broker container via the same compose
file described in [Onboarding](onboarding.md); topics are created
automatically by a setup script so new engineers don't need to hand-run
Terraform against a shared dev cluster.

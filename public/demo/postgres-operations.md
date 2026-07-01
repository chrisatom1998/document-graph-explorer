# Postgres Operations

Postgres is the system of record for every service at Nimbus Labs that
needs durable, transactional data. This document covers the operational
rules — schema ownership, connection pooling, and what to do when
something's slow — not how to write a query.

## Schema ownership

Every service gets its own schema, provisioned via `module.postgres_db`
(see [Terraform Modules](terraform-modules.md)), and no service reads or
writes another service's schema directly. If you need data another
service owns, ask for an API, or better, subscribe to its events on the
[Kafka Event Bus](kafka-event-bus.md). Direct cross-schema queries have
caused more incidents than they've saved engineering time, because they
create a hidden coupling nobody remembers is there until the owning team
changes a column.

## Connection pooling

Every service connects through a bounded connection pool, sized
deliberately per the load described in the
[Architecture Overview](architecture-overview.md) — not "as many as the
framework defaults to." Connection pool exhaustion is, by a wide margin,
our most common Postgres-adjacent incident: a slow query holds connections
longer than expected, the pool fills up, and every other request queues
behind it until the whole service looks down even though Postgres itself
is fine. If you're debugging a service that "went down" but Postgres CPU
looks idle, check pool saturation first.

The lag incident referenced in [Kafka Event Bus](kafka-event-bus.md) was
ultimately a connection pool problem wearing a Kafka costume — worth
reading if you want the full postmortem, which is linked from the
[Incident Runbook](incident-runbook.md).

## Migrations

Migrations must be backward-compatible with the previous release for at
least one deploy cycle, per the rule in the [Deploy Guide](deploy-guide.md)
— additive changes only during a blue-green window. Renaming or dropping
a column in the same release that also deploys code expecting the old
shape is the single fastest way to take blue-green from "safe" to
"outage," because for several minutes both the old and new code are
reading the same table.

## Retention and deletion

What gets deleted, when, and how it's proven deleted is governed by the
[Data Retention Policy](data-retention-policy.md), not by individual
engineers' judgment at the time. Ad hoc `DELETE` statements against
production, even well-intentioned ones, require the same sign-off as any
other retention-affecting change.

## When something's slow

Check connection pool saturation first, long-running transactions second,
missing indexes third. If none of those explain it and error rates are
climbing, this is an incident — go to the
[Incident Runbook](incident-runbook.md) rather than debugging solo for an
hour; a second pair of eyes early is cheaper than a postmortem later.

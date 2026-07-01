# Architecture Overview

Nimbus Labs runs on a fairly conventional but deliberately boring cloud
architecture: boring is a feature when you're paged at 3 a.m. This document
is the map everyone starts from — bookmark it, because half of onboarding
is just re-deriving the diagram in your head.

## The shape of the system

At the edge sits a managed load balancer fronting our public API. Requests
land on a Kubernetes cluster (see [Kubernetes Conventions](kubernetes-conventions.md)
for how workloads are organized inside it) running a service mesh for
mTLS and traffic shaping between services. Everything in the cluster is
provisioned through versioned Terraform modules — see
[Terraform Modules](terraform-modules.md) — so environments stay
reproducible instead of hand-tuned snowflakes.

Three services matter most day to day:

- **auth-service**, which issues and validates JWTs for every internal and
  external call. Read [Auth Service](auth-service.md) before you touch
  anything security-adjacent.
- **api-gateway**, which enforces per-tenant rate limiting and routes to
  backend services. Its throttling rules are documented separately in
  the rate-limiting notes.
- **ledger-worker**, which consumes events off Kafka (see
  [Kafka Event Bus](kafka-event-bus.md)) and writes the durable record to
  Postgres.

## Data layer

Postgres is our system of record. Each service that owns data gets its own
schema and a bounded connection pool — connection pool exhaustion is the
single most common cause of a bad afternoon, so pool sizing is reviewed in
every architecture review. Kafka sits between services as the event
backbone: anything another team might plausibly want to react to gets
published as an event rather than called synchronously.

## Deploys

We ship with a blue-green deploy strategy: a new container image is stood
up alongside the old one, health-checked, and traffic is shifted over
gradually before the old version is torn down. The mechanics live in the
[Deploy Guide](deploy-guide.md) — read it before your first release.

## Where to go next

If you're new, the [Onboarding Guide](onboarding.md) walks through getting
local access to all of this. If something is on fire, the
[Incident Runbook](incident-runbook.md) is the actual source of truth, not
this document — this page describes steady state, not 3 a.m.

## Honest caveats

This diagram undersells how much duct tape holds the staging environment
together, and it says nothing about the three services still waiting on a
Terraform module rewrite. If you find a service that isn't in Kubernetes
yet, that's not a bug in this doc — it's a backlog item. Ask in
`#platform` before assuming it's an accident.

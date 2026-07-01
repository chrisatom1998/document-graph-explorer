# Deploy Guide

Every service at Nimbus Labs ships the same way, on purpose. If your
release doesn't fit this shape, that's a conversation to have with
Platform before launch day, not during it.

## Blue-green, not rolling

We use a blue-green deploy for every production release. A brand new
container image is built, pushed to the registry, and deployed as a
parallel "green" fleet next to the current "blue" fleet inside the
Kubernetes cluster (see [Kubernetes Conventions](kubernetes-conventions.md)
for namespace and label conventions). Nothing gets user traffic until it
passes automated health checks and a five-minute soak.

Why blue-green instead of a rolling update? Because rollback is
instantaneous — flip the service selector back to blue — instead of
waiting for a slow rolling update to reverse itself while pages fire. The
[Architecture Overview](architecture-overview.md) has the broader context
for why we bias toward "boring but fast to undo."

## Step by step

1. Merge to `main`. CI builds a container image tagged with the commit SHA.
2. The image is pushed and a green deployment is created from the
   Terraform module for your service (see
   [Terraform Modules](terraform-modules.md) — do not hand-edit manifests).
3. Automated smoke tests hit the green fleet directly via its internal
   service address.
4. If smoke tests pass, traffic is shifted 10% → 50% → 100% over about ten
   minutes, watching error rate and p99 latency at each step.
5. Blue is kept warm for 30 minutes in case a fast rollback is needed, then
   scaled to zero.

## Database migrations

Migrations run *before* the green fleet receives traffic, and every
migration must be backward-compatible with the currently running blue
version for at least one release cycle — additive columns, not renames, not
drops. This is the single most common cause of a bad deploy, so if you're
touching Postgres schema, read that migration rule twice.

## What can still go wrong

Blue-green does not save you from a bad config value baked into the image,
a Kafka consumer that can't keep up with lag once it's the only fleet
running, or a JWT signing key mismatch between fleets. If a deploy goes
sideways in a way this guide didn't anticipate, stop guessing and follow
the [Incident Runbook](incident-runbook.md) instead — it has the actual
escalation path.

## Release cadence

Most services deploy on merge, several times a day. A handful of
higher-risk services follow the batched cadence described in
`release-process.txt`, which also covers the manual sign-off steps that
this guide intentionally leaves out.

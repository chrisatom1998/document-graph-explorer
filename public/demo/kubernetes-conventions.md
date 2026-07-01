# Kubernetes Conventions

This document is the style guide for how we use our Kubernetes cluster.
None of it is exciting. All of it is load-bearing.

## Namespaces

One namespace per team, named after the team (`platform`, `data`, `auth`).
Shared infrastructure lives in `nimbus-system`. Do not deploy a service
into someone else's namespace even temporarily "to test something" — RBAC
is scoped per namespace precisely so that a bad `kubectl apply` in your
sandbox can't touch someone else's container image.

## Labels every workload needs

```
app.kubernetes.io/name
app.kubernetes.io/owner-team
nimbus.io/service-tier   # "critical" | "standard" | "batch"
```

The `nimbus.io/service-tier` label drives autoscaling priority and which
services get paged on versus queued for business hours — see the
[Oncall Rotation](oncall-rotation.md) doc for how tiering maps to paging.

## Blue-green support

Every service's Terraform module (see
[Terraform Modules](terraform-modules.md)) provisions a `Service` object
with a selector that can be flipped between a `blue` and `green`
deployment label without touching either Deployment resource. This is what
makes the blue-green deploy described in the [Deploy Guide](deploy-guide.md)
a label change rather than a redeploy.

## Resource requests are not optional

Every container must set CPU and memory requests. Unbounded pods are how a
single misbehaving service eats a node and takes down its neighbors — this
has happened, ask anyone who was around for the "kafka-event-bus consumer
lag incident" that's now a running joke in `#platform`. Limits should be
set generously (2x request) rather than tightly; OOM-killing a healthy pod
because of a burst is worse than a slightly wasteful node.

## Health checks

Readiness probes gate whether a pod receives traffic; liveness probes gate
whether it gets restarted. Conflating the two is the most common cause of
a service getting killed mid-startup because someone wired the liveness
probe to a dependency check instead of a "am I alive" check. If your
service's dependency (Postgres, Kafka) is briefly unavailable, that should
fail readiness, not liveness.

## Where the source of truth lives

None of this is hand-applied. Every namespace, RBAC role, and base
workload spec comes from a Terraform module, described in
[Terraform Modules](terraform-modules.md). If `kubectl diff` shows drift
from what Terraform expects, that's a bug to fix, not a state to leave
running — see the broader philosophy in
[Architecture Overview](architecture-overview.md).

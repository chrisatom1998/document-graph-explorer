# Incident Runbook

This is the document to open the moment you're paged, not after you've
tried debugging solo for twenty minutes. If you only ever read one page of
this wiki carefully, make it this one.

## First five minutes

1. Acknowledge the page. Unacknowledged pages escalate to secondary per
   the [Oncall Rotation](oncall-rotation.md), which just adds confusion.
2. Assign a severity (Sev1/Sev2/Sev3 — definitions in
   [Oncall Rotation](oncall-rotation.md)) and post it in `#incidents` with
   a one-line description. This starts the clock on postmortem timelines.
3. If it's a suspected security issue — a leaked secret, anything touching
   [Auth Service](auth-service.md) or [SSO / Okta Setup](sso-okta-setup.md)
   — page the security on-call immediately, in parallel, per the
   [Security Review Process](security-review-process.md) emergency path.

## Common root causes, in order of likelihood

Based on our incident history, check these first:

- **Postgres connection pool exhaustion** (see
  [Postgres Operations](postgres-operations.md)) — a slow query or a
  leaked connection fills the pool and everything behind it queues. Look
  at pool saturation before anything else if a service "looks down" but
  its dependencies look healthy.
- **Kafka consumer lag** (see [Kafka Event Bus](kafka-event-bus.md))
  climbing unbounded, usually because a downstream dependency (frequently
  Postgres, see above) slowed the consumer down, not because Kafka itself
  is unhealthy.
- **A bad blue-green rollout** (see [Deploy Guide](deploy-guide.md)) — if
  the incident started within ten minutes of a deploy, check whether
  rolling back to blue resolves it before debugging forward.
- **Terraform drift** (see [Terraform Modules](terraform-modules.md)) — a
  manual change outside Terraform that the next `apply` will silently
  revert, or that already broke something on its own.

## Rolling back

Rolling back a deploy is a selector flip, described in the
[Deploy Guide](deploy-guide.md), and is almost always faster than forward
-fixing during an active Sev1. Roll back first, root-cause after, unless
rolling back is itself risky (a migration that already ran — see the
backward-compatibility rule in [Postgres Operations](postgres-operations.md)).

## Closing an incident

An incident is "closed" when customer impact has stopped, not when the
underlying cause is fully understood — those are different milestones.
Once closed, a postmortem is scheduled per the
[Oncall Rotation](oncall-rotation.md) timeline (three business days for
Sev1/Sev2), blameless, focused on what alert, runbook step, or automation
would have caught this sooner.

## This document is never finished

Every postmortem is expected to propose at least one edit to this runbook
— a missing root cause, a step that was unclear under pressure, a link
that should have been here and wasn't. If you were paged and this document
didn't help, that's a bug in the runbook, and the fix belongs here, not
just in your head.

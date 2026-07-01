# Oncall Rotation

Every service tagged `nimbus.io/service-tier: critical` in Kubernetes (see
[Kubernetes Conventions](kubernetes-conventions.md)) has an on-call
engineer reachable within five minutes, 24/7. This document is how that
rotation works, not what to do once you're paged — that's the
[Incident Runbook](incident-runbook.md).

## Rotation structure

Rotations are weekly, one primary and one secondary per team, visible in
the on-call scheduler tool (itself federated through
[SSO / Okta Setup](sso-okta-setup.md), like everything else). Secondary
exists so a page that goes unacknowledged for ten minutes escalates to a
real human instead of ringing into the void. Handoffs happen Monday at
10 a.m., with a short written handoff note: anything flaky this week,
anything mid-flight, anything to watch.

## What triggers a page

Pages fire on: error rate above threshold, latency SLO breach, Kafka
consumer lag climbing past a sustained threshold (see
[Kafka Event Bus](kafka-event-bus.md) for why lag matters so much), and
Postgres connection pool saturation (see
[Postgres Operations](postgres-operations.md)) — that last one accounts
for a disproportionate share of pages, which is why it gets called out by
name in new-hire shadowing per [Onboarding](onboarding.md).

## Severity levels

- **Sev1**: customer-facing outage or data integrity risk. Page
  immediately, all hands available join.
- **Sev2**: degraded but not down — elevated error rate, growing lag that
  hasn't caused visible impact yet. Primary handles solo unless it
  escalates.
- **Sev3**: noisy or non-urgent, handled during business hours.

Severity is assigned by the person first paged and can be revised as more
information comes in — better to over-call a Sev1 and downgrade than the
reverse.

## Security incidents are different

A suspected compromised credential, a leaked secret (see
[Secrets Management](secrets-management.md)), or anything touching
[Auth Service](auth-service.md) token issuance pages the security on-call
rotation *in addition to* the owning team's rotation, per the emergency
path in the [Security Review Process](security-review-process.md). Don't
assume the regular on-call engineer will loop security in automatically —
page both.

## After the page

Every Sev1 and Sev2 gets a written postmortem within three business days,
following the template linked from the
[Incident Runbook](incident-runbook.md). Postmortems are blameless by
policy — the goal is a better runbook and better alerts, not a name in a
ticket.

## Compensation and time off

On-call weeks come with a stipend and a guaranteed day off the following
week if you were paged overnight more than twice — check with your
manager if that hasn't been honored, since it's occasionally missed
during busy sprints.

# Data Retention Policy

This document governs how long Nimbus Labs keeps data, in what form, and
how deletion is verified. It applies to Postgres tables, Kafka topics, logs,
and backups — anywhere a customer's data can persist.

## Default retention windows

Absent a documented exception, customer data follows these defaults:

- **Transactional records** in Postgres (see
  [Postgres Operations](postgres-operations.md) for schema ownership
  rules): retained for the life of the account plus 30 days, then
  anonymized rather than hard-deleted, to preserve aggregate analytics
  without keeping identifiable data.
- **Kafka topics** (see [Kafka Event Bus](kafka-event-bus.md)): retention
  is set per-topic in Terraform, typically 7 to 30 days, chosen based on
  how long a consumer might plausibly need to replay from — never
  "indefinitely" without an explicit, reviewed exception.
- **Application logs**: 90 days, after which they're deleted, not archived.
- **Database backups**: 35 days of nightly snapshots, encrypted at rest.

## Account deletion requests

When a customer requests deletion, a job walks every schema that could
hold their data and either hard-deletes or anonymizes each row, logging
what it touched. This job's list of schemas is kept in sync manually right
now — any new service with a Postgres schema (per
[Postgres Operations](postgres-operations.md)) needs to be added to the
deletion job as part of that service's launch checklist, which is
genuinely one of the easiest steps to forget, so double-check it during
your own service's [Onboarding](onboarding.md)-adjacent launch review.

## Exceptions require security review

Any exception to these defaults — keeping data longer for a legal hold,
shortening it further for a sensitive data category — goes through the
[Security Review Process](security-review-process.md). This is not
optional even for "obviously fine" cases, because retention exceptions
compound: an exception nobody tracks centrally becomes an unaudited pile
of data nobody remembers approving.

## Verifying deletion actually happened

Deletion jobs write a completion record, and a quarterly audit
spot-checks a sample of completed deletion requests against actual
database state. If an audit ever finds data that should have been deleted
still present, that is treated as a security incident, not a data quality
bug — follow the [Incident Runbook](incident-runbook.md), because it means
either the deletion job or this policy has a gap that needs fixing before
the next customer request hits the same gap.

## Backups and the deletion problem

Because backups are retained for 35 days, a deletion request doesn't
retroactively scrub backups already taken — this is documented and
disclosed to customers rather than pretended away, and it's why the
35-day backup window itself is treated as part of the retention promise,
not an implementation detail.

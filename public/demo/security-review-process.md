# Security Review Process

Anything that touches authentication, secrets, or customer data at Nimbus
Labs goes through this process before it ships. It is intentionally
lightweight for small changes and intentionally slow for anything touching
JWT issuance or IAM.

## When you need a review

You need a security review if your change:

- Modifies [Auth Service](auth-service.md) token issuance, scope
  handling, or signing key rotation.
- Adds or widens IAM/access permissions, including Terraform modules that
  grant new secrets access (see [Secrets Management](secrets-management.md)
  and [Terraform Modules](terraform-modules.md)).
- Changes MFA or session behavior in [SSO / Okta Setup](sso-okta-setup.md).
- Touches the [Data Retention Policy](data-retention-policy.md) — deleting
  data on a different schedule than documented is a compliance issue, not
  just an engineering one.

If you're not sure, ask in `#security-review`. Asking is always cheaper
than the alternative.

## The queue

Requests go into a shared queue with a target of two business days for a
first response, four for anything involving customer data. Emergency
changes (an active incident per the
[Incident Runbook](incident-runbook.md)) can get a verbal sign-off from
whoever's on the security on-call rotation, followed by a retroactive
written review within 24 hours — this is the one exception to "no
shortcuts," because an active incident outranks process.

## What reviewers actually check

- Least-privilege: does this grant more access than the stated need?
- Blast radius: if this access or key were compromised, what's exposed?
- Reversibility: can this be rolled back without a second incident?
- Auditability: will we be able to tell later who did what, from logs
  alone?

## After approval

Approved changes still go through the normal
[Deploy Guide](deploy-guide.md) blue-green rollout — security approval is
not a fast-pass around the deploy pipeline, it's a gate before the PR
merges. The approval is recorded as a comment on the PR and mirrored into
the compliance log automatically.

## Postmortems feed this process

Every incident postmortem (see [Incident Runbook](incident-runbook.md))
that involves a security gap generates a follow-up item here — either a
new check added to this doc, or a new class of change added to the "when
you need a review" list above. This document is a living record of things
that have gone wrong before, which is why it reads a little defensively.

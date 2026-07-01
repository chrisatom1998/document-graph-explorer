# Secrets Management

Nothing sensitive at Nimbus Labs lives in a config file, an environment
variable committed to git, or a Terraform variable in plaintext. This
document is where secrets actually live and how services get them at boot.

## The vault

All secrets — database passwords, the JWT signing keys used by
[Auth Service](auth-service.md), API credentials for third parties — live
in a central secrets vault, fetched at container startup via a short-lived
identity token issued to the pod by Kubernetes (see
[Kubernetes Conventions](kubernetes-conventions.md) for the service
account setup that makes this possible). Nothing is fetched from the vault
outside of that boot sequence; there is no runtime "fetch this secret on
demand" pattern, on purpose, because it's harder to audit.

## Granting access

Access to a given secret path is granted per-service, per-environment,
through the same Terraform module review path described in
[Terraform Modules](terraform-modules.md). A service in staging cannot
read production secrets, full stop — this is enforced at the vault policy
level, not just by convention, so a compromised staging pod can't pivot
into production credentials.

## Least privilege in practice

Every secret grant answers three questions before it's approved: what
specifically needs this, why can't it use a scoped token instead of a raw
credential, and what happens if this exact secret leaks. If those answers
aren't in the request, the request bounces back. This is the same
least-privilege framing used in the
[Security Review Process](security-review-process.md), applied
specifically to secrets rather than access broadly.

## Rotation

Database passwords and third-party API keys rotate on a 90-day schedule
automatically; JWT signing keys rotate more frequently per
[Auth Service](auth-service.md). Rotation failures alert the on-call
engineer (see [Oncall Rotation](oncall-rotation.md)) rather than failing
silently, because a secret that quietly stopped rotating six months ago is
a worse outcome than a page at 2 a.m.

## If a secret leaks

Assume a leaked secret is compromised the moment it's out, even if you
"probably" caught it fast. Rotate it immediately through the vault, then
open an incident per the [Incident Runbook](incident-runbook.md) so the
blast radius gets assessed properly — what did that secret have access to,
and does anything downstream need re-auditing. Quietly rotating and moving
on is exactly the failure mode this whole document exists to prevent.

## What is explicitly not a secret

Non-sensitive configuration (feature flags, timeout values, log levels)
should stay in normal config, not the vault — cramming everything into the
vault "to be safe" just makes the genuinely sensitive secrets harder to
find and audit.

# Auth Service

`auth-service` is the smallest service in the fleet by line count and the
one that gets the most scrutiny per line, because every other service
trusts its output blindly. This document covers what it does and, more
importantly, what to never do to it without a second reviewer.

## What it issues

auth-service mints JWTs for two audiences: end users (via OAuth2
authorization code flow, federated through SSO — see
[SSO / Okta Setup](sso-okta-setup.md)) and internal services (via a
client-credentials flow scoped to a single service identity). Every JWT
carries a `scope` claim that downstream services check before honoring a
request — this is what "least privilege" means in practice here, not just
a phrase in a slide deck.

Access tokens are short-lived (15 minutes); refresh tokens are long-lived
but revocable, and revocation is checked against a Postgres-backed deny
list on every refresh — see the [Architecture Overview](architecture-overview.md)
for where auth-service sits relative to the rest of the request path.

## Rate limiting at the edge

Because token issuance is cheap to request and expensive to abuse,
api-gateway applies rate limiting to the token endpoint specifically —
details in the API Rate Limiting notes. auth-service itself does not
implement rate limiting; it trusts the gateway, which is why gateway
misconfiguration is treated as a security incident, not a performance bug.

## Signing keys

JWTs are signed with a rotating key pair; the current and previous public
keys are both published so in-flight tokens don't get rejected mid-rotation.
Rotation is automatic, but if you ever need to force a rotation (suspected
key compromise), that is an incident — go straight to the
[Incident Runbook](incident-runbook.md), don't try to do it quietly.
Private signing material is never in Terraform, config, or logs; see
[Secrets Management](secrets-management.md) for where it actually lives
and how it's fetched at boot.

## Changes to this service

Any change to token issuance, scope logic, or the signing key rotation
schedule requires sign-off through the
[Security Review Process](security-review-process.md) — no exceptions,
including "just a logging change" PRs, because we've been burned by a
logging change that accidentally printed a bearer token.

## Local development

New engineers get a sandbox Okta tenant automatically as part of
[Onboarding](onboarding.md); auth-service running locally talks to that
sandbox tenant, never production Okta. If your local login loop is stuck,
it's almost always a stale client ID in your `.env`, not a service bug.

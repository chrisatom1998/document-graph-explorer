# SSO / Okta Setup

Every human at Nimbus Labs authenticates through Okta, once, and every
internal tool federates from that single login via SSO. This doc is the
practical setup guide; for the theory of how the tokens flow, see
[Auth Service](auth-service.md).

## Getting your account

Okta accounts are provisioned automatically the moment you're added to
the HR system — see [Onboarding](onboarding.md) for the full first-day
checklist, of which this is one line item. If you don't have Okta access
by end of day one, that's a ticket to `#it-help`, not something to work
around.

## How SSO federation actually works here

Each internal tool (the wiki, the deploy dashboard, the on-call
scheduler) is registered as a separate Okta application, but all of them
redirect through the same OAuth2 authorization code flow against
auth-service, which validates the Okta-issued assertion and mints a
Nimbus-scoped JWT with the access token claims that tool actually needs.
Tools never see your Okta credentials directly, and they never should —
if you see a login form asking for your Okta password outside of
`okta.nimbuslabs.io`, report it immediately.

## Groups drive access, not roles

Access to individual services and Kubernetes namespaces (see
[Kubernetes Conventions](kubernetes-conventions.md)) is granted by Okta
group membership, synced hourly into our identity provider. Adding someone
to `okta-group:platform-admins` is the same action, audited the same way,
whether it's done through the UI or an API call — there's no back door
that skips the audit log.

## MFA is mandatory, not optional

Every account requires MFA (push or hardware key) before SSO will issue an
assertion. Attempting to disable MFA on any account — including test
accounts — requires a signed exception via the
[Security Review Process](security-review-process.md).

## Rotating your own credentials

If you suspect your Okta session or device was compromised, this is an
incident. Don't quietly reset your password and move on — follow the
[Incident Runbook](incident-runbook.md), because a compromised SSO session
can touch every downstream tool, and the security team needs to know the
blast radius, not just that you personally are fine now.

## Common setup problems

The most frequent new-hire issue is a stale group sync — you were added
to the right Okta group but the hourly sync hasn't run yet. Give it an
hour before filing a ticket; if access is still missing after that, escalate
through `#it-help` with your Okta group name attached.

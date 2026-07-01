# Onboarding

Welcome to Nimbus Labs. This is the first-week checklist — not everything
you'll ever need to know, but everything you need to become dangerous in a
good way by Friday.

## Day one

1. HR provisions your Okta account before you start; if it's not there by
   9 a.m., ping `#it-help`. See [SSO / Okta Setup](sso-okta-setup.md) for
   how federation works once you're in.
2. Clone `nimbus-monorepo` and run `make bootstrap`, which spins up a local
   Postgres, a single-broker Kafka container, and a stub auth-service
   pointed at a sandbox Okta tenant — never production. See
   [Auth Service](auth-service.md) for what that service actually does.
3. Read the [Architecture Overview](architecture-overview.md) once, fully,
   even the parts that don't apply to your team yet. It's the map
   everything else in this wiki assumes you have.

## Week one

Get your first PR merged, even something small — a docs fix, a log line
tweak. This walks you through the real
[Deploy Guide](deploy-guide.md) pipeline (blue-green, health checks, the
whole thing) on something low-risk, which is a much better way to learn it
than reading about it.

Shadow at least one on-call handoff, described in the
[Oncall Rotation](oncall-rotation.md) doc, even if you're not on the
rotation yet. Seeing how an actual page gets triaged against the
[Incident Runbook](incident-runbook.md) demystifies the whole process fast
— it stops feeling like a fire drill and starts feeling like a checklist.

## Access you'll need

Your manager requests access to your team's namespace (see
[Kubernetes Conventions](kubernetes-conventions.md)) and relevant Postgres
schemas (see [Postgres Operations](postgres-operations.md)) as part of
your day-one HR ticket. If something's missing after week one, that's
worth flagging — access requests occasionally fall through when someone's
out sick during your start week.

## Security basics from day one

MFA is mandatory the moment your Okta account exists — there's no grace
period. Any question about what counts as sensitive data, and how long we
keep it, is answered in the
[Data Retention Policy](data-retention-policy.md); when in doubt, ask in
`#security-review` rather than guessing, per the
[Security Review Process](security-review-process.md).

## What "done" looks like for onboarding

By the end of week two, you should be able to explain, in your own words,
why we use blue-green deploys, what a connection pool is and why it's the
usual suspect, and what to do if you get paged before you've read the full
runbook. If you can't yet, that's normal — ask your onboarding buddy, that's
what they're for.

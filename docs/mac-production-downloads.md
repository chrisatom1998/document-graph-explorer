# Production Mac downloads

After this workflow is merged and its first successful production build completes,
bookmark [Mac downloads](https://github.com/chrisatom1998/document-graph-explorer/releases/tag/mac-downloads).
The page provides separate Apple Silicon and Intel DMG links, exact source commit,
checksums and build details. The page is intentionally separate from GitHub's
`/releases/latest`, which remains available for the existing Windows version-tag flow.

## Release policy

- Trigger only on successful Vercel `deployment_status` for this public repository,
  environment `Production`, verified Vercel bot numeric ID on both objects, and
  this project's deployment URL. Preview, failed, spoofed and private-repo events
  are excluded. Vercel currently sets `production_environment=false` even on real
  Production deployments, so the exact environment name is used instead.
- Compare both deployed SHA and workflow SHA against `main` ancestry before
  checking out any repository code. Build the exact deployed SHA, never moving
  `main`. Use `persist-credentials: false`; expose the ephemeral GitHub token only
  to release API/upload steps. No new credentials or signing secrets are required.
- Build on standard `macos-15` (Apple Silicon) and `macos-15-intel` runners. Each
  build verifies runtime assets, native architecture, ad-hoc signature integrity,
  and packaged-app HTTP startup. These checks do not constitute full interactive
  Mac UI testing or Apple notarization.
- Releases are keyed by full source SHA (`mac-<sha>`). Duplicate success events
  reuse a complete release. Partial drafts can be retried and are never promoted
  to the download page. App metadata includes the source SHA to avoid stale
  version-based caches despite an unchanged package version.
- Upload directly to a draft release, without Actions artifact storage or cache
  writes. Publish only when both architectures and all checksum/provenance files
  are present. Published immutable build releases and the landing release are
  marked prerelease and `make_latest=false`; no existing Windows workflow changes.
- Update both landing-page links in one API operation only after publication.
  The previous complete download remains available during builds and on failure.
  The landing tag identifies its initial commit; the page's explicit Source link
  identifies the current downloadable build. Do not use its automatic source ZIP
  as the current desktop source.
- Eligible production runs share one concurrency group. GitHub coalesces rapid
  successive eligible production events to the newest pending run; intermediate
  superseded deployments may be skipped. Preview and unsuccessful status events
  use separate groups and can overlap, but cannot displace a pending production build. A monotonic status marker prevents
  delayed/rerun old events from replacing newer completed downloads.

## Costs and restrictions

This workflow fails closed for a private repository and uses only standard hosted
runners. GitHub documents those runners as free for public repositories. It does
not create billable Actions artifacts, cache entries, larger runners or a paid
service. GitHub Releases allows assets under 2 GiB each and imposes no total release
size or download bandwidth limit. Each DMG is checked against that limit.

- [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
- [GitHub release quotas](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases#storage-and-bandwidth-quotas)

The application is ad-hoc signed, **not Developer ID signed or notarized**. macOS
may block first launch; users must decide whether to trust the app. No instructions
to disable Gatekeeper or system protections are part of this flow. No automatic
updater is configured; download a new DMG to update manually.

## Operations

The first release requires a successful production deployment containing this
workflow. Merging or deploying must be authorized separately. A draft PR or a
passing policy test does not prove native packaging or release publication works.
If a build fails, inspect the Production Mac downloads workflow and rerun failed
jobs after fixing the cause. The pointer remains on the last complete release.
The workflow never changes Vercel, repository security settings, or Windows assets.

Policy tests (no npm dependencies):

```
node --test scripts/production-mac-policy.test.cjs
```

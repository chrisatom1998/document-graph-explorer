# Accuracy gate

`.github/workflows/accuracy-gate.yml` stops a change from making held-out accuracy worse. It analyses the change's app
build in headless Chromium on the round 3 held-out set (`holdout-r3-2026-10-06`), scores it, and compares every number
with the PR's base branch (main), not with the fixed 0.60 bar, so a tag that is failing today can't get worse either.

**What runs when**
- Every PR into main that touches the app (`src/`, `public/`, `package*.json`, `vite.config.*`, `index.html`) or the
  gate itself: the fast slice, 150 of the 500 Jamendo tracks plus all 318 MTG key tracks (about 15 minutes once the
  audio is cached). Other PRs pass at once.
- Pushes to main, one at a time: the full set (500 + 318). When several merges land while one is analysed, only the
  newest waits and the ones in between are skipped. The graph exports are cached per commit and become the baseline
  that later PRs compare with, so a PR normally analyses only itself. If main's numbers for the PR's
  base commit aren't cached (main's run still going or skipped, or the cache expired after 7 idle days), the PR
  analyses the base commit too.
- Monday 06:15 UTC, and Actions → Accuracy gate → Run workflow on main: the same full set. That re-saves the
  shared audio cache and the current commit's baseline. The manual run is what refills a cache that has already
  expired; the Monday schedule starts once this workflow is on main. Schedules and pushes share one queue, so a
  busy Monday can drop the cron.
- Every day at 07:30 UTC (`accuracy-gate-cache.yml`): restore the shared audio cache, and the newest full-set
  baseline, so a missed Monday does not age them out at 7 days. A miss fails that workflow and means the cache
  is already gone; Run workflow on the Accuracy gate (main) is what fills it again. The daily restore starts
  once that file is on main.
- Jamendo audio is read in byte ranges from `cdn.freesound.org`, checked against the dataset's published
  SHA-256, and cut the same way as before. A 503/429 retries the same range for up to 10 minutes. Tracks a
  shard already finished stay cached, and a failed shard is tried once more in the same run. Re-running the
  failed jobs continues from those tracks. The workflow's downloader is used only while the base commit
  still streams whole archives; once the base has the range downloader, that copy is what runs. The selector
  and the scorers always come from the base.
- The held-out audio lives in the Actions cache. It is never committed and never uploaded as a run artifact:
  the repository is public, and anyone signed in to GitHub can download an artifact. The cache is not a vault:
  a PR's own workflow and build scripts run with the audio restored on disk, so outside contributors' workflow
  runs should need approval (Settings → Actions → General). Jobs in one run hand the audio to each other through the cache (each shard's own key, merged into
  the shared key), not through artifacts.
- A PR labelled `full-accuracy-check`: also the full set (`accuracy-gate-full.yml`, advisory).

The fast slice is fixed by labels and ids only (`scripts/accuracy-gate/subset.mjs`): rarest class first, tracks in id
order until each class has min(30, all) positives, then filled to 150. It keeps 60 synthesizer, 57 drums, 49 piano,
43 bass, 30 guitar, 30 voice and every violin, saxophone, cello, trumpet and organ positive.

**What fails a PR** (`scripts/accuracy-gate/compare.mjs`)
- Sound tags: recall of each class with at least 10 labelled positives, and precision of each class the base showed at
  least 10 times (weak view, so a floor, but the same floor on both sides), plus voice precision on agreed labels.
- Tempo: within 4% of the Beatport BPM, and within 4% allowing half/double/triple.
- Key: exact rate and MIREX weighted score (confident annotations only).
- Coverage: fewer tracks analysed than the base (a crash or timeout).

A number fails when it drops by more than max(0.02, 1.5 / n), n being what the rate is taken over. One track flipping
never fails a change; two lost tracks on a 30-positive class (0.067) do. On the full set that is about 0.02 for most
numbers. Pushes to main only report.

**The 70% target.** The summary also marks every number at or above 0.70, and counts the tags that meet it on both
precision and recall, plus tempo (within 4%) and exact key. That line is report only: main doesn't meet it yet, so
failing on it would block every PR. The no-regression rule above is what fails a PR.

**Reading the result.** The job summary of "Accuracy gate / held-out / verdict" has the table (base, change, allowed
drop). Only aggregate numbers are shown, and the same rule as the held-out set applies: judge with it, don't tune on
it. A change that trades one number for another on purpose (say precision for recall) fails the gate; merge it anyway
only as a deliberate decision, and say so in the PR.

**Harness integrity.** Scorers, manifests and the subset rule come from the base commit, so a PR can't change how it is
judged. The Jamendo downloader is the base's copy once that copy reads by range; until then the workflow uses its
own, because the base copy cannot survive a CDN 503. Either copy refuses a track whose bytes do not match the
published SHA-256. The app's own `scripts/short-clip-upload-eval.mjs` drives the UI (it has to match the app's own
buttons).

**Making it block merges.** In the repository's branch protection (or ruleset) for main, add
"Accuracy gate / held-out / verdict" as a required status check.

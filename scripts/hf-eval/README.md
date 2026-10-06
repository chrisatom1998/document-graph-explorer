# Accuracy tests on Hugging Face Jobs

`.github/workflows/hf-eval.yml` runs a long evaluation on Hugging Face Jobs instead of GitHub-hosted runners, so it
doesn't sit in the Actions queue in front of PR CI. Each task is split into `parts` parallel HF jobs
(`cpu-upgrade` by default: 8 vCPU, 32 GB, $0.03/h, so 8 jobs for an hour cost about $0.24).

- `launch.py` (in Actions) checks the worst case (`parts x timeout x price`) against `max_cost`, starts the jobs,
  waits, downloads their results and writes `hf-cost.json` (wall clock, job-minutes, cost) and the job summary.
- `job.sh` (on each HF machine, image `node:24-bookworm`) checks out this harness and the app under test, runs
  `npm ci`, then `tasks/<task>.sh run`, and uploads `$OUT` (results only, never audio) to the private dataset
  `<HF user>/dge-eval-runs` under `runs/<run key>/part-<i>/`.
- `tasks/<task>.sh collect <parts dir> <results dir>` runs back in Actions to merge and score the parts.
  Results are committed to `docs/evaluations/hf-eval/<task>/...` on `results_branch` when one is given, and always
  kept as the `hf-eval-<task>` artifact.

Run it: Actions → "Accuracy test on Hugging Face Jobs" → task, app ref, parts. Or, on a `claude/hf-eval-*`
branch, change `request.json` and push. Add every run to the HF credit ledger before starting it.

Tasks:
- `all-tags-jamendo`: the all-tags full-song test (600 MTG-Jamendo validation songs) in the real built app in
  headless Chromium, several browsers per machine, scored like `all-tags-eval.yml`.
- `genre-energy`: genre/energy features for one list (`task_args`: `beatport-judge`, `jamendo-fit`, ...) with the
  genre thread's `scripts/genre-energy` from `app_ref`; merged into `data/<list>.json.gz` on `claude/genre-energy-data`.

- `holdout-r3`: the round 3 held-out check (`task_args`: `jamendo` or `mtgkey`, optionally `@<commit>` of the
  test set's branch) in the real app; pushes only aggregate reports to the test set's branch, and the workflow deletes
  the per-track exports from the HF dataset afterwards (`# HELD_OUT=1` in the task).

A task script gets `APP`, `HARNESS`, `OUT`, `WORK`, `PART`, `PARTS`, `TASK_ARGS`, `CPUS` (the machine's CPU quota; `nproc` shows the whole host) and optional `PROCS`.

# Luna pilot status — 2026-10-09

Implementation is available; live accuracy evaluation is blocked.

| Comparison | Clips measured | Precision / recall / F1 | API cost |
| --- | ---: | --- | ---: |
| Current detector stack | 0 | Not measured | $0 |
| GPT-Audio-1.5 alone | 0 | Not measured | $0 |
| Union / agreement / fallback | 0 | Not measured | $0 |
| Luna normalization / routing | 0 | Not measured | $0 |

The [preflight report](report.json) records the actual attempt. No paid request
was made. Missing inputs in this clean cloud checkout:

- The existing server-side `OPENAI_API_KEY`; no new key was created.
- An export from the current detector stack on the 20 selected benchmark clips.
- The corresponding actual benchmark audio files (WAV/OGG/MP3).

The requested `/Users/chrisjohnson/Projects/document-graph-explorer` is not mounted
in this environment; implementation work used `/workspace/document-graph-explorer`
on PR #172's existing branch. No uncommitted work was present initially.

Recommendation: keep the existing automatic-label acceptance thresholds and
policies. Luna proposals and routing remain advisory. There are no measured gains
or regressions to report; accuracy, latency and cost per successful model call
remain unknown. Instruments are the only annotated categories in the planned
benchmark; DJ effects and character accuracy are explicitly unproven.

The [runner instructions](../../../scripts/luna-evaluation/README.md) describe the
fixed 10-clip development / 10-clip artist-disjoint held-out split, privacy boundary,
per-category metrics, conservative $5 spending gate and reproducibility records.

## Implementation validation

- Full regression run: 345 test files passed, 2,694 tests passed, one skipped.
- Final coverage-bound change: all 36 focused evidence, server and UI tests passed.
- Evaluator scoring and budget tests: all seven passed.
- `npm run lint`, `npm run typecheck`, `npm run build`,
  `npm run build:airgap` and `npm run check:bundle` passed after the final change.
- Production-build Playwright music-assistant test passed on desktop and mobile,
  including the Luna section and disabled static-build action. It used the
  environment's existing Chromium executable.
- Runtime asset checks passed; the air-gapped build contains zero external
  service hosts. The branch diff contains no credential patterns.

These checks validate implementation behavior, not live model accuracy. The full
browser matrix and platform packaging remain CI checks; no merge was performed.

# Local browser audio upgrades — October 3, 2026

Available at http://localhost:5173/. Instrument analysis revision: 63.

## Changes

- Integrated the audio fixes and evaluation infrastructure from upstream `99af2d4` (PR #85), plus the Essentia CSP runtime repair. Existing local changes were preserved; this is a selective audio integration, not a merge of all upstream changes.
- Preserved 14-second Quick results/status, background Full scans, bounded folder scheduling, warmed models, DJ classifications, and the current 1,653-example / 21-head reviewed model.
- Scans record coverage per component, distinguish unsupported short Jamendo clips from failures, reconcile slightly overstated durations, retain independent results when another component fails, and keep review history separate from predictions. Evidence controls are collapsed by default.
- Reviewed-example matching now accumulates reviewed categories in one pass. Comparisons on 21 inputs produced identical outputs using the current bundled model. Matching took 64.7 ms before and 25.4 ms after (2.55 times faster). This measures matching only, not entire audio inference.
- Persistent analysis caches include all three model manifests, prompts, learned weights, modes and algorithm revisions. Incomplete tempo/key components are retried. User corrections and review history are excluded from shared cached predictions. Dev/build staging supplies small model-version metadata without importing public JSON as JavaScript or rewriting unchanged metadata.

## Verification

- Build, TypeScript, ESLint, runtime model checksums, bundle budgets and diff whitespace checks passed.
- Final full suite: 1,550 passed, one skipped, one repository-scan test timed out under full-suite load. That test's entire six-test file passed separately in 4.16 seconds. All 1,551 unique non-skipped tests were verified across those runs.
- Actual Chromium decoding and analysis of an anonymous one-second synthetic WAV completed. AST, CLAP, tempo and key jobs completed; Jamendo was correctly unsupported with zero inference coverage. No page errors occurred.
- Browser first analysis: 16.52 seconds. Reanalysis from persistent cache: 0.261 seconds. Normalized predictions matched. This synthetic smoke check verifies runtime behavior, not musical recognition accuracy.

## Accuracy limits

The current reviewed model and upgraded recognition safeguards are present. Neither this integration nor the synthetic browser smoke check measures a broad accuracy gain. Existing provisional training checks do not establish generalization; independent positive and negative audio evaluations remain necessary.

Existing tracks can use **Reanalyze** to replace older automatic estimates while retaining confirmations and review history. The dev server was started; no hosted deployment or installed Mac-app update was performed.

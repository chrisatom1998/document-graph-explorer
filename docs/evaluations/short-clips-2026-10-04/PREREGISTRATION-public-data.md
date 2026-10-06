# Short-clip heads trained on public data: pre-registration (written 2026-10-05, before any test read)

Benchmark: frozen short-clip test split (docs/evaluations/short-clips-2026-10-04, 1,445 clips), unchanged.
Audio recreated from public sources by manifest id; every clip's peak level matched item-meta.json (2,254/2,254).

Baseline: current main build (short-clip-2026-10-04-clapRepeat), re-measured here through the real app.
Candidate: the same build with public/sound-model/short-clip.json replaced by heads trained only on:
  FSD50K dev (CC0 / CC BY 3.0 clips only; uploaders disjoint from calibration and test), NSynth train (CC BY 4.0,
  instruments disjoint from NSynth test), AVP train-bucket participants (CC BY 4.0), EGFxSet clean/distortion/reverb (CC BY 4.0).
Selection: group 5-fold out-of-fold over train + calibration; a head ships only if OOF precision >= .70 and recall >= .70.
No test feature is cached; no threshold, head, label mapping or data choice changes after the test run.
New labels emitted through existing catalog labels: character distorted / reverberant, production beatbox / bass hit, source horn (scored as brass).

Primary outcome: number of categories meeting 70/70 precision/recall on test, candidate vs baseline, with
per-category precision and recall and family-bootstrap intervals from scripts/short-clip-report.py.
A category that drops below 70/70 in the candidate is reported as a regression, not hidden.

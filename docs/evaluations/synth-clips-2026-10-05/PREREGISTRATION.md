# Pre-registration: fresh synth test (2026-10-05)

Frozen before any retraining: `manifest.json` SHA-256 `426f10ceaf97ce1d…`, 2,023 clips, 466 families.
- Purpose: measure retrained `synth hit` and `synthesizer` one-shot heads only, once, through real uploads.
- Training excludes every family in `reserved-test-families.json` (held-out NSynth-train instruments; held-out FSD50K dev uploaders).
- Heads, features and thresholds are chosen on development data (grouped out-of-fold) only.
- Ship rule: a head ships only if this test shows precision AND recall ≥ 0.70; otherwise it stays hidden. No retuning on this set.

Addendum (before any training): the user set the project pass bar to **60/60** on 2026-10-05. Ship rule becomes
precision AND recall ≥ 0.60 on this test set; development selection also targets 0.60.

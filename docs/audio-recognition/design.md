# Sound recognition: stages 1–2

Approved implementation edition, 2 October 2026. Baseline: `ac0071525f9391e2d08b9d63ac52a4aeaac4db44`.

## Goal and boundaries

Build a dependable browser-local baseline using the existing AST, Discogs-EffNet/MTG-Jamendo, Music CLAP and Essentia adapters. Preserve the 40 Jamendo classes, 53 fixed CLAP vectors and deployed weights. Universal or nearly 100% recognition is impossible to promise. Dense mixes, imitations, processing and quiet sources can be ambiguous. New machine observations remain **possible, uncalibrated** until independent evaluation supports acceptance thresholds. No training, purchased corpus, external audio processing, new models, separation, merge or deployment is authorized.

## Stage 1 contract

- Stable content fingerprint, unique run ID, versioned configuration and model/preprocessing/prompt provenance.
- One bounded timeline scheduler. Full mode covers valid audio including tails; fast mode explicitly samples. Record planned/attempted/successful intervals and gaps independently for AST, Jamendo, CLAP, rhythm and tonality. Window boundaries are evidence resolution, not detected event boundaries.
- Separate failures: a first AST failure cannot suppress Jamendo/CLAP; rhythm and tonal failures cannot erase the other dimension or source evidence. Aggregate successful windows only. No manufactured silence or negative labels. Bounded retries, no duplicate observations.
- Bounded decoded buffers, serialized inference, bounded cache keyed by fingerprint/model/version/preprocessing/prompt/window/configuration. Cancellation terminates active work, preserves completed partial evidence and cannot overwrite a newer run. Preserve existing file/device compatibility. Measure latency/memory on named devices before claiming duration/performance guarantees.
- Backward-compatible versioned run, jobs, coverage, evidence and multi-label observations. Dimensions: source family/specific instrument, vocal form, role, character, effect/event. Store original intervals, valid length, raw score and aggregation provenance; never turn a score into a probability.
- Preserve human confirmed/rejected/uncertain reviews and their scope, time and original evidence version. Old records have unknown provenance rather than invented coverage.
- Show multiple labels and playable evidence, uncalibrated status, unknown/unsupported dimensions and missing coverage. Only accepted machine observations or explicit confirmations can make sound-derived graph edges; tentative suggestions cannot. Existing manual/name-derived relationships remain explicitly identified.
- Reanalysis with selected IDs analyzes only those IDs; unselected stale results remain untouched.
- Tempo: half/double hypotheses and unknown/stability distinct. Tonality: major/minor key versus repeated pitch/root-only versus unknown; never force a mode from a pitched one-shot.

## Vocabulary

Sources: voice, synthesizer, strings, woodwind, brass, keys, drums, percussion. Roles: lead/bass/pad/chord/arpeggio/rhythm/texture. Vocal forms: phrase/chop/ad-lib/sustained/vocoder-like. Characters such as supersaw-like, Reese-like and 808-like describe resemblance, not provenance. Effects include riser/downlifter/impact/sweep/reverse/glitch/laser/rumble/atmosphere. Only the fixed deployed model vocabulary is supported initially; other classes are explicitly unsupported. Public Oversampled product descriptions inform review vocabulary only, never exact preset or pack attribution.

## Stage 2 evaluation contract

Implement a versioned manifest and evaluator; actual corpus collection/calibration is blocked on rights-cleared, reviewed audio. Proposed pilot: 200–300 excerpts, at least 50 independent tracks, plus one-shots, loops and stems. This is not enough to establish universal accuracy. Only 8/32 existing clips have confirmed reviews; prior tuning is not held-out evaluation.

Manifest: source, rights/permitted uses, track/artist/pack/sample family, transformations, tier, interval, positive/negative/uncertain/unreviewed labels and reviewer history. Related originals, transformed variants and excerpts must not cross calibration/test boundaries. Freeze splits before tuning; difficult examples need two reviewers/adjudication. Unreviewed labels are not false positives.

Report per-class precision/recall, macro and prevalence-aware summaries, false extra labels per track, accepted coverage by tier/dimension, abstention/unknown, review workload, confidence intervals and independent group counts. Compare at matched precision or coverage. BPM strict tolerance and half/double-tolerant accuracy are separate; key exact tonic/mode and MIREX related-key credit are separate. Measure timing at actual window resolution, elapsed/real-time factor, memory, cancellation and cold/warm failures by device. No 99% badge or measured quality improvement without held-out evidence.

Challenges: layered/quiet/brief sources, synth imitations, processing; vocal chops versus gated/formant synths and percussion; half/double tempo, variable tempo, nonmetric effects; key changes, modes, detuning, atonality and pitched one-shots.

## Immediate gates

Fault injection for first AST/rhythm/tonal failures; exact selection; full tail/gaps; cancel/restart without obsolete writes or lost confirmations; legacy migration; local privacy/cache invalidation/resource bounds; simultaneous sources and abstention; tentative-label graph exclusion; frozen grouped benchmark splits and partial annotation handling. Run lint, both typechecks, complete Vitest, production build and actual browser flows; obtain independent review and recheck final code.

Accuracy gate proposals (not measured): at least 95% observed precision in supported class/tier pilot slices, uncertainty reported; better recall at matched precision or precision at matched coverage, with unexplained critical regressions blocking release. 299 independent error-free binary decisions would yield a one-sided exact 95% lower bound just above 99%; correlated windows do not count as independent trials.

## Deferred and licensing

Demucs original-plus-stem ablation and Beat This experiments require separate authorization and measured gains. A stem name is not evidence that a source exists. Preserve MTG licensing notice (CC BY-NC-SA/proprietary options); browser-local operation does not remove commercial distribution constraints. Purchased music-production rights do not automatically permit ML training or redistribution.

Sources supplied with approved design: [Essentia models](https://essentia.upf.edu/models.html), [CLAP](https://github.com/LAION-AI/CLAP), [Oversampled sound design](https://oversampled.us/products/sounddesignmission), [synth presets](https://oversampled.us/products/ultimate-future-bass-serum-presets-vol-1), [vocal chops](https://oversampled.us/collections/bestsellers/products/ultimate-vocal-chops-library-vol-1), [policies](https://oversampled.us/pages/policies), [tempo metrics](https://mir-eval.readthedocs.io/latest/api/tempo.html), [key metrics](https://mir-eval.readthedocs.io/latest/api/key.html), [Demucs](https://github.com/facebookresearch/demucs), [Beat This](https://github.com/CPJKU/beat_this). Source checking was performed by the design author on 2 October 2026.

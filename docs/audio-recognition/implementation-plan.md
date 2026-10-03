# Implementation and validation plan

Branch: `feat/audio-recognition-stages-1-2`. Main remains at audited baseline. No publication authorized.

1. Freeze baseline and design. Initial targeted baseline: 166 tests / 16 files pass. Standard npm ci failed at onnxruntime-node's NuGet download (DNS); npm ci --ignore-scripts succeeded for web/unit tooling. Existing weights absent locally.
2. Add failing regressions for independent failures, whole-track evidence, exact selection, cancellation and graph exclusion. Implement schema, provenance, bounded scheduler/cache and independent adapters.
3. Add backward-compatible persistence and review preservation; expose multi-source/dimension evidence, unknowns and interval playback. Keep legacy records readable without manufactured provenance.
4. Add deterministic manifest/split/metric/calibration-interface tests and evaluation CLI. No corpus or quality result is fabricated; pilot collection is a separate data dependency.
5. Run full lint/typecheck/test/build, actual synthetic-audio browser flow, independent code review and final rechecks. Record exact outcomes, limitations and environment failures.

Resource policy: serial model inference; existing decoder's 65-second block bound; at most 24 hours (existing limit). Cache stores bounded results, never PCM. Evidence storage has an explicit cap and reports truncation. Supported hardware latency/peak resident memory budgets remain unmeasured and must be published from a pilot.

Delivered scope clarification: whole-track scheduling covers AST/Jamendo/CLAP. Rhythm/tonal retain the existing sampled-excerpt behavior above 60 seconds, with explicit coverage gaps. Full-track tempo/key change mapping, continuous crash-resume checkpoints, and the rights-cleared benchmark pilot remain next milestones. The design’s ambiguity requirement does not itself require a modulation map; the broader all-component full-coverage goal is not complete.

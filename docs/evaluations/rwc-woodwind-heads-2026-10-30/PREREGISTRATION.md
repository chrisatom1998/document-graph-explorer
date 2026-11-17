# Pre-registration: RWC woodwind CLAP head refits (2026-10-30, written before the first read)

Tags: bassoon, oboe, flute (CLAP heads in `public/sound-model/learned.json`; all three ship as `maybe` today).
Not touched: cello and clarinet (owned by another project thread), trumpet (#250), horn (did not move on 10-29),
electric guitar / piano (#259), and every tag in #258.

Fit (box CPU, no paid compute): the 10-29 clean head data (NSynth-train instead of NSynth-test negatives; FSD50K-eval,
test-clip and licensed-pilot ids flagged test-only; 346 TinySOL judge notes removed) plus RWC wind notes (CC BY-NC 4.0).
- Training rows exclude: the recipe's fixed real-recordings test groups, their cross-source Freesound twins (`DEDUP=1`),
  every test-only row, and half of the RWC players (`HALF_TEST=rwc:`, sha256 of the player group).
- Model strength C is picked out of fold on training rows only (`C_GRID`). The cutoff is picked out of fold on training
  rows only. No test row picks anything.
- The weights that ship are exactly the weights that are scored (fit on training rows only; no refit on test rows).

Judges, read once: (1) the recipe's real-recordings test (Freesound-mined / FSD50K / FSL10K uploader groups, unchanged
from 10-29); (2) the held-out RWC player half (negatives = the other RWC wind and brass notes in that half).

Ship rule per tag: precision >= 0.50 and recall >= 0.50 on every judge with >= 5 positives -> replace the head and drop
`maybe`. Otherwise the head is left exactly as it is. No second attempt on these judges.
Regression rule: each head is a separate logistic model, so a swap cannot change any other head's output. The full
vitest suite must pass.

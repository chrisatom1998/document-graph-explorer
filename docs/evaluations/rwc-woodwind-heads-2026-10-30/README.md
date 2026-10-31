# Bassoon head refit with RWC notes (2026-10-30)

The bassoon CLAP head shipped as a faded "maybe" tag (recorded 0.91 / 0.47 on 45 real recordings, round 23). It is now
refit with RWC bassoon notes and ships as a normal tag. Flute and oboe were refit the same way, failed the rule written
down first (`PREREGISTRATION.md`), and are unchanged. Box CPU only, no paid compute. Numbers in `report.json`.

## How

- Data: the 2026-10-29 clean head data (NSynth-train instead of NSynth-test negatives; FSD50K-eval, test-clip and
  licensed-pilot ids kept as test-only; the 346 TinySOL judge notes removed) plus 2,085 RWC wind and brass notes
  (CC BY-NC 4.0, so these weights stay CC BY-NC-SA like the rest of `learned.json`).
- Fingerprints: the app's own q8 CLAP model (`scripts/embed-clap.mjs`). The weights in `learned.json` were run through
  `learnedDjScores` in the app code on all 2,085 RWC notes and tag exactly the same notes as the Python scorer.
- Fit: `scripts/train-with-extras.py` with `BAR=0.5 DEDUP=1 HALF_TEST=rwc: C_GRID=0.05,0.1,0.25,0.5,2
  ONLY=instrument:bassoon,instrument:oboe,instrument:flute SAVE_DIR=<dir>`. Training rows exclude the test groups, their
  cross-source Freesound twins, test-only rows and half of the RWC players. Model strength (C = 0.1) and the cutoff (0.935)
  were picked out of fold on training rows. The shipped weights are the ones that were scored: there is no refit on test rows.
- Judges, each read once for this decision: (1) the recipe's real-recordings test for the instrument (Freesound-mined,
  FSD50K and FSL10K uploader groups, the same rows as 2026-10-29); (2) the RWC players whose `sha256("half|rwc:"+group)`
  is even. That half was never trained on. Its negatives are the other RWC wind and brass notes of the same players, so it
  checks bassoon against other winds; the first judge checks it against everything else. Every RWC note is longer than
  2.25 s, which is where the app runs this head (it is not a one-shot head).

## Result

| Tag | Judge (positives) | Before: clean recipe, no RWC | After: + RWC (shipped) | Rule |
|---|---|---|---|---|
| bassoon | real recordings (45) | 0.92 / 0.49 | **0.93 / 0.62** | pass |
| bassoon | held-out RWC players (120; 763 negatives) | 0.64 / 0.83 | **0.64 / 0.96** | pass |
| flute | real recordings (157) | 0.78 / 0.45 | 0.81 / 0.44 | fail, unchanged |
| flute | held-out RWC players (35) | 0.59 / 0.86 | 0.77 / 0.86 | |
| oboe | real recordings (41) | 1.00 / 0.07 | 1.00 / 0.07 | fail, unchanged |
| oboe | held-out RWC players (57) | 0.41 / 0.89 | 0.41 / 0.89 | (both RWC oboe players fell in the held-out half) |

Both "before" and "after" are fit on training rows only, so they are a fair pair. The old shipped bassoon head scores
0.92 / 0.73 on the real-recordings test, but it was refit on those test rows, so that number is not fair. On the RWC half,
which it never saw, it scores 0.68 / 0.83. The new head trades 4 points of precision there for 13 points of recall, and is
the only one with a fair score on both judges.

Bassoon now clears 50/50 and 60/60 on both judges, but not 70/70 (recall 0.62 on real recordings, precision 0.64 against
other winds). Each head is its own logistic model, so no other tag's output changes.

Caveats: 45 real-recording positives is small (one clip is about 2 points of recall). The real-recordings test has been
read several times since 2026-10-29 (by earlier refits); none of those reads or this one chose a weight, C or cutoff.
The RWC half is one bassoon player.

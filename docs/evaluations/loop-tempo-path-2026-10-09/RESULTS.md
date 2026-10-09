# Loop-only tempo path (2026-10-09)

**Change.** A file under 30 s (one excerpt) that wraps seamlessly, from its end back to its start, and has at least
three attacks is treated as a loop. Its tempo comes from the loop-trained tempo CNN (tempo-loops-v1, "v2" in
`docs/evaluations/tempo-loops-2026-10-06`, trained in #156 and not shipped then), which overrides the Essentia loop
estimate whenever its confidence is above 0.1. Every other file keeps main's path: the shipped CNN (#139) with the 0.5
rule from #147. Files of 30 s or more never reach the new path, so full-track tempo is unchanged by construction.

- Seamless wrap (`src/audio/loopWrap.ts`): falling spectral flux where the file wraps, as a percentile of the file's own
  moments. An excerpt cut out of a song usually ends mid-note, so its wrap is the biggest drop in the file (GTZAN 10 s
  excerpts: 98.5% at or above the 95th percentile); a loop is cut to repeat (FSL10K tuning loops: 61% below it).
  Loop if below 0.95.
- Three attacks (`countAttacks`, the rule `estimateTempo` already applies to short files): a one-shot also ends in
  silence and so wraps cleanly. Added after the sample-pack run below showed 808 one-shots getting a tempo (34 to 166 of
  338); it changes nothing on the tuning loops (78.8% to 78.6%).

## Tuning (only data used to choose anything)

533 FSL10K loops with listener BPMs chosen by the judge set's own rules, none of them a judge loop, max 4 per uploader
(`fsl10k-tuning-loops.json`, `scripts/tempo/loop-tuning-set.py`). Drum loops never come from a judge-set uploader. The
judge set took nearly all other melodic loops, so the 45 melodic tuning loops do come from judge-set uploaders (marked
`judge_uploader`). Song excerpts: GTZAN's tune half (500 tracks, middle 10 s and 3-13 s), never judged here.

| Within 4% | Main | Loop-trained CNN, override above 0.1 |
|---|---|---|
| Tuning loops, all short files on the new path | 73.5% | 81.6% |
| GTZAN tune 10 s excerpts, all short files on the new path | 70.9% | 60.2% |
| Tuning loops, seamless loops only (final) | 73.5% | 78.6% |
| GTZAN tune 10 s excerpts, seamless wrap only (before the attack rule) | 70.9% | 71.0% |

Sending every short file to the loop model loses 10 points on song excerpts, hence the wrap check. A whole-bars
duration check was tried first and rejected: 10.0 s excerpts fit whole bars at many tempos and it fired on 30-70% of them.

## Judge sets (scored once, after the rule was frozen)

Node harness with the app's own code (`scripts/tempo/loop-features.mjs`: ffmpeg to 44.1 kHz mono, `estimateTempo`, both
CNNs, the wrap check; the worker's rules applied to its output). Main on this harness gives 63.0% on the loops, against
63.3% recorded in the browser for #147.

| Set | n | Main | This change | Files on the loop path | Fixed / broken |
|---|---|---|---|---|---|
| FSL10K listener loops | 330 | 63.0% | **66.4%** | 155 | 19 / 8 |
| melodic, no drums | 240 | 57.5% | **62.1%** | 106 | 16 / 5 |
| with drums | 90 | 77.8% | 77.8% | 49 | 3 / 3 |
| Sample packs, BPM in the name (audio only) | 191 | 69.1% | **70.7%** | 83 | 6 / 3 |
| DJ round 1, 10 s Beatport excerpts | 500 | 82.6% | 82.4% | 9 | 0 / 1 |
| DJ round 2, 10 s Beatport excerpts | 497 | 86.3% | 86.3% | 9 | 0 / 0 |
| GTZAN test half, middle 10 s | 498 | 70.5% | 69.9% | 12 | 1 / 4 |
| GTZAN test half, full 30 s | 498 | 63.5% | 63.5% | 0 | 0 / 0 |
| Fresh Beatport (round 3), full previews | 318 | unchanged: over 30 s, never on the new path | | | |

Tempo shown where there is none:

| Set | n | Main | This change |
|---|---|---|---|
| FSL10K loops listeners marked as having no tempo | 30 | 16 | 19 |
| 808 one-shots | 338 | 34 | 36 |
| Transmutation one-shots | 104 | 70 | 70 |
| Transmutation files without a BPM in the name | 54 | 7 | 13 |

Per-file rows for every public set: `rows.json` (`v1` = shipped CNN, `v2` = loop-trained CNN, `wrap` = wrap
percentile, `attacks` where the wrap check fired). Chris's 16 commercial loops were also run and are left out of the
repo: 10 to 11 of the 13 with a BPM in the name.

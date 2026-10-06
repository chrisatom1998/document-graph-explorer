### Accuracy gate (150 Jamendo tracks, 318 MTG key tracks)

**Accuracy dropped** on 4 numbers: voice recall, voice precision, piano recall, bass recall.

**70% target** (report only): 0/10 tags meet it on both precision and recall; tempo meets it, key exact misses it.

| Number | Base | This change | Change | Allowed drop | n | ≥ 70% | |
|---|---|---|---|---|---|---|---|
| drums recall | 0.772 | 0.825 | +0.053 | ±0.026 | 57 | ✓ | ✅ improved |
| drums precision | 0.411 | 0.431 | +0.020 | ±0.020 | 107 | ✗ | ✅ improved |
| voice recall | 0.967 | 0.900 | -0.067 | ±0.050 | 30 | ✓ | ❌ dropped |
| voice precision | 0.392 | 0.360 | -0.032 | ±0.020 | 74 | ✗ | ❌ dropped |
| synthesizer recall | 0.900 | 0.883 | -0.017 | ±0.025 | 60 | ✓ | ok |
| synthesizer precision | 0.439 | 0.434 | -0.005 | ±0.020 | 123 | ✗ | ok |
| piano recall | 0.837 | 0.796 | -0.041 | ±0.031 | 49 | ✓ | ❌ dropped |
| piano precision | 0.554 | 0.557 | +0.003 | ±0.020 | 74 | ✗ | ok |
| guitar recall | 0.567 | 0.567 | +0.000 | ±0.050 | 30 | ✗ | ok |
| guitar precision | 0.298 | 0.304 | +0.006 | ±0.026 | 57 | ✗ | ok |
| bass recall | 0.233 | 0.186 | -0.047 | ±0.035 | 43 | ✗ | ❌ dropped |
| bass precision | 0.385 | 0.333 | -0.052 | ±0.058 | 26 | ✗ | ok |
| cymbals recall | — | — |  |  | 0 |  | not gated (too few) |
| cymbals precision | — | — |  |  | 0 |  | not gated (too few) |
| organ recall | 0.000 | 0.000 |  |  | 5 | ✗ | not gated (too few) |
| organ precision | 0.000 | 0.000 |  |  | 8 | ✗ | not gated (too few) |
| violin recall | 0.345 | 0.310 | -0.035 | ±0.052 | 29 | ✗ | ok |
| violin precision | 0.476 | 0.474 | -0.002 | ±0.071 | 21 | ✗ | ok |
| trumpet recall | 0.300 | 0.300 | +0.000 | ±0.150 | 10 | ✗ | ok |
| trumpet precision | 0.231 | 0.250 | +0.019 | ±0.115 | 13 | ✗ | ok |
| saxophone recall | 0.533 | 0.533 | +0.000 | ±0.100 | 15 | ✗ | ok |
| saxophone precision | 0.727 | 0.727 | +0.000 | ±0.136 | 11 | ✓ | ok |
| cello recall | 0.333 | 0.333 | +0.000 | ±0.125 | 12 | ✗ | ok |
| cello precision | 0.222 | 0.235 | +0.013 | ±0.083 | 18 | ✗ | ok |
| voice precision (agreed labels) | 0.500 | 0.482 | -0.018 | ±0.026 | 58 | ✗ | ok |
| tempo within 4% | 0.833 | 0.836 | +0.003 | ±0.020 | 318 | ✓ | ok |
| tempo within 4% or 2x/½x/3x/⅓x | 0.899 | 0.903 | +0.004 | ±0.020 | 318 | ✓ | ok |
| key exact | 0.533 | 0.537 | +0.004 | ±0.020 | 244 | ✗ | ok |
| key MIREX score | 0.625 | 0.627 | +0.002 | ±0.020 | 244 | ✗ | ok |
| Jamendo tracks analysed | 1.000 | 1.000 | +0.000 | ±0.000 | 150 |  | ok |
| MTG key tracks analysed | 1.000 | 1.000 | +0.000 | ±0.000 | 318 |  | ok |

Round 3 held-out set (docs/evaluations/holdout-r3-2026-10-06): judge with it, never tune on it. Only these aggregates are reported.

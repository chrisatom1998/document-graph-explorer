# Fixing the DJ clip test failures (2026-10-06)

**Pass bar:** precision and recall both at least 0.70 (Chris raised it from 0.60 on 2026-10-06). Tags below the bar are
still shown; the bar is a target, not a display gate.

## What changed (presentation only, `src/audio/confidentSoundSummary.ts`)

| Tag | Change | Why |
|---|---|---|
| guitar, violin | Show the OpenMIC fusion head's own probability at **0.40 or above** on whole 10 s windows (`FULL_MIX_HEADS`) | The accepted fusion release keeps guitar, saxophone and violin on its Jamendo baseline rule, which carries no probability, so these tags were almost never shown even though their heads score well |
| trumpet | Needs a tested score of **0.50** on recordings of at least 10 s (was the 0.40 track floor) | False alarms |
| cello | Needs **0.55** on recordings of at least 10 s | False cello tags on about 5% of EDM tracks |
| saxophone, bass, organ | No change | No rule held up on the held-out calibration half (below) |

Stored evidence, graph links and cache identity are unchanged. Sound tags still flow into graph links as before.

## How the thresholds were picked

Only on the 900 OpenMIC calibration clips of `docs/evaluations/mixed-music-2026-10-05` (no clip or artist from either
DJ clip test). The current main build analysed them in the real app on Actions (run 37412171657,
`calibration/cal900-records.json`); OpenMIC labels for all 20 instruments are in `labels/`. `scripts/dj-fix/calibrate.py`
splits clips by artist (the #113 seed), picks each threshold on one half and checks it on the other; the rules and the
adoption test were written before any result was read (`calibration.json`).

| Tag | Rule | Calibration half, main → rule (P / R) | Held-out half, main → rule (P / R) | Adopted |
|---|---|---|---|---|
| guitar | head ≥ 0.40 | 1.00 / 0.25 → 0.97 / 1.00 | 1.00 / 0.21 → 1.00 / 0.97 | yes |
| violin | head ≥ 0.40 | 0.78 / 0.41 → 0.80 / 0.94 | 1.00 / 0.38 → 0.88 / 1.00 | yes |
| saxophone | head ≥ 0.40 | 1.00 / 0.15 → 0.81 / 1.00 | 0.82 / 0.43 → **0.58** / 1.00 | no (held-out precision below 0.70) |
| trumpet | tested ≥ 0.50 | 0.79 / 0.93 → 0.80 / 0.86 | 0.74 / 1.00 → 0.76 / 1.00 | yes |
| cello | tested ≥ 0.55 | 0.74 / 0.95 → 0.81 / 0.81 | 0.71 / 0.89 → 0.74 / 0.89 | yes |
| bass | raise | no threshold reached precision 0.80 with recall 0.70 (best 0.78 / 0.37) | | no |
| organ | raise | no threshold reached it (best 0.67 / 0.40) | | no |

## Before / after on both DJ clip tests (judging only)

Both 500-clip sets were already read by the threads that built them, so they were not used to pick anything here. The
graph exports those runs saved (round 1: run 37396016931, round 2: run 37406166208) were re-scored with main's display
code and with this branch's (run 37421331227, `judge/`): same analysis, two displays. That gives exactly what the app
shows, because the change reads stored evidence only.

| Tag | Round 1 main P / R | Round 1 branch P / R | Round 2 main P / R | Round 2 branch P / R |
|---|---|---|---|---|
| drums | 0.86 / 0.97 ✅ | 0.86 / 0.97 ✅ | 0.91 / 0.94 ✅ | 0.91 / 0.94 ✅ |
| voice | 0.89 / 0.96 ✅ | 0.89 / 0.96 ✅ | 0.88 / 0.90 ✅ | 0.88 / 0.90 ✅ |
| synthesizer | 0.94 / 0.94 ✅ | 0.94 / 0.94 ✅ | 0.89 / 1.00 ✅ | 0.89 / 1.00 ✅ |
| piano | 1.00 / 0.87 ✅ | 1.00 / 0.87 ✅ | 1.00 / 0.87 ✅ | 1.00 / 0.87 ✅ |
| cymbals | 0.94 / 0.98 ✅ | 0.94 / 0.98 ✅ | 0.91 / 0.94 ✅ | 0.91 / 0.94 ✅ |
| **guitar** | 1.00 / 0.30 ❌ | **0.94 / 0.97** ✅ | 1.00 / 0.10 ❌ | **1.00 / 0.95** ✅ |
| **violin** | 0.60 / 0.25 ❌ | **0.73 / 0.92** ✅ | 0.50 / 0.13 ❌ | **0.71 / 1.00** ✅ |
| trumpet | 0.65 / 0.77 ❌ | 0.65 / 0.77 ❌ | 0.50 / 0.89 ❌ | 0.52 / 0.83 ❌ |
| organ | 0.62 / 0.95 ❌ | 0.62 / 0.95 ❌ | 0.48 / 0.88 ❌ | 0.48 / 0.88 ❌ |
| saxophone | 1.00 / 0.29 ❌ | 1.00 / 0.29 ❌ | 0.88 / 0.28 ❌ | 0.88 / 0.28 ❌ |
| bass | 0.21 / 0.67 ❌ | 0.21 / 0.67 ❌ | 0.43 / 0.67 ❌ | 0.43 / 0.67 ❌ |
| **at 70/70** | **5 / 11** | **7 / 11** | **5 / 11** | **7 / 11** |
| at 60/60 | 7 / 11 | 9 / 11 | 5 / 11 | 7 / 11 |

No tag that passed on main fails on the branch, on either set, at either bar. Violin only just clears 0.70 on both
(11 / 15 and 15 / 21 shown were right).

**Short of 70/70:**
- trumpet: precision 0.65 and 0.52 (−0.05 and −0.18); recall is fine. The 0.50 floor removed only 2 false alarms.
- organ: precision 0.62 and 0.48 (−0.08 and −0.22). Most false organs come from a head whose scores do not separate
  real from false organs on the calibration clips.
- saxophone: recall 0.29 and 0.28 (−0.41 and −0.42). The head that would find them failed the held-out precision check.
- bass: precision 0.21 and 0.43 (−0.49 and −0.27). On full mixes the bass head fires on a third of all clips.

These four are what the retrained fusion heads (the "Stronger sound identification models" thread, 14,912 OpenMIC
train clips) should be compared on, using these same tables.

**Real DJ tracks (Beatport, no tag truth):** cello false tags drop from 25 to 7 clips (round 1) and from 24 to 10
(round 2). The new rules add guitar to 1 and 4 clips and violin to 3 (round 2), out of 500 each. Drums on trance are
unchanged; this PR does not touch them.

## Not done here
- Key (minor called major): moved to the "Fix key detection" thread. A first calibration run also analysed 400 spare
  Beatport tracks for key; 198 of them are in PR #121's held-out set, so those outputs were deleted unread and the set
  was dropped.
- Tempo: PR #116 (merged).

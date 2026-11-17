# Piano on 10-20 s clips: the tagger and the other detectors must agree (2026-11-07)

One policy change: `trust: "both"` on the tagger's `piano` entry in `src/audio/taggerPolicy.json`. The tagger only decides
piano on 10-20 s clips (under 10 s the other detectors decide, from 20 s up the long rule is `detectors`), so this only
changes those clips: piano now shows there when the tagger **and** the other detectors (the CLAP piano head) both say
piano, instead of the tagger alone. Nothing was retrained and no cutoff moved.

## How it was chosen (no test clips used to pick)
- Data: the saved app-path model outputs of the FSD50K eval rescore with the tail window (10,231 clips,
  `reports/scoreboard/private/tail-window-2026-11-07`), re-decided with the app's own display chain by
  `scripts/app-path-whatif.ts` on main `3ee05f0`. No audio, nothing uploaded.
- Split: uploader groups hashed into two halves (as `eval-tag.ts` does). Four discrete options were compared on the
  **pick half only**: today (tagger alone), `minSeconds: 20` (other detectors decide), `trust: "both"`, `trust: "either"`.
  "both" and "detectors" scored the same (the existing `shortPianoVeto` makes them equivalent on these clips); "either"
  was identical to today. "both" was taken because it keeps `minSeconds` and the tagger's "clearly not piano" check.
- Then confirmed once on the **check half**, which was not looked at while choosing.

## Result (FSD50K eval app path, piano: precision / recall, tp/fp/fn)
| | today | this change |
| --- | --- | --- |
| pick half (chosen here) | 0.145 / 0.808 (21/124/5) | 0.677 / 0.808 (21/10/5) |
| **check half (confirm)** | 0.193 / 0.740 (37/155/13) | **0.829 / 0.680** (34/7/16) |
| all clips | 0.172 / 0.763 (58/279/18) | 0.764 / 0.724 (55/17/21) |
| clips under 10 s | 0.920 / 0.793 | unchanged |
| clips 10-20 s | 0.029 / 0.889 (8/268/1) | 0.455 / 0.556 (5/6/4) |
| clips 20-30 s | 0.364 / 0.444 | unchanged |

Every other labelled tag in the replay is unchanged (only `source:piano` differs). False piano tags on 10-20 s clips go
from 268 to 6; 3 of the 9 real pianos in that band are lost.

## What it does not fix
- Piano still fails the 60/30 board: the free-tag-set row (P 0.21 / R 0.20) and the NSynth row (P 0.22) are on clips
  under 10 s, or (Iowa piano notes) on audio that is no longer in the project folder, and this change cannot move them.
  The false-alarm caps on idmt-bass and sasse-test are also unchanged. Pass count unchanged.
- The full-mix Jamendo piano evidence (recordings of 10 s or more) also counts as "the other detectors" in the app; the
  replay does not run Jamendo, so in the app a few more 10-20 s clips may keep piano than measured here.
- Cost: piano that only plays in the last few seconds of a 10-20 s clip (which the tagger never hears) no longer shows
  unless the tagger also heard piano (`tagRouting.expected.json`: `15s-end`).

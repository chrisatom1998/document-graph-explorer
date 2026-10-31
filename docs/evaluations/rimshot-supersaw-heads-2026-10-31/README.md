# Rimshot and supersaw heads (Oct 31 2026)

The app never showed rimshot or supersaw. Neither had a trained detector, so both could only show from the raw Music CLAP
prompt comparison, which needs a raw similarity of 0.50 on clips longer than 2.25 s (supersaw is also in
`src/audio/unverifiedBlocked.json`). On the fresh test sets that path fired on 0 clips for either tag.

## Training (training clips only, $0, run in the container)

- Clips: `benjamin-paine/freesound-laion-640k` mirror, picked by title/tags (`scripts/select.py`), dropping every id and
  uploader in the private exclude list (plus the finder additions), the reserved-uploader hash rules and every
  `reserved-test-families.json`. Fetched with row-group range reads (`scripts/fetch.py`); negatives come from the same row
  groups (mostly the same packs' other drum hits and synths) plus background clips.
- Features: the app's own q8 CLAP fingerprint (`scripts/embed-clap.mjs`, first 10 s at 48 kHz).
- Heads: logistic regression (`scripts/train_heads.py`). C and the hard-negative weight are chosen on 5-fold out-of-fold
  scores of the real clips, folds by uploader. Cutoff: lowest out-of-fold score with precision >= 0.70, never below 0.5.
  Supersaw renders (`scripts/synth_saw.py`, 160 detuned saw stacks, 640 other synths) were tried and lost out of fold, so
  the supersaw head is real clips only (shipped in its own PR after rimshot, #262). Rimshot was trained
  with `--one-shot` (78 of its 88 training positives are 2.25 s or shorter).

| head | real clips (positives, uploaders) | hard negatives | choice | out-of-fold at cutoff |
|---|---|---|---|---|
| rimshot | 2,131 (84, 41) | 345 drum hits | C 0.3, weight 1, cutoff 0.8187, oneShot | 48 of 84 found, 20 false alarms |
| supersaw | 2,061 (14, 10) | 518 synths | C 0.3, weight 3, cutoff 0.8981 | 6 of 14 found, 1 false alarm |

## Judged once on the fresh test sets (app-path scorer)

`app_tags_v2.ts` -> `real_app_filter.py` -> `app_clap_score.py` on the app q8 fingerprints of all 25,535 test clips. The
baseline run at main reproduces the published `app-clap.json` exactly (every tag, every set). Each head was judged once; no
cutoff was fitted on these clips.

| tag | heard-reserved | free-tag-set test | false alarms elsewhere | 60/30 |
|---|---|---|---|---|
| rimshot | 3 of 5, 2 false alarms (P 0.60, R 0.60) | 2 of 4, 0 false alarms | FSD50K eval 0.25%, NSynth test 0.95%, SASS-E 0 | pass |
| supersaw | 2 of 5, 1 false alarm (P 0.67, R 0.40) | no positives, 0 of 219 false alarms | none | pass |

No other tag changed with either head. Supersaw was re-scored on main after #262 merged: same numbers, only supersaw changes. Both pass close to the line (rimshot precision exactly 0.60, NSynth false alarms
just under the 1% cap), so a relabel of one test clip could flip them.

Test clips, their scores and the exclude list stay private and are not in this folder.

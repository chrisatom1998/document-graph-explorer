# All tags on full songs: plan, fixed before any result is read (2026-10-06)

Chris asked about every tag, not just the 11 the DJ clip tests score. The app ships 111 tags. Their only scores so far
come from short clips (one-shots, loops, short recordings) in the open-vocab scorecard (round 19). This set measures the
tags that public full-song labels exist for.

## Data

- 600 MTG-Jamendo split-0 **validation** songs, middle 30 s, labelled for 26 app tags
  (`scripts/all-tags/select-jamendo-val.py`, `jamendo-val-manifest.json`).
- Why validation: split-0 test is the round 3 held-out set (PR #121) and stays judge-only. Split-0 train is what
  Essentia's Jamendo instrument model was fitted on. No DGE head on main was trained on MTG-Jamendo audio.
- The audio model being trained in PR #129 (run 5) trains on split-0 train AND validation. So this set can score and
  calibrate only the app as it is on main. It can't judge that model, and thresholds picked here apply to the current
  heads only.
- Labels are uploader instrument tags. Two production tags come from genres that imply them: chiptune synth
  (chiptune, 8bit) and choir (choir, choral).
- An untagged instrument counts as a weak absent. Uploaders under-tag, so precision here is a **floor**. Recall is the
  reliable number.
- The set is split into halves by artist hash: "pick" and "check".

## What gets reported

- For each of the 26 tags, on the app as merged on main: recall and the precision floor, with 95% artist-bootstrap
  intervals, overall and per half.
- A tag with fewer than 20 tagged songs is reported as "too few to judge" rather than pass or fail.
- Every other app tag is reported as "no full-song labels". Its only score is the short-clip one.

## Threshold changes allowed (lower-only)

Weak absents can't justify hiding a tag, so this set can only make a tag show more often.

1. A tag is a candidate only if its recall is below 0.70 on the pick half.
2. A candidate rule shows the tag when one stored score reaches a threshold t, on whole 10 s windows of recordings at
   least 10 s long. The stored scores that may be used are the fusion head probability, the Jamendo model's native
   score, and the AST/CLAP native score.
3. t is chosen on the pick half from 0.05 to 0.95 in steps of 0.05. The choice is the lowest t that keeps the precision
   floor at or above 0.70 there. If no t does, the tag gets no rule.
4. A rule is adopted only if, on the check half, recall rises by at least 0.10 and the precision floor stays at or
   above 0.70.
5. An adopted rule must also not make any tag that passes 70/70 on either DJ clip test fall below that bar. This is
   checked by re-scoring the saved exports (`dj-fix-judge.yml`). The DJ tests only judge; nothing is tuned on them.

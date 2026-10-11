# Bigger teacher probe

Round 11's teacher (an MLP over frozen CED-base features, 86M parameters) coached the app's small tagger into bass guitar
and machine ambience. This tests whether bigger pretrained listeners make a better teacher for the tags that still miss
with plenty of training clips (the "model limit" group in reports/ranked-tags-2026-10-10).

| Listener | Size | Licence | Features |
|---|---|---|---|
| CED-base (round 11) | 86M | Apache 2.0 | 768 embedding + 527 AudioSet logits |
| Dasheng-0.6B | 630M | Apache 2.0 | last-layer mean and max, layer 16 mean (3,840) |
| MERT-v1-330M | 315M | CC BY-NC 4.0 | time means of layers 6, 12, 18, 24 (4,096) |

Only the teacher uses these listeners. The app keeps its small tagger, so its download size does not change.

1. `features.py` on Hugging Face Jobs (l4x1), training audio only, same inputs and ids as `round11/teacher-features.py`:
   run9/v1, empty-tags/v1 and round 10's commercial training packs, written to the private bucket under `bigteacher/`.
2. `MODE=local features.py` in the project container for the held-out clips (judge audio never leaves it).
3. `round11/fit-teacher.py --feats ced|das|mert|ced+das|... --extra <bigteacher dir> --exclude <private exclude list> --zscore`
   fits each teacher on the same clips (test-leak ids dropped), then `round11/score-teacher.py` scores it on the
   held-out clips with the same pass rule as every round.

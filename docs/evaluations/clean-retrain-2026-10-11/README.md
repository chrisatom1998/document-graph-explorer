# Clean retrain of the Mac-trained sound detectors (2026-10-11)

The 28 CLAP detectors in `public/sound-model/learned.json` for FSD50K-mapped sounds were trained on Chris's Mac by
`scripts/train-with-extras.py`, which read FSD50K **eval** (a judge set) and refit each head on train+test. This change
refits them in the cloud from training clips only and swaps in the 12 that pass a fair test on clips they never saw.

**All numbers are new scores on the rebuilt test sets and are not comparable with the old scoreboard.**

How:
- Training: FSD50K dev (22,598 clips) + round 9 training clips (17,966), CLAP embeddings computed in the cloud
  (`scripts/audio-model/clean-heads/`). Every training id was filtered in the project container against the fresh
  exclude list (43,248 of 63,007 candidates kept; FSD50K eval ids, test uploaders and reserved uploaders dropped).
- Head: logistic regression on the L2-normalised CLAP embedding, as on the Mac. Two cutoffs come from 5-fold
  out-of-fold training scores (grouped by uploader): precision-first (lowest cutoff with precision >= 0.6) and balanced
  (best min(P, R)). Neither cutoff looks at a test clip.
- Judges: the scoreboard's fresh test sets, scored in the project container only (test audio never left it):
  FSD50K eval (10,231 clips), free-tag-set **test half** (1,050 clips; the locked holdout half is not used), NSynth
  test (4,096), SASSE test (2,702) and IDMT bass (3,623 of 5,306 clips; the rest were unreadable in the project
  folder). Labels, set rules and the 1% false-alarm cap are the scoreboard's. Clip score = max over 10 s windows.
- Ship line 60/30: precision >= 0.60 and recall >= 0.30 on every set with 5+ positives, at least one of them with
  negatives, and at most 1% false alarms on a set with fewer than 5 positives and 50+ negatives.
- Fair best of both: clips go to half A or B by uploader / pack / instrument (as the scoreboard's
  `precision_first.py`). The cutoff is picked on one half (precision-first unless it fails there and balanced passes)
  and judged only on the other half. A head is swapped only when this passes both ways.
- Heads that fail keep their old weights and are marked **unverified** (they still carry the FSD50K eval leak).
- Old FSD50K eval numbers are inflated: those heads trained on those clips.

Swapped: crash cymbal, crowd ambience, finger snap, harmonica, harp, snare, tabla, trumpet, vinyl scratch, vocal
laugh, whisper, whoosh. Finger snap and trumpet are decided by the tagger on long recordings (`taggerPolicy.json`),
so their swap mostly removes leaked weights.

No regression on the app path (scoreboard `latest.json`, main c870cfe): snare, trumpet and vinyl scratch pass 60/30
in the app today and their clean heads pass the fair test. Rain ambience also passes today; its clean head fails, so
it keeps its old head and nothing changes.

Precision / recall at the shipped cutoff, on each counted set (false alarms shown for sets with no positives):

| sound | old head (biased on FSD50K) | clean head | clean cutoff | fair 60/30 | result |
|---|---|---|---|---|---|
| accordion | FSD50K 0.74/0.90 | FSD50K 0.57/0.70 | balanced 0.914 | no | kept old, unverified |
| acoustic guitar | FTS 1.00/0.83, FSD50K 0.86/0.68, IDMT 54 false alarms of 3623, NSynth 0.53/0.62, SASSE 7 false alarms of 2702 | FTS 1.00/1.00, FSD50K 0.80/0.87, IDMT 339 false alarms of 3623, NSynth 0.54/0.48 | precision-first 0.772 | no | kept old, unverified |
| bird ambience | FTS 1.00/0.68, FSD50K 0.73/0.56 | FTS 1.00/0.51, FSD50K 0.92/0.34 | balanced 0.979 | yes | held (tagger kept, see below) |
| cowbell | FTS 1.00/0.23, FSD50K 0.81/0.81 | FTS 1.00/0.12, FSD50K 0.83/0.68 | precision-first 0.504 | no | kept old, unverified |
| crash cymbal | FTS 1.00/0.92, FSD50K 0.41/0.82 | FTS 1.00/0.39, FSD50K 0.77/0.75 | precision-first 0.994 | yes | swapped |
| crowd ambience | FTS 1.00/0.83, FSD50K 0.60/0.85 | FTS 1.00/0.50, FSD50K 0.92/0.49 | precision-first 0.985 | yes | swapped |
| drums | FTS 0.87/0.85, FSD50K 0.09/0.80, SASSE 40 false alarms of 2702 | FTS 0.00/0.00, FSD50K 0.00/0.00 | precision-first 0.994 | no | kept old, unverified |
| electric guitar | FSD50K 0.92/0.72, IDMT 1581 false alarms of 3623, NSynth 0.15/0.66 | FSD50K 0.98/0.25, IDMT 66 false alarms of 3623, NSynth 0.00/0.00 | precision-first 0.980 | no | kept old, unverified |
| finger snap | FTS 1.00/1.00, FSD50K 0.51/0.90 | FTS 1.00/1.00, FSD50K 0.68/0.73 | precision-first 0.958 | yes | swapped |
| gong | FTS 3 false alarms of 219, FSD50K 0.69/0.79 | FTS 4 false alarms of 219, FSD50K 0.66/0.78 | precision-first 0.971 | no | kept old, unverified |
| harmonica | FSD50K 0.88/0.88 | FSD50K 0.71/0.97 | precision-first 0.752 | yes | swapped |
| harp | FSD50K 0.76/0.84 | FSD50K 0.78/0.81 | precision-first 0.846 | yes | swapped |
| kick | FTS 1.00/0.06, FSD50K 1.00/0.12 | FTS 0.00/0.00, FSD50K 1.00/0.09 | precision-first 0.998 | no | kept old, unverified |
| mallet instrument | FTS 1.00/0.46, FSD50K 0.78/0.80, NSynth 0.39/0.66, SASSE 1.00/0.05 | FTS 1.00/0.16, FSD50K 0.96/0.56, NSynth 0.80/0.12, SASSE 1.00/0.00 | precision-first 0.931 | no | kept old, unverified |
| organ | FTS 0.71/0.42, FSD50K 0.36/0.46, IDMT 2 false alarms of 3623, NSynth 0.69/0.80 | FTS 0.00/0.00, FSD50K 0.50/0.54, NSynth 0.97/0.23 | precision-first 0.973 | no | kept old, unverified |
| piano | FTS 1.00/0.75, FSD50K 0.74/0.80, IDMT 48 false alarms of 3623, NSynth 0.32/0.93, SASSE 23 false alarms of 2702 | FTS 1.00/0.45, FSD50K 0.98/0.66, IDMT 1 false alarms of 3623, NSynth 0.11/0.08, SASSE 4 false alarms of 2702 | balanced 0.981 | no | kept old, unverified |
| rain ambience | FTS 1.00/0.47, FSD50K 0.70/0.86 | FTS 1.00/0.47, FSD50K 0.61/0.95 | precision-first 0.822 | no | kept old, unverified |
| siren | FTS 1.00/0.36, FSD50K 0.10/0.91 | FTS 0.00/0.00, FSD50K 0.96/0.49 | precision-first 0.998 | no | kept old, unverified |
| snare | FTS 1.00/0.27, FSD50K 0.98/0.39 | FTS 1.00/0.55, FSD50K 0.81/0.60, NSynth 17 false alarms of 4096, SASSE 1 false alarms of 2702 | precision-first 0.856 | yes | swapped |
| strings | FTS 1.00/0.57, FSD50K 0.92/0.79, NSynth 0.97/0.83 | FTS 0.98/0.62, FSD50K 0.89/0.71, NSynth 0.81/0.39 | precision-first 0.500 | no | kept old, unverified |
| tabla | FSD50K 0.94/0.98 | FSD50K 0.84/0.91 | precision-first 0.732 | yes | swapped |
| trumpet | FTS 0.87/1.00, FSD50K 0.72/0.84 | FTS 0.95/0.95, FSD50K 0.70/0.84 | precision-first 0.957 | yes | swapped |
| vinyl scratch | FSD50K 0.24/0.85 | FSD50K 0.91/0.91 | precision-first 0.595 | yes | swapped |
| vocal gasp | FSD50K 0.26/0.90 | FSD50K 0.47/0.67 | precision-first 0.989 | no | kept old, unverified |
| vocal laugh | FTS 1.00/0.83, FSD50K 0.61/0.77 | FTS 1.00/0.83, FSD50K 0.68/0.71 | precision-first 0.674 | yes | swapped |
| water ambience | FTS 1.00/0.42, FSD50K 0.48/0.85 | FTS 1.00/0.11, FSD50K 0.64/0.41 | precision-first 0.966 | no | kept old, unverified |
| whisper | FSD50K 0.16/0.89 | FSD50K 0.72/0.79 | precision-first 0.787 | yes | swapped |
| whoosh | FSD50K 0.84/0.58 | FSD50K 0.63/0.84 | precision-first 0.710 | yes | swapped |

Free-tag-set (FTS) has no negatives for ambience and effect tags, so precision there reads 1.00 by construction.
Clean heads lose recall on sample-pack and NSynth audio (drums, electric guitar, mallet instrument, piano, strings,
acoustic guitar): the Mac heads also trained on Chris's sample library, which only exists on the Mac. Those stay
unverified until cloud training data covers sample packs and single notes.

Bird ambience: the clean head passes the fair test (FSD50K 0.92/0.34, FTS 1.00/0.51), but the tagger the app uses
today passes with more room on the same sets (FSD50K 0.785/0.42, FTS 1.00/0.68), so the tagger stays.

`report.json` holds every set's counts, both halves of the fair test, and a weight checksum per swapped head that
`src/audio/soundTagBar.test.ts` checks against `learned.json`.

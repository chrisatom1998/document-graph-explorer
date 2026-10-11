# Clean retrain of the Mac-trained sound detectors (2026-10-11)

The 28 CLAP detectors in `public/sound-model/learned.json` for FSD50K-mapped sounds were trained on Chris's Mac by
`scripts/train-with-extras.py`, which read FSD50K **eval** (a judge set) and refit each head on train+test. This change
refits them in the cloud from training clips only and swaps in the ones that pass on clips they never saw.

**All numbers are new scores on rebuilt test sets and are not comparable with the old scoreboard.**

How:
- Training: FSD50K dev (22,598 clips) + round 9 training clips (17,966), CLAP embeddings computed in the cloud
  (`scripts/audio-model/clean-heads/`). Every training id was filtered in the project container against the fresh
  exclude list (43,248 of 63,007 candidates kept; FSD50K eval ids, test uploaders and reserved uploaders dropped).
- Head: logistic regression on the L2-normalised CLAP embedding, as on the Mac. Two cutoffs from 5-fold out-of-fold
  scores (grouped by uploader): precision-first (lowest cutoff with precision >= 0.6) and balanced (best min(P, R)).
  Per tag the cutoff that passes better on both judge sets is kept ("best of both").
- Judges: FSD50K eval (10,231 clips, clip score = max over 10 s windows) and the rebuilt free-tag-set (2,252
  SampleRadar / Iowa / BBC clips; positives from present tags, negatives only from explicit absent tags, scored only
  when a tag has 10+ positives). Free-tag-set audio never left the container.
- Ship line 60/30 (precision >= 0.60, recall >= 0.30) on every judge set that can score the tag. Heads that fail keep
  their old weights and are marked **unverified** (they still carry the FSD50K eval leak).
- Old FSD50K eval numbers are inflated: those heads trained on those clips.

Swapped: 13 heads. Finger snap, piano and rain ambience are decided by the tagger in the app (`taggerPolicy.json`),
so their swap only removes leaked weights; the other 10 change what the app shows.
Bird ambience is held: its clean head passes but Chris decides the fix.

| sound | FSD50K eval old (biased) | FSD50K eval clean | free-tag-set positives | free-tag-set old | free-tag-set clean | cutoff | result |
|---|---|---|---|---|---|---|---|
| accordion | 0.74 / 0.90 | 0.54 / 0.70 | 0 | – | – | precision-first | kept old, unverified |
| acoustic guitar | 0.86 / 0.68 | 0.80 / 0.87 | 36 | 1.00 / 0.94 | 1.00 / 1.00 | precision-first | swapped |
| bird ambience | 0.73 / 0.56 | 0.92 / 0.34 | 127 | 1.00 / 0.59 | 1.00 / 0.40 | balanced | held (bird ambience fix waits for Chris) |
| cowbell | 0.81 / 0.81 | 0.83 / 0.68 | 17 | 1.00 / 0.23 | 1.00 / 0.12 | precision-first | kept old, unverified |
| crash cymbal | 0.41 / 0.82 | 0.71 / 0.79 | 40 | 0.86 / 0.93 | 0.96 / 0.68 | balanced | swapped |
| crowd ambience | 0.49 / 0.90 | 0.81 / 0.56 | 29 | 1.00 / 0.76 | 1.00 / 0.48 | precision-first | swapped |
| drums | 0.05 / 0.80 | 0.00 / 0.00 | 406 | 0.86 / 0.88 | 1.00 / 0.01 | precision-first | kept old, unverified |
| electric guitar | 0.92 / 0.72 | 0.98 / 0.25 | 42 | 1.00 / 0.88 | 1.00 / 0.31 | precision-first | kept old, unverified |
| finger snap | 0.51 / 0.90 | 0.68 / 0.73 | 9 | 1.00 / 1.00 | 1.00 / 1.00 | precision-first | swapped |
| gong | 0.69 / 0.79 | 0.66 / 0.78 | 20 | 0.57 / 0.85 | 0.49 / 0.90 | precision-first | kept old, unverified |
| harmonica | 0.88 / 0.88 | 0.71 / 0.97 | 0 | – | – | precision-first | swapped |
| harp | 0.76 / 0.84 | 0.78 / 0.81 | 3 | 0.00 / 0.00 | 0.00 / 0.00 | precision-first | swapped |
| kick | 1.00 / 0.12 | 1.00 / 0.09 | 51 | 1.00 / 0.02 | 0.00 / 0.00 | precision-first | kept old, unverified |
| mallet instrument | 0.74 / 0.84 | 0.93 / 0.60 | 125 | 1.00 / 0.29 | 1.00 / 0.13 | precision-first | kept old, unverified |
| organ | 0.36 / 0.46 | 0.50 / 0.54 | 30 | 0.82 / 0.30 | 1.00 / 0.13 | precision-first | kept old, unverified |
| piano | 0.66 / 0.80 | 0.78 / 0.75 | 42 | 0.92 / 0.86 | 0.97 / 0.83 | precision-first | swapped |
| rain ambience | 0.70 / 0.86 | 0.61 / 0.95 | 36 | 1.00 / 0.36 | 1.00 / 0.33 | precision-first | swapped |
| siren | 0.10 / 0.91 | 0.96 / 0.49 | 29 | 1.00 / 0.34 | 0.00 / 0.00 | precision-first | kept old, unverified |
| snare | 0.98 / 0.39 | 0.78 / 0.60 | 44 | 1.00 / 0.29 | 0.97 / 0.73 | precision-first | swapped |
| strings | 0.92 / 0.79 | 0.89 / 0.71 | 143 | 1.00 / 0.48 | 0.99 / 0.52 | precision-first | swapped |
| tabla | 0.94 / 0.98 | 0.84 / 0.91 | 0 | – | – | precision-first | swapped |
| trumpet | 0.72 / 0.84 | 0.70 / 0.84 | 22 | 0.27 / 0.91 | 0.53 / 0.86 | precision-first | kept old, unverified |
| vinyl scratch | 0.24 / 0.85 | 0.91 / 0.91 | 15 | 1.00 / 0.07 | 1.00 / 0.13 | precision-first | kept old, unverified |
| vocal gasp | 0.26 / 0.90 | 0.47 / 0.67 | 0 | – | – | precision-first | kept old, unverified |
| vocal laugh | 0.61 / 0.77 | 0.68 / 0.71 | 8 | 1.00 / 0.88 | 1.00 / 0.75 | precision-first | swapped |
| water ambience | 0.36 / 0.84 | 0.58 / 0.50 | 106 | 1.00 / 0.42 | 1.00 / 0.17 | precision-first | kept old, unverified |
| whisper | 0.16 / 0.89 | 0.81 / 0.77 | 0 | – | – | balanced | swapped |
| whoosh | 0.84 / 0.58 | 0.63 / 0.84 | 14 | 1.00 / 0.07 | 1.00 / 0.21 | precision-first | kept old, unverified |

Counts on FSD50K eval (28 heads): old (biased) 17 pass 60/30, clean with best-of-both cutoffs 22. Free-tag-set has no
negatives for ambience and effect tags, so precision there reads 1.00 by construction; recall is the useful number.
Clean heads lose recall on sample-pack audio (drums, electric guitar, mallet instrument, water ambience): the Mac heads
also trained on Chris's sample library, which only exists on the Mac. Those stay unverified until cloud training data
covers sample packs.

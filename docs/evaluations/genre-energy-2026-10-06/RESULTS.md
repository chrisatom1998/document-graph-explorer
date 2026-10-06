# Genre and energy tags (2026-10-06)

Both come from the EffnetDiscogs model the app already loads for instruments: no new model download. The genre head
reads its 400 Discogs style scores, and the energy head reads its 1280-d embedding. Together they add 76 KB of JSON
(`src/audio/genreEnergyModel.json`). Fitting, thresholds and judging are done by `scripts/genre-energy/fit.py`. The
full numbers are in `report.json`.

The bar is 70% precision and 70% recall. A label that misses it on the judging tracks still shows, marked "maybe".

## Data

| Set | Tracks | Used for |
| --- | --- | --- |
| beatport-tune | 652 | Fitting the genre head and its thresholds (5-fold, grouped by artist). This is GiantSteps tempo previews not in round 1, plus MTG-key previews not in round 2 with an odd round-3 hash. |
| beatport-judge | 1,000 | Genre judging only: the round 1 (GiantSteps) and round 2 (MTG key) tracks. |
| jamendo-fit | 1,114 | Fitting the energy head and its thresholds: MTG-Jamendo split-0 train and validation tracks tagged high or low energy. |
| jamendo-judge | 395 | Energy judging only: split-0 test tracks, excluding round 3's 500. |

Energy is judged against Jamendo mood tags, not a loudness or tempo proxy.

- **High:** energetic, powerful, fast, upbeat, party, sport, action, heavy.
- **Low:** calm, relaxing, meditative, soft, slow.

Tracks with tags on both sides were left out.

Features mirror the app's full mode: the mean over its 10 s windows with a 5 s hop. The fast mode (one middle window)
is reported too. The 1,000 judging tracks were scored on Hugging Face Jobs by the hf-eval `genre-energy` task. Its
style scores match this machine's run exactly on the 300 tracks scored in both places.

## Energy (judging tracks, full mode)

| Level | Precision | Recall | Passes 70/70 |
| --- | --- | --- | --- |
| high (score >= 0.62) | 0.91 | 0.76 | yes |
| low (score <= 0.37) | 0.84 | 0.82 | yes |
| medium (between) | 39 of 395 tracks | | always "maybe" |

- **Fast mode:** high P 0.88, R 0.73; low P 0.79, R 0.80.
- **Cross-validation on the fitting tracks:** high P 0.85, R 0.75; low P 0.84, R 0.75.
- **Baselines on the fitting tracks:**
  - A loudness-only baseline (mean and spread of 1 s RMS) reaches P 0.63 (high) and 0.59 (low) at similar recall.
  - Essentia's own mtg_jamendo_moodtheme head (trained on these tracks, so in-sample) reaches P 0.87 and 0.86.
- **Sanity check on Beatport tracks:** they read as high energy. 87-100% of the hard dance, psy, trance, drum & bass
  and dubstep tracks are high. Chill-out is 50% low.

## Genre (judging tracks, full mode)

How the genre is chosen:

1. **Electronic check.** Only tracks with at least half of their style mass under Electronic or Hip Hop get a genre
   at all. That cut keeps 98% of the tuning tracks.
2. **Specific genre.** The track shows its most probable Beatport genre when that genre clears its threshold.
3. **Family.** Otherwise it shows the most probable family (house, techno, trance or downtempo) when the family's
   summed probability clears the family's threshold.
4. **Never named alone.** Electro, progressive and tech house, minimal and electronica are never named on their own.
   Their tracks fall back to their family.

| Label | Precision | Recall | Shown | Tracks | 70/70 |
| --- | --- | --- | --- | --- | --- |
| drum & bass | 0.81 | 0.91 | 163 | 145 | yes |
| psy trance | 0.90 | 0.79 | 50 | 57 | yes |
| trance | 0.76 | 0.90 | 107 | 145 | yes |
| trance (family) | | | | | yes |
| hip hop | 0.68 | 0.72 | 41 | 39 | maybe |
| dubstep | 0.67 | 0.72 | 117 | 108 | maybe |
| hard dance | 0.67 | 0.76 | 42 | 37 | maybe |
| house (family) | 0.63 | 0.71 | 227 | 218 | maybe |
| techno (family) | 0.66 | 0.54 | 88 | 108 | maybe |
| deep house | 0.73 | 0.21 | 15 | 53 | maybe |
| breaks | 0.59 | 0.29 | 27 | 55 | maybe |
| chill out | 0.36 | 0.50 | 36 | 26 | maybe |
| downtempo (family) | 0.80 | 0.30 | 10 | 98 | maybe |

- **Overall:** 923 of the 1,000 tracks get a label. 488 of those are the exact Beatport genre, and another 289 are the
  right family.
- **Fast mode:** about 4 points lower on most labels.
- **Music outside electronic:** without the electronic check, 88% of non-electronic MTG-Jamendo tracks (rock,
  classical, soundtrack…) got an electronic genre. With it, 22 of 191 non-electronic judging tracks do: 19 chill-out
  or downtempo, and 3 others.

## Where it shows

- **Track card:** a Genre row and an Energy row, with "maybe" when untested. Technical details list the closest
  Discogs styles.
- **Graph:** a "same genre" link kind, filterable, weighted lower for "maybe" labels. Previews never link.
- **Search:** genre and energy words ("high energy", "chill", "techno"…).
- **DJ assistant:** its prompt lists the genre and energy terms.

# DJ clip accuracy: 500 + 500 ten-second clips (2026-10-06)

**Tested:** main at 5673326 (includes #97, #112, #113 and #114). This branch adds only the eval scripts, so `src` is
identical to main. The app was built and run in headless Chromium on GitHub Actions (run 37396016931), and every clip
was uploaded through the real Add-files flow in full analysis mode. Pass bar: precision and recall both at least 0.60.

## What was tested

No single public set has both instrument labels and real DJ tracks, so two sets of 500 clips were used:

| Set | Clips | Truth | Used for |
|---|---|---|---|
| OpenMIC-2018 test split (`openmic-manifest.json`) | 500 × 10 s, 371 artists | Crowd instrument labels (present / absent; a missing pair is not scored) | Sound-tag precision and recall |
| GiantSteps tempo (`giantsteps-manifest.json`) | 500 × middle 10 s of Beatport EDM previews | Crowd-corrected BPM (Schreiber & Müller 2018) and Beatport genre | Tempo accuracy, plus a look at which tags show on real DJ tracks |

**The OpenMIC clips are clean.** No clip and no artist overlaps the 900 clips that #113 calibrated its thresholds on.
OpenMIC's fusion heads were fitted on the train split, and these clips come from the test split. Share-alike clips stay
a sealed reserve.

**The OpenMIC set is not mostly DJ music.** Clips in DJ genres were picked first, but after the exclusions above only
60 dance, hip-hop or beat genre clips and 83 general "Electronic" clips remained. The other 357 clips (experimental,
pop, rock, folk and others) fill the set. The DJ-genre-only scores below rest on 60 clips and are indicative only.

## Sound tags (OpenMIC, 500 clips)

All 500 clips were analysed, and every clip showed at least one tag. 95% intervals come from an artist bootstrap.

| Label | Positives / negatives | Precision (95% CI) | Recall (95% CI) | 60/60 |
|---|---|---|---|---|
| cymbals | 51 / 8 | 0.94 (0.87–1.00) | 0.98 (0.94–1.00) | pass |
| synthesizer | 34 / 16 | 0.94 (0.85–1.00) | 0.94 (0.86–1.00) | pass |
| drums | 31 / 20 | 0.86 (0.73–0.97) | 0.97 (0.89–1.00) | pass |
| voice | 24 / 10 | 0.89 (0.76–1.00) | 0.96 (0.86–1.00) | pass |
| piano | 23 / 12 | 1.00 | 0.87 (0.72–1.00) | pass |
| trumpet | 17 / 52 | 0.65 (0.40–0.86) | 0.77 (0.53–0.94) | pass |
| organ | 19 / 34 | 0.62 (0.43–0.81) | 0.95 (0.82–1.00) | pass (barely) |
| guitar | 30 / 13 | 1.00 | **0.30** (0.11–0.48) | fail |
| saxophone | 24 / 33 | 1.00 | **0.29** (0.09–0.57) | fail |
| violin | 12 / 24 | 0.60 | **0.25** (0.00–0.50) | fail |
| bass | 9 / 38 | **0.21** (0.07–0.39) | 0.67 | fail |

**7 of 11 labels pass.** Only 364 of the 500 clips carry any explicit label, so each label has 9 to 59 scored clips and
the intervals are wide. The tool shows 60 or more on all the DJ-critical labels (drums, synth, cymbals, voice).

The failures match what the 900-clip run on main found earlier:
- **Guitar** is the largest gap. Of 21 missed guitars, 15 had a guitar tag from MTG-Jamendo that the display policy
  hides. This is the same signal as the Jamendo guitar ≥ 0.40 follow-up that was offered on #113.
- **Saxophone** recall is 0.29, up from 0 on the earlier run. Precision is perfect. Eight misses had no sax signal
  from any model.
- **Bass** shows up as a false positive on 22 clips. In the earlier run, bass precision was 0.55.
- **Violin** has 12 positives. Eight misses had no violin signal from any model.

The DJ-genre subset (60 clips, `results/openmic-tags-dj-genres.txt`) gives drums 6/6 found with 2 false alarms,
synthesizer 6/6 with none, and cymbals 11/11. Organ is the only label with at least 3 positives that fails (P 0.40).
These are too few clips to rank labels.

## Tempo (GiantSteps EDM, 500 clips)

The tool reported a tempo on all 500 clips, and every reported tempo had confidence of at least 0.5, so all of them
feed tempo links.

| Metric | Result |
|---|---|
| Within 4% of the labelled BPM | **53.6%** (268 / 500) |
| Same, also allowing half, double, ⅓ or 3× tempo | 73.8% |
| Within 4% of either listener tempo (T1 or T2) | 73.4% |
| Errors at half tempo | 85 |
| Errors at about ⅔ tempo (e.g. 93 BPM for a 140 track) | 71 |
| Errors at about 4/3 tempo | 27 |

| Genre | Clips | Within 4% | Allowing half / double |
|---|---|---|---|
| drum & bass | 104 | **17%** (43 of the misses are half tempo) | 63% |
| dubstep | 57 | 56% | 79% |
| trance | 55 | 65% | 69% |
| techno | 43 | 72% | 79% |
| deep house / tech house / progressive / electro house | 68 | 79–86% | 84–91% |
| breaks | 18 | 44% | 61% |

Tempo is solid on four-on-the-floor house and techno and weak on broken beats. Drum & bass is mostly reported at half
tempo (87 for 174), which a DJ may accept. The ⅔ and 4/3 errors are wrong outright, and they are triplet-feel
confusions on 140–175 BPM tracks. Confidence does not separate right from wrong (median 1.00 when correct, 0.96 when
wrong), so a wrong tempo is shown and linked with high confidence.

## Tags on real DJ tracks (GiantSteps, no tag truth)

These are only a sanity check, because nobody labelled the instruments. Synthesizer showed on 446 of 500 clips (89%),
which is expected for EDM. Drums showed on only 254 (51%), even though almost every one of these tracks has a kick
drum. Drums were missing on 50 of 55 trance clips and 19 of 24 psy-trance clips, while showing on 41 of 43 techno clips.
Voice showed on 129. Some likely-wrong tags appeared: cello on 25 clips, banjo on 6 and mandolin on 3. Two clips
showed no tag.

## Files
- `results/openmic-tags.json` / `.txt`: per-label scores with intervals and where missed positives were found
- `results/openmic-tags-dj-genres.json` / `.txt`: the 60-clip DJ-genre subset
- `results/openmic-clips.json`: per-clip tags shown plus native model scores, for later calibration
- `results/giantsteps.json` / `.txt`: per-clip tempo estimate versus truth, per-genre summary, and tags shown
- Re-run: `.github/workflows/dj-clips-eval.yml` via workflow_dispatch on the branch that should be tested

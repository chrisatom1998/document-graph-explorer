# Hugging Face training plan for under-threshold sound tags

Investigation and scaffolding only. Nothing here starts a Hugging Face Job, AutoTrain run, Spaces GPU, or Inference Endpoint. `scripts/hf-sound-tags/plan.py` prints the job and stops. It launches only with `--launch` and `DGE_HF_LAUNCH_CONFIRM=yes`.

The numbers below are the gap snapshot in `docs/hf-sound-tag-training/gap.json`, built by `scripts/hf-sound-tags/gap_report.py` from the shipped policy, the committed evaluation rows, the clean-retrain fresh sets, merged PR quotes (#244, #245, #246, #248), and the public eval of `cmjatom/dge-all-tags-tagger-nc` at `410638a`. The live scoreboard (`reports/scoreboard/latest.json`) is not in this repo, so a tag with no row here was not re-scored on that private board for this document.

## Which bar the repo actually uses

Chris's note for this run said 60% precision and 60% recall for a full tag, and 45–60% on both for a maybe. The code has moved since that 60/60 rule:

| Gate | Where it lives | Rule |
|---|---|---|
| Full head | `SOUND_TAG_BAR` in `src/audio/confidentSoundSummary.ts`, `FULL` in `scripts/head-scorecard.py` and `scripts/add-maybe-heads.py` | precision and recall both ≥ 0.50 (since 2026-10-10; it was 0.60 from 2026-10-05) |
| Maybe head | `scripts/head-scorecard.py` | the lower of precision and recall ≥ 0.45. Below that the head should not show |
| Effect heads | `scripts/dj-effects/ship.py` | same 0.50 full bar; a head is left out when precision < 0.45 or recall < 0.30 |
| Tagger full tag | `tested` on `src/audio/tagger.ts` / `taggerPolicy.json` | precision ≥ 0.60 and recall ≥ 0.30 on every fresh set with 5+ positives, and ≤ 1% false alarms on a large set with fewer positives (since 2026-10-11) |
| 60/60 and 70/70 | `scripts/audio-model/clean-heads/fair-judge.py` | reported only. They do not decide whether a tag shows |

Character adjectives in `STILL_MAYBE` (`bright`, `dark`, `glassy`, `percussive`, `pulsing`, `swelling`, `wobbling`, `noise sweep`, `filter sweep`) stay faded as learned heads. The nine DSP words (`warm`, `airy`, `metallic`, `gritty`, `smooth`, `hollow`, `nasal`, `woody`, `glassy`) are not model tags. The tagger's `tested` flag still shows `percussive`, `pulsing`, `swelling`, and `wobbling` as normal tags. This plan does not retrain those.

`djCatalog.json` has **199** labels. **39** are merged into another name, leaving **160** pickable tags. The older "198" count is the October 5 scorecard.

Train counts marked `FSD` are public FSD50K train-split rows (a floor). Other train counts are `trainPositive` on the matched report. Neither is the full private mix in `dge-tagger-data`. Test is the positive count on the binding set. The binding set is the weakest counted set that has at least 5 positives and 5 negatives. Weak under-tag views (holdout-r3 weak, Freesound weak) are not used: an untagged track is not a proven absence.

## Below the maybe floor

The lower number is under 0.45. These are the tags that fail even the maybe rule on the binding set.

| Tag | Group | Precision | Recall | Decider | Shown as | Train | Test | Binding set |
|---|---|---:|---:|---|---|---:|---:|---|
| bird ambience | production | 0.79 | 0.41 | tagger | maybe | 459 FSD | 265 | FSD50K eval |
| double bass | source | 0.67 | 0.44 | tagger (`bass`, tested false) | maybe | — | 9 | DJ clips round 1 |
| electric guitar | source | 0.15 | 0.66 | CLAP head | full | 440 FSD | 100 | NSynth test |
| mallet instrument | source | 0.39 | 0.66 | CLAP head | full | 249 FSD | 172 | NSynth test |

Electric guitar on FSD50K eval is 0.92 / 0.72 (181 positives). The miss is NSynth. Mallet on FSD50K eval is 0.78 / 0.80 (140 positives); free-tag-set is 1.00 / 0.46 (92 positives). The miss is NSynth. Double bass on DJ clips round 2 is 0.60 / 0.60 (15 positives). Round 1 is 9 positives at 0.67 / 0.44, which is why the tagger output stays `tested: false`. Cowbell's free-tag slice recalls 0.24 of 17 positives and has no negatives, so it does not bind; FSD50K eval is 0.81 / 0.81 and the head stays full.

## Below the full bar, at or above the maybe floor

| Tag | Group | Precision | Recall | Decider | Shown as | Train | Test | Binding set |
|---|---|---:|---:|---|---|---:|---:|---|
| distorted | character | 0.64 | 0.73 | tagger | hidden | — | 989 | NSynth effect renders |
| falling | character | — | — | tagger | maybe | — | — | cutoff moved to 0.8101; the published eval is at 0.5795 |
| atmospheric pad | production | 0.67 | 0.48 | CLAP head (maybe) | maybe | 3136 | 631 | round 21 report |
| breakbeat | production | 0.66 | 0.49 | CLAP head (maybe) | maybe | 1040 | 104 | round 18 report |
| chops | production | 0.45 | 0.73 | CLAP head (maybe) | maybe | 139 | 86 | round 14 report |
| crowd ambience | production | 0.92 | 0.49 | CLAP head | full | 576 FSD | 256 | clean-retrain FSD50K eval |
| foghorn bass | production | 0.47 | 0.50 | CLAP head (maybe) | maybe | 53 | 16 | round 16 report |
| glitch effect | production | 1.00 | 0.45 | CLAP head (maybe) | maybe | 79 | 20 | round 14 report |
| vocal chops | production | 0.50 | 0.73 | CLAP head (maybe) | maybe | 115 | 78 | round 14 report |
| cello | source | 0.78 | 0.49 | CLAP head (maybe) | maybe | 340 | 121 | round 18 report |
| electric piano | source | 0.85 | 0.46 | CLAP head (maybe) | maybe | 713 | 77 | round 18 report |
| horn | source | 0.81 | 0.46 | CLAP head (maybe) | maybe | 947 | 316 | round 19 report |

Bassoon left this table on 2026-10-30: its CLAP head was refit with RWC bassoon notes on box CPU and passes 50/50 and 60/60 on both held-out judges (0.93 / 0.62 on 45 real recordings, 0.64 / 0.96 on 120 notes from held-out RWC players; `docs/evaluations/rwc-woodwind-heads-2026-10-30`). Flute and oboe were refit the same way and failed, so they are unchanged.

`distorted` is hidden until a detector passes on real clips. The 0.64 / 0.73 figure is NSynth effect renders, which this repo already refuses as ground truth. `falling` (shown as downlifter) was raised to 0.8101 because the output learned falling objects; real downlifter recall on the free-tag test stayed 0 (`docs/evaluations/dj-precision-2026-10-11`). Crowd ambience is still flagged as a normal head, while the clean-retrain FSD50K score is 0.92 / 0.49.

## No held-out score at the current cutoff

These have no binding set in the snapshot. A raw prompt can show only as a faded "possible". Several CLAP or one-shot heads ship with a cutoff that no committed row matches, so they are listed here rather than given a borrowed score.

| Tag | Group | Decider | Shown as |
|---|---|---|---|
| bitcrushed, chorused, dry, filtered, flanged, gliding, plucked, rolling, syncopated | character | raw prompt | possible |
| brass synth, record stop, reese bass, rimshot, string synth, sub drop, supersaw, synth chord, synth lead, synth pluck, vinyl crackle, vocal hum, vocal shush, vocal-like synth, vocoder vocal, wind ambience, wobble bass | production | raw prompt | possible |
| percussion hit, sub bass | production | CLAP head | full |
| synth bass, synth hit | production | one-shot head | full |
| sound effect | source | CLAP head (maybe) | maybe |
| banjo, sitar, steel drum, steel guitar, waterphone | source | raw prompt | possible |

Nine more tagger tags are `tested` (they passed 60/30 on fresh sets) but this snapshot has no strong-set score at the current cutoff, because the policy cutoff has moved off `thresholds.json`: violin / fiddle, trumpet, flute, percussion, pitched vocal, fm synth, siren, marimba, vibraphone. They are not in the gap tables above.

## Tagger already ships (60/30), and the weakest strong set misses 50/50

These show as normal tags. They are not the first training list. Another epoch on the same data is a poor bet for guitar and organ: recall 2 already moved them, and guitar's NSynth precision is 0.15.

| Tag | Precision | Recall | Test | Binding set | FSD50K train rows |
|---|---:|---:|---:|---|---:|
| reverberant | 1.00 | 0.44 | 45 | free-tag-set (PR #245); NSynth is 0.71 / 0.82 on 967 | — |
| clap | 0.63 | 0.45 | — | FSD50K eval (PR #244); free-tag-set is 1.00 / 0.59 | 320 |
| conga | 1.00 | 0.40 | 5 | heard clips (PR #246) | — |
| hi-hat | 0.76 | 0.31 | 52 | FSD50K eval | 384 |
| laser | 0.80 | 0.44 | 9 | heard clips (PR #245) | — |
| static noise | 1.00 | 0.36 | 5 | heard clips (PR #246; the PR's recall range is 0.36–0.60, low end kept) | — |
| whisper | 0.84 | 0.47 | 45 | FSD50K eval | 142 |
| guitar | 0.67 | 0.42 | — | NSynth test (PR #244); FSD50K is 0.77 / 0.82 | 1594 |
| organ | 0.82 | 0.40 | — | FSD50K eval (PR #244); free-tag-set is 1.00 / 0.75, NSynth 0.94 / 0.63 | 268 |
| voice | 0.81 | 0.40 | 141 | NSynth test; FSD50K eval is 0.96 / 0.42 on 750 | 3665 |

Kick (0.84 / 0.73 on FSD50K, 0.79 / 0.83 on the free-tag set) and gong (0.72 / 0.72 on FSD50K) clear 60/60 on the quoted sets. Whistle and vocal phrase clear 60/60 on 5 heard positives each. Acid synth is 0.71 / 0.50 on 10 heard positives and 1.00 / 0.56 on 16 free-tag positives. Those five are not training targets.

## What can realistically clear the bar

**First job, existing private cache only.** These eight were the recall-push list: precision already ≥ 0.65 and recall just under 0.50 in the pre-run snapshot, with hundreds of training clips. Run 1 tested that idea. It did not clear them. See Run 1 results.

| Tag | Why it is on the list |
|---|---|
| cello, horn, electric piano, bassoon | precision 0.78–0.91, recall 0.46–0.49, 192–947 report positives |
| crowd ambience | Pre-run CLAP snapshot was 0.92 / 0.49. Run 1's tagger eval already passed (0.74 / 0.79 on FSD50K) and still passes |
| atmospheric pad, breakbeat | 0.67 / 0.48 and 0.66 / 0.49, with 3136 and 1040 training positives |
| bird ambience | 0.79 / 0.41 on 265 FSD50K eval positives and 459 FSD50K train rows. Further from the line than the others, still a recall gap rather than a precision collapse |

**These need new labeled data.** Another epoch on the current mix does not move them. Run 1 is the measurement.

- Electric guitar and mallet instrument fail on NSynth (precision 0.15 and 0.39) while passing FSD50K. The same note families are already in training. The missing thing is a cleaner electric-versus-acoustic and mallet-versus-other-keyboard distinction.
- Synth subtypes with only a raw prompt (wobble bass, reese bass, supersaw, synth lead, synth pluck, synth chord, string synth, brass synth) and synth bass. Uploader words for these were already found to be loose, and synthetic renders were rejected.
- `falling` / downlifter. The output learned falling objects. It needs DJ downlifter labels, not more FSD50K drops.
- `distorted` and the other effect words scored on NSynth renders. Gemini labels stay unused. Real pedal clips would be a separate, later dataset.
- Conga, static noise, laser, riser, and the other heard-clip tags judged on 5–10 positives. Those sets are used up. A new pass on them would be retuning.
- Character adjectives and the nine DSP words.
- Double bass. Round 2 already reads 0.60 / 0.60; round 1 is 9 positives. That is a small-set problem, not a pretraining problem.
- Foghorn bass, glitch effect, chops, vocal chops. The training or test counts are small, or precision is the number sitting on the floor, so a recall push can make them worse.

## Training plan

**Base.** Keep `cmjatom/dge-all-tags-tagger-nc` at `410638a`: EfficientAT MobileNets (AudioSet, MIT) fine-tuned with the Jamendo instrument head in the same network as the catalog outputs. The first run continues that fine-tune. It does not add a CLAP encoder, PaSST features, a drum teacher, or synthetic audio. New logistic heads are the wrong tool for this list: the outputs already exist. Heads would be the follow-up only for a tag that still has no output after a dataset actually teaches it.

**Data for run 1.** No new dataset. `RECALL_TAGS` oversamples present windows and `--pos-weight 2` up-weights those present labels, for one epoch (`EPOCHS=1`). The start point is `all-tags-recall2` at `29090c5` (`initFrom`), because the shipped blend at `410638a` is an ONNX with no `model.pt`. The job clones `96705a6`, the commit that trained recall2, so the label cleanup in `recall2-labels.json` is applied. `launch()` copies `hf-launch.py` and `hf-job.sh` from that commit. Before it copies anything, it runs `check_forbidden_overlap()`: a training-id file that shares an id with `forbidden-ids/<set>.txt` stops the launch. The files are optional and were not on disk for Run 1; the filter that actually ran is the tagger-r20 drop list inside the job. Forbidden set names: FSD50K eval, NSynth test and effect renders, holdout round 3, DJ clip rounds 1 and 2, `fresh-tests-2026-10-11`, SASS-E, IDMT bass, and the locked free-tag holdout.

**Run 2 is not justified by Run 1.** The recall push did not clear the eight tags. The queued dataset, if new labels are collected, is still IRMAS (cello, clarinet, flute, acoustic guitar, electric guitar, organ, piano, saxophone, trumpet, violin, voice). Upstream terms are CC BY-NC-SA 3.0, and the MTG page also says the audio is not redistributed or modified (https://www.upf.edu/web/mtg/irmas, Zenodo 10.5281/zenodo.1290750). Download from Zenodo into the private cache. The public Hugging Face mirrors (`confit/irmas`, `charisreneec/IRMAS-Test`) do not carry the license, and republishing the audio conflicts with the MTG clause. Hold out IRMAS's official test split. Drop any artist that already appears in OpenMIC, Jamendo's held-out artists, or the fresh board. GuitarSet (CC BY 4.0, Zenodo 10.5281/zenodo.3371780) stays the later candidate, and only if acoustic guitar is still the gap.

**Service and hardware.** Hugging Face Jobs. Train on `l4x1` (1× L4 24 GB, $0.80/hour). Recall runs use 1 epoch, with `TRAIN_HOURS` 1.5 inside a 4 hour job timeout. Scoring is `evaluate.py` inside that same job. There is no separate `cpu-upgrade` eval job, and the estimate does not bill one. Prices are from https://huggingface.co/docs/hub/jobs-pricing as of 2026-10-29.

| Step | Flavor | Time | Cost |
|---|---|---|---|
| Recall-push fine-tune, 1 epoch, timeout 4 h | l4x1 | Run 1 ran 5,271 s (about 1.5 h) | $3.20 at the 4 h cap; Run 1 was about $1.17 |
| **Estimate for one launch** | | | **$3.20** |
| Per-job limit | | | **$5** |
| Cap, including one retry | | | **$8** |

AutoTrain, Spaces GPU, and Inference Endpoints stay out.

**How a result is scored.** The training job writes aggregate precision and recall on its held-out sets (run9 held-out groups, FSD50K eval, Freesound held-out, NSynth test), with the cutoff picked on validation. A tag passes only when every held-out set with at least 10 positives passes. `scripts/eval-tag.ts` was not run for Run 1: it loads `public/tagger-model` and checks it against `taggerPolicy.json`, so scoring a candidate with it means swapping that candidate into a local copy of the app. That app-level check is still open. The candidate weights stay in the private repo `cmjatom/dge-sound-tag-candidate`. `cmjatom/dge-all-tags-tagger-nc` stays at `410638a`.

## Run 1 results

Job `6ae32fee3fb22a235dd58cbf` on `l4x1`. It started at 4:38 AM Pacific (PDT) on Oct 29, 2026 and finished at 6:06 AM Pacific. Spend was about $1.17 (5,271 s of running time × $0.80/h). The candidate is the private repo `cmjatom/dge-sound-tag-candidate`, folder `recall-push-r1`. The shipped tagger was not changed.

None of the 8 tags newly cleared the bar. Crowd ambience already passed 50/50, 60/60, and 70/70, and it still does. Cello recall on the run9 held-out set went from 0.20 to 0.35 and still fails. Count after: 1 of 8 at 50/50. Count before: 1 of 8.

Before is `all-tags-recall2`, the network this run started from. "Shipped" in the table is the all-tags run, where that eval covers the set. After is graded. A pass requires every held-out set with at least 10 positives.

| Tag | Held-out set (pos/neg) | Before | After | 50/50 | 60/60 |
|---|---|---|---|---|---|
| cello | run9 (86/4921) | 0.53 / 0.20 | 0.59 / 0.35 | fail | fail |
| cello (OpenMIC output) | holdout-r3 (12/488) | 0.07 / 0.25 (shipped 0.08 / 0.25) | 0.09 / 0.25 | fail | fail |
| horn | run9 (19/4988) | 0.14 / 0.16 | 0.16 / 0.16 | fail | fail |
| electric piano | NSynth test (539/3557) | 0.54 / 0.79 (shipped 0.54 / 0.74) | 0.53 / 0.80 | pass | fail |
| electric piano | run9 (47/4960) | 0.41 / 0.55 | 0.42 / 0.51 | fail | fail |
| bassoon | run9 (3/5004) | – / 0.00 | – / 0.00 | fail | fail |
| bassoon | Freesound (6/1991) | – / 0.00 (shipped 0.50 / 0.33) | – / 0.00 | fail | fail |
| crowd ambience | FSD50K (110/4774) | 0.73 / 0.78 (shipped 0.74 / 0.81) | 0.74 / 0.79 | pass | pass (also passes 70/70) |
| atmospheric pad | run9 (104/4903) | 0.30 / 0.44 | 0.31 / 0.42 | fail | fail |
| breakbeat | run9 (90/4917) | 0.39 / 0.16 | 0.37 / 0.19 | fail | fail |
| breakbeat | Freesound (92/1905) | 0.31 / 0.11 (shipped 0.53 / 0.39) | 0.35 / 0.14 | fail | fail |
| bird ambience | FSD50K (265/4619) | 0.83 / 0.34 (shipped 0.79 / 0.41) | 0.84 / 0.34 | fail | fail |
| bird ambience | run9 (111/4896) | 0.48 / 0.56 | 0.48 / 0.58 | fail | fail |

Electric piano passes 50/50 on NSynth and fails on the real run9 clips, so the tag fails. Across 310 other tag/set pairs the mean change in min(precision, recall) was +0.0005. More training on this labeled mix does not clear these tags. The next gain has to come from new labeled data, not another recall push.

## What is left

Run 1 is finished. Another recall push on the same clips is not the next step. New labeled data is. The shipped model stays at `410638a`. The candidate stays in the private repo until an app-level `eval-tag.ts` check is worth doing, and that check needs a fresh labeled set that was not used to train or to pick cutoffs.

## Reproduce

```bash
python3 scripts/hf-sound-tags/test_sound_tags.py
python3 scripts/hf-sound-tags/plan.py
python3 scripts/hf-sound-tags/gap_report.py \
  --eval /path/to/eval.json --thresholds /path/to/thresholds.json \
  --fsd-csv-dir /path/to/fsd-labels --out docs/hf-sound-tag-training/gap.json
```

`eval.json` and `thresholds.json` are the public files on `cmjatom/dge-all-tags-tagger-nc` at `410638a`. The FSD50K label CSVs are the public `labels/dev.csv` and `labels/eval.csv` from `Fhrozen/FSD50k`.

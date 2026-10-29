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
| bassoon | source | 0.91 | 0.47 | CLAP head (maybe) | maybe | 192 | 45 | round 23 report |
| cello | source | 0.78 | 0.49 | CLAP head (maybe) | maybe | 340 | 121 | round 18 report |
| electric piano | source | 0.85 | 0.46 | CLAP head (maybe) | maybe | 713 | 77 | round 18 report |
| horn | source | 0.81 | 0.46 | CLAP head (maybe) | maybe | 947 | 316 | round 19 report |

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

**First job, existing private cache only.** Precision is already ≥ 0.65 and recall is just under 0.50, with hundreds of training clips. A recall push (`RECALL_TAGS` / `--pos-weight` in `scripts/audio-model/train.py`) on the current EfficientAT blend can plausibly clear 50/50. It will not, by itself, clear 60/60.

| Tag | Why it is on the list |
|---|---|
| cello, horn, electric piano, bassoon | precision 0.78–0.91, recall 0.46–0.49, 192–947 report positives |
| crowd ambience | 0.92 / 0.49 on 256 FSD50K eval positives. That clears the tagger 60/30 line and misses the 0.50 head bar by one point of recall |
| atmospheric pad, breakbeat | 0.67 / 0.48 and 0.66 / 0.49, with 3136 and 1040 training positives |
| bird ambience | 0.79 / 0.41 on 265 FSD50K eval positives and 459 FSD50K train rows. Further from the line than the others, still a recall gap rather than a precision collapse |

**Leave for a later run, after new labels exist.** More epochs on the current mix are unlikely to move these.

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

**Data for run 1.** No new dataset. `RECALL_TAGS` oversamples present windows and `--pos-weight 2` up-weights those present labels. The Jamendo head stays in the loss, as `train.py` already trains it. Training rows that match a forbidden set are dropped. Forbidden sets, already used for scoring or cutoff choice: FSD50K eval, NSynth test and effect renders, holdout round 3, DJ clip rounds 1 and 2, `fresh-tests-2026-10-11`, SASS-E, IDMT bass, and the locked free-tag holdout.

**Run 2, only if run 1 moves the fresh split.** Add one dataset: IRMAS (cello, clarinet, flute, acoustic guitar, electric guitar, organ, piano, saxophone, trumpet, violin, voice). Upstream terms are CC BY-NC-SA 3.0, and the MTG page also says the audio is not redistributed or modified (https://www.upf.edu/web/mtg/irmas, Zenodo 10.5281/zenodo.1290750). Download from Zenodo into the private cache. Do not train from the public Hugging Face mirrors (`confit/irmas`, `charisreneec/IRMAS-Test`): their cards do not carry the license, and republishing the audio conflicts with the MTG clause. Hold out IRMAS's official test split. Drop any artist that already appears in OpenMIC, Jamendo's held-out artists, or the fresh board. IRMAS is not Freesound, so it does not share FSD50K ids; the artist check is still required. The tagger is already CC BY-NC-SA, so a non-commercial training source matches the weights. GuitarSet (CC BY 4.0, Zenodo 10.5281/zenodo.3371780) is the candidate after that, and only if acoustic guitar is still the gap. It is one instrument and a few hundred excerpts.

**Service and hardware.** Hugging Face Jobs, the path `scripts/audio-model/hf-launch.py` already uses. Train on `l4x1` (1× L4 24 GB, $0.80/hour). Score on `cpu-upgrade` ($0.03/hour). Prices are from https://huggingface.co/docs/hub/jobs-pricing as of 2026-10-29.

| Step | Flavor | Time | Cost |
|---|---|---|---|
| Recall-push fine-tune, timeout 4 h | l4x1 | about 3–4 h on the usual 8-epoch recipe; the historical workflow allows 7 h | $3.20 at the 4 h cap |
| Held-out score | cpu-upgrade | about 2 h | $0.06 |
| **This run** | | | **$3.26** |
| Cap, including one retry | | | **$8** |
| Ask, so a failed start can be rerun | | | **$10** |

A second IRMAS run would be about another $4–6 (CPU prep plus one more 4 h L4 job) and is not in this cap. AutoTrain, Spaces GPU, and Inference Endpoints are out.

**How a result is scored.** Carve the fresh split by uploader / artist before training, with `scripts/hf-sound-tags/plan.py`'s overlap check against the forbidden id lists once those lists are on disk. Pick the cutoff on the pick half only. Judge on the check half. Then run `npx vite-node scripts/eval-tag.ts` on that fresh audio (the app's own chain: CLAP heads, one-shot heads, tagger, `confidentSoundSummary`). The forbidden sets are a no-regression read, not a place to pick the cutoff. Ship a head only when the check half meets the repo bar for that decider (50/50 for a CLAP head, 60/30 on every counted fresh set for a tagger output). Write the candidate to a new private repo (`<user>/dge-sound-tag-candidate`). Leave `cmjatom/dge-all-tags-tagger-nc` pinned until that check passes.

## What Chris needs to approve

1. This plan, including the $10 cap and the decision to train the eight recall-push tags before adding IRMAS.
2. A Hugging Face token in `HF_TOKEN`. A fine-grained token needs Jobs, read on the private datasets the trainer already uses (`<user>/dge-tagger-data`, `cmjatom/dge-private-train`, `cmjatom/dge-eval-runs`), and write on a new private model repo. It should not be required to push over `cmjatom/dge-all-tags-tagger-nc`. A classic write token also works. The Jobs account needs a positive credit balance. No token is in this environment (`HF_TOKEN` and `HUGGING_FACE_HUB_TOKEN` are unset, and there is no `~/.cache/huggingface/token`).
3. After that, the launch is:

```bash
DGE_HF_LAUNCH_CONFIRM=yes python3 scripts/hf-sound-tags/plan.py --launch
```

## Reproduce

```bash
python3 scripts/hf-sound-tags/test_sound_tags.py
python3 scripts/hf-sound-tags/plan.py
python3 scripts/hf-sound-tags/gap_report.py \
  --eval /path/to/eval.json --thresholds /path/to/thresholds.json \
  --fsd-csv-dir /path/to/fsd-labels --out docs/hf-sound-tag-training/gap.json
```

`eval.json` and `thresholds.json` are the public files on `cmjatom/dge-all-tags-tagger-nc` at `410638a`. The FSD50K label CSVs are the public `labels/dev.csv` and `labels/eval.csv` from `Fhrozen/FSD50k`.

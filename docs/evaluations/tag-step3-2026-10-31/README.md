# Step 3: more training examples for the weak tags (Oct 31, 2026)

Stacked on PR #270 (tag-fix-5-worst, merge commit 1d04f3b). Nothing here trains or launches a paid job.

## What changed

**Drums now means "any drum sound" (Chris, 2:27 PM Pacific, Oct 31).** A clip that has a kick, snare, rimshot, tom,
hi-hat, cymbal, drum fill or loop, breakbeat, tabla, conga, bongo, djembe or cajon is also a drums positive, including a
single one-shot. Clap, snap, shaker, cowbell, woodblock, 808 bass and generic "percussion" are left out on purpose.
The list lives in `scripts/audio-model/drum_sounds.py`.

- Training (`train.py`) applies the rule to every source when it loads labels, and the FSD50K relabel adds drums for its
  Drum, Drum_kit, Bass_drum, Snare_drum, Hi-hat, Cymbal, Crash_cymbal and Tabla classes. `--drums-kit-only` brings back
  the old meaning. `calibrate.py` and `coverage.py` read the setting from the run's log, so older runs keep the old meaning.
- `evaluate.py` keeps the old meaning unless `DRUMS_ANY=1` is set, so older reports stay comparable.
- The judge set (`scripts/tag-baseline/build_set.py`) uses the new meaning. Same 681 clips; 14 of them flip from
  drums absent to drums present (49 to 63 positives). The relabelled set is in `judge-set-drums-any/`, with the diff in
  `diff.txt`. The Oct 31 baseline in `tag-baseline-2026-10-31/` is not changed.

**Why it isn't in `labelmap.py`.** Chris asked for `labelmap.py` to be changed. But that file is part of the prep-cache
key (`hf-job.sh`), so editing it forces a full re-prep of every base source: about 3 more hours on the L4, about $2.40.
Applying the rule when labels load gives the same training labels and keeps the cache. `test_drum_sounds.py` checks that
no prepare script imports the new module. Moving the rule into `labelmap.py` is a small change if Chris prefers it, but
it costs that re-prep.

## Scores on the 46-tag judge set (681 FSD50K eval clips)

Same app as #270, same decisions; only the drums labels changed. Precision / recall / F1, positives in brackets.

| tag | baseline | #270 | this PR (labels only) |
|---|---|---|---|
| drums | .277 / .878 / .422 (49) | .422 | **.361 / .889 / .514 (63)** |
| wind ambience | 0 / 0 / 0 (20) | .323 / .5 / .392 | .392 |
| cymbal | .5 / .105 / .174 (38) | .648 / .921 / .761 | .761 |
| foley | .24 / .3 / .267 (20) | .19 / .4 / .258 | .258 |
| hi-hat | .667 / .2 / .308 (20) | .583 / .35 / .438 | .438 |
| vocal shout | .4 / .3 / .343 (20) | .36 / .45 / .40 | .40 |
| clap | .37 | .37 | .37 |
| bell | .423 | .423 | .423 |
| piano | .423 | .423 | .423 |
| snare | .444 | .444 | .444 |
| machine ambience | .474 | .474 | .474 |
| tambourine | .476 | .476 | .476 |

Overall: micro .624 / .635 / .629 (#270: .613 / .632 / .622); macro .709 / .629 / .641 (#270: .707 / .629 / .639).
Tags passing 60/30, 50/50, 60/60, 70/70: 33, 31, 22, 10 (same as #270). Files: `after-drums-any/`.
Only drums moves. The other weak tags need the retrain.

## New training examples found (free, local)

`scripts/audio-model/weak-tags/select_weak.py` takes the tags under F1 0.5 in the baseline and the best Freesound mirror
clips CED scored for each one (private `cmjatom/dge-eval-runs`, `runs/ced-freesound-38026076860-1/candidates.csv`,
the top 1,000 per tag). It drops held-out clips and clips that are already used **before** any cap:

- every FSD50K eval clip and every FSD50K eval uploader (that is where the judge set comes from);
- every FSD50K dev val-split uploader (the step-2 tuning set);
- reserved test families, and heldout.py's reserved-uploader rules;
- ids already listed by an earlier round: run 9, the fsnew staging list, coverage v1 and v2 candidates, coverage v2
  train list, CED keep list (60,994 ids).

It also requires a CED score of 0.5 or more, and keeps at most 15 clips per uploader and 700 per tag.

Result (`new-candidates-per-tag.csv`): **30 new clips in total**. Bell 11, machine ambience 13, vocal shout 3, wind
ambience 3, tambourine 0. Clap, cymbal, drums, foley, hi-hat, piano and snare have no CED rows at all. The mirror is
basically used up for these tags; most rows were already in training or belong to held-out uploaders. The id list
stays on the box (private) and has **not** been through heldout.py's full config: the keyword list, test8, DJ-effect and
re-host rules need inputs that are not on this box. Run it before any audio is staged.

FSD50K dev, train split, positives per tag (`/tmp/dge-acc3-fsd50k-dev-counts.log`): drums 289 under the old meaning,
1,822 under the new one. The rest don't change: foley 2,965, machine ambience 927, bell 704, piano 684, snare 648,
cymbal 560, hi-hat 384, clap 320, wind ambience 248, tambourine 190, vocal shout 184.

So the biggest data gain for the next retrain is the drums relabel: about 6 times more drums positives from FSD50K
alone, plus every kick, snare, hat and cymbal one-shot in the other sources. Foley already has nearly 3,000 examples
and still scores .26. Its problem looks like what the tag means, not how much data there is.

## Next retrain (not launched)

`audio-model-train.yml` defaults to `l4x1` ($0.80/hour, `docs/hf-sound-tag-training.md`) with a 7-hour limit. The
worst case is **$5.60**, which is over $5, so it needs Chris's go. The real cost depends on run time; with the cache
kept there is no base re-prep. If the rule moves into `labelmap.py`, add about 3 hours (about $2.40) and raise the limit.

## Notes

- Step 4 UI choice (not built): a small "Not sure? Fix it" chip on low-confidence tags.
- `prepare-freesound.py` skips FSD50K eval clip ids but not eval uploaders. FSD50K keeps dev and eval uploaders apart,
  so this has not leaked, but mirror sources should use the uploader rule too (`select_weak.py` does).

## Logs (box, Pacific)

- Judge relabel: `/tmp/dge-acc3-judgeset.log`, diff `/tmp/dge-acc3-judgeset-diff.log`
- Judge re-score: `/tmp/dge-acc3-judge-drumsany.log` (57 s), summary `/tmp/dge-acc3-summ-drumsany.log`, compare `/tmp/dge-acc3-compare.log`
- Candidate selection: `/tmp/dge-acc3-select.log`; FSD50K dev counts: `/tmp/dge-acc3-fsd50k-dev-counts.log`

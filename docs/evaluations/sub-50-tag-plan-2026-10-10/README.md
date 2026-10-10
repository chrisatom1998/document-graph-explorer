# Plan: lifting sub-50/50 tags (2026-10-10)

Bar: held-out precision AND recall >= 0.50 on clips longer than 2.25 s (`SOUND_TAG_BAR`, `ship.py` FULL).
Numbers are from `docs/evaluations/tag-heads-2026-10-09/shipped.json`.

**No thresholds were changed.** They are chosen on out-of-fold training scores (`train.py`). Re-tuning them on the
held-out clips would make the numbers look better without making the app better, and the accuracy gate is built to
catch that. With 20-34 held-out positives per tag, one clip is about 3 points of noise.

Everything below needs a retrain (`scripts/dj-effects/train.py` on the CLAP fingerprints from the original run,
GitHub run 37994472692 shards), which cannot be done in a plain dev container.

## Group 1: viola .49/.53, marimba .47/.59, vibraphone .43/.57
Closest to the bar and short on data (80-91 training clips each). Already shown as "maybe" (vibraphone is not).
1. Run `mine.py` with a larger `PER_LABEL` for these three, then `grow.py` as a new round so the earlier held-out
   clips stay held out and comparable (`PRIMARY_ROUND` judges new heads on the old clips).
2. Aim for 200+ real training clips per tag across 25+ uploaders (today 38 or fewer uploaders for the best-covered).
3. Ship via `ship.py` only if min(P, R) beats the current head on the same eligible clips.

## Group 2: glockenspiel .40/.86, double bass .30/.73, conga .41/.59
Recall is fine; precision is the problem, so the head fires on the wrong sounds.
1. Dump the held-out false positives (`fp` clips) per tag and listen to / tag-check them. Expect: celesta, music-box
   and bells for glockenspiel; cello and bass guitar for double bass; bongo, djembe and tom for conga.
2. Note the overlap lists in `labels-tags.json`: conga/bongo/djembe/cajon/tabla and the mallet family are excluded as
   negatives for each other, so training never learns to separate them. Splitting the overlap group (or adding
   explicit hard negatives such as bongo for conga) is the most likely precision fix. Re-check that held-out
   scoring uses the same rule so numbers stay comparable.
3. Double bass vs viola is also grouped as related; same remedy.

## Group 3: trombone .64/.39
Precision is fine; the head misses too many trombones (69 training clips, 18 held-out).
1. Add trombone positives (same mining and `grow.py` steps) and consider brass-section clips where trombone is tagged
   with trumpet/tuba, which `labels-tags.json` currently treats as a related group and drops from the negatives.
2. Compare class weight / C choices in `train.py` (C in 0.3-10 is already searched).

## Group 4: effect tags (filtered .05/.07, dry .04/.04, echoing .21/.31, saturated .25/.33, chorused .36/.28)
Mostly a label problem, not a model problem.
- `dry` tags include `close mic` and `anechoic`, which describe how a clip was recorded, not how it sounds.
- `filtered` mixes low-pass, high-pass and band-pass in one label; `echoing` mixes delay and echo with reverb (overlap
  with `reverberant`).
Steps: (1) hand-check 30 positives per tag; (2) rewrite the tag lists or split/merge the labels; (3) rebuild the
labels and retrain. Consider dropping `dry` altogether, since it cannot be told apart from silence of effects.

## Done when
`ship.py` reports min(P, R) >= 0.50 on runtime-eligible held-out clips, the accuracy gate shows no regressions,
and `INSTRUMENT_ANALYSIS_REVISION` is bumped so already-analysed tracks pick up the new heads.

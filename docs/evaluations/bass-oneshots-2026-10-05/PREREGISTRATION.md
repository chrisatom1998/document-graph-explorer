# Pre-registration: bass one-shot test set (2026-10-05)

Frozen before any model was scored on it. Manifest SHA-256 `6e6ad4e8994e7f6aeff932b708d4ab57237f5ae5b7e90620506ec5a70a2e9014` (`manifest.json`).

- 141 Freesound CC0 clips of 0.15-2 s, 86 bass hit, 55 not bass, 101 uploaders. Audio is not in the repo; each clip's SHA-256 is in the manifest, previews are re-fetchable by id.
- Excluded before fetching: every Freesound id and uploader in the earlier reserved splits or any training manifest. Ids and uploaders here are listed in `reserved-test-families.json`; never train on them.
- Labels: owner listened to every clip. A prefilled guess (from the search term that found the clip, not a model score) was shown; the owner overrode it on 29 of 141 clips. Guesses can anchor labelling, so treat labels as human-reviewed, not independently audited. 3 clips were not reviewed and are excluded.
- Hard negatives: kick, impact, drum, synth stab, low strings. Not-bass clips include some from bass searches that the owner rejected.

## Rules for use
1. The only claim this set supports is the shipped short-clip bass-hit head (commit da9d0ad), measured once, at its shipped threshold: recall on bass clips, false-tag rate on not-bass clips, each with a 95% Wilson interval and the counts.
2. No threshold, feature or training change is made after reading the result and then re-scored on this set. A changed model needs a newly frozen set.
3. Antidote and the earlier frozen splits are spent and are not mixed in.

## Result (2026-10-05, scored once)
Original labels: recall 26/86 (30%, 95% 22-41%); false tags 4/55 (7%, 3-17%).
Adjusted after seeing results: the owner re-listened to the 23 bass-labelled clips tagged as kick and judged 16 to be kick drums. With those moved to not-bass: recall 26/70 (37%, 0.27-0.49); false tags 4/71 (6%, 0.02-0.14). This is a post-hoc label correction, reported alongside the original; manifest.json is unchanged. Details in results.json.

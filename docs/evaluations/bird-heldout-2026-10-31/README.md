# Held-out test for "bird ambience" (round A), 2026-10-31

Rule-based held-out groups for the ff1010bird and Warblr10k audio staged by `scripts/audio-model/stage-birds.py` into the
private `cmjatom/dge-private-train` (`birds/v1`). A group is held out when
`int(sha256('dge-bird-heldout-2026-10-31|<group>')[:8], 16) % 100 < 15`.

- ff1010bird: group = Freesound uploader (`freesound-user:<name>`, from Chr0my/freesound.org metadata). Every Freesound
  exclusion applies (FSD50K eval, the short-clip and synth-clip reserved families, the cached Freesound test and its
  uploader rule, held-out uploaders of the staged Freesound / run 9 / DJ-effect sets); a held-out clip must also be new
  to training (not in FSD50K dev, the cached Freesound train or any staged training manifest). Sounds with no uploader
  in the metadata are dropped.
- Warblr10k: group = recording id. Warblr publishes no user or location ids, so two recordings by one person can land
  on different sides; scores on Warblr held-out clips may be a little optimistic.

`eval-birds` (prepare-staged.py): up to 600 present and 600 absent held-out clips. Labels: hasbird=1 means bird ambience
and animal sound present; hasbird=0 means bird ambience absent (animal sound unknown). Licence CC BY 4.0 (archive.org).

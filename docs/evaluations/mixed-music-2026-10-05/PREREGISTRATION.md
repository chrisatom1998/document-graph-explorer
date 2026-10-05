# Pre-registration: mixed-music (full-mix) tag check

Written 2026-10-05, before any clip was selected or analysed.

Why: a real-music check on 15 s Creative Commons DJ clips found good precision but very low recall (8 of 15 clips showed
no tag; drums, synth, piano and voice mostly missed). The short-clip benchmark is one-shots and cannot measure that.

- Clips: `scripts/mixed-music/build.py` picks up to 900 OpenMIC-2018 **official test** clips (10 s, full mixes) under
  non-share-alike Creative Commons licences or CC0, at most three per FMA artist, ranked by a fixed-seed hash of the sample
  key. Labels never influence selection. Intervals are bootstrapped over artists.
- Revision before any result was read: the first freeze (CC-BY/CC0, one clip per artist) gave only 118 clips with 5–9
  positives per class, too few to measure; it was replaced, unscored.
- Labels: OpenMIC aggregated crowd annotations (relevance ≥ 0.5 present, below absent, missing pair unknown) for drums,
  voice, synthesizer, piano, guitar, bass, cymbals, organ, violin, trumpet, saxophone.
- Scoring: `scripts/mixed-music/score.mjs` reads the app's own Sounds-panel tags (`confidentSoundSummary`) from the graph
  export; source tags only, through the fixed mapping in that file. Pass bar 60/60.
- Builds: main `d1b7b05` (base) and the tested-tag display fix on `claude/weak-sound-labels-2phv35`.
- Caveats: the fusion source policy was developed on OpenMIC (train partition); FMA music is broader than DJ music, so
  this measures full-mix recall in general, not DJ genres specifically. Any threshold or head chosen after reading these
  results must be measured on a different set.

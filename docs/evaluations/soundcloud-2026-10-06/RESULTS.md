# SoundCloud tracks that name their instruments (2026-10-06)

**Set.** 304 Creative Commons SoundCloud tracks (searched with SoundCloud's own web API, fully streamable, 1-12 min,
at most 3 per uploader), labelled from each track's own title, description and tags by `scripts/soundcloud/labels.py`.
Split by uploader: 192 train, 112 held-out. One 30 s excerpt per track, starting 35% in. `manifest.json` is the frozen
list; audio is fetched at run time (`.github/workflows/soundcloud-train.yml`).

Before any audio was analysed, two label rules were fixed after reading the label list (the SoundCloud genre
"Hip-hop & Rap" and bare "rap" tags on beats marked instrumentals as vocal; "Rhodes University" matched piano), and the
frozen list was relabelled from its stored text.

**Limits.** Labels come from text, not ears. A missing mention is "unknown", never "absent", except that "instrumental"
means no voice and a track that lists 3+ instruments is taken to lack piano/guitar/violin/sax/trumpet/organ if unlisted.
The held-out split has almost no instrument negatives, so only recall (and voice precision) can be judged there. Drums,
bass, synth and cymbals have no negatives at all.

**Analysis.** `results/base-*`: the app at main 245c428 analysed all 304 excerpts in headless Chromium (run 37429192056).

## What the fit changed

`scripts/soundcloud/fit.py` looks for full-mix Jamendo rules (show a label when a whole 10 s Jamendo window scores at
least the threshold, the same mechanism as PR #113) for piano, guitar, bass, violin, sax, trumpet, organ and voice. A rule
is accepted at the lowest threshold from 0.40 where the panel reaches precision 0.80 on train (margin over the 70/70
target), adds at least 3 true positives, and train has at least 8 labelled negatives.

Only **piano** qualified: Jamendo `piano` / `electric piano` >= 0.40 (now in `FULL_MIX_JAMENDO`).

| Set (P / R, piano) | Before | After |
|---|---|---|
| SoundCloud train (28 pos / 10 neg) | 0.83 / 0.36 | 0.88 / 0.50 |
| SoundCloud held-out (12 pos / 0 neg) | — / 0.42 | — / 0.42 |
| 500 DJ OpenMIC clips, round 1 (23 pos / 12 neg; judged only) | 1.00 / 0.87 | 1.00 / 0.96 |

No other label changes on any of the three sets (`results/fit.json`). The DJ clip numbers are a replay of the recorded
app outputs (`docs/evaluations/dj-clips-2026-10-06/results/openmic-clips.json`) through the same rule; the rule only reads
recorded Jamendo window scores, so the replay is exact for those clips.

Guitar would also have helped on train (R 0.20 -> 0.56 at 0.40, 0 of 6 negatives shown) but train had too few negatives
to check precision, and main has since added a separately calibrated full-mix guitar rule (#136), so it is left out.

## Main on this set, against 70/70 (before the fit)

Held-out recall: drums 0.82, voice 0.90 (P 0.69), synth 1.00, piano 0.42, organ 0.63, guitar 0.00, bass 0.00,
violin 0.11, trumpet 0.00, sax 0.11. These are 30 s excerpts of whole tracks whose text names the instrument somewhere,
so some misses are instruments that don't play in the excerpt.

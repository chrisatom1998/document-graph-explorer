# Five heads also tag short clips (2026-11-07)

On a whole clip of 2.25 s or less the app only lets heads marked `oneShot` speak (plus the one-shot heads in
`short-clip.json`). Fifty pickable tags had no way to show on such clips (`src/audio/tagRouting.expected.json`), the
pattern that hid short gunshots before #316. This sets `oneShot: true` on five learned heads: trumpet, strings, viola
(shows as strings), harmonica and crowd ambience. No weights or cutoffs change.

## How it was chosen
- Data: the saved app-path model outputs (CLAP fingerprints and tagger scores per clip) of the Nov 2 FSD50K eval
  rescore, 10,231 clips, re-decided with the app's own chain (same functions as `scripts/eval-tag.ts`). No audio was
  read and nothing was uploaded. The re-decision reproduces the Nov 2 numbers exactly before any change.
- Split: uploader groups hashed into two halves as `eval-tag.ts` does. The flag was screened on every head and kept only
  where the **pick** half gained recall without losing precision; the **check** half was read once afterwards.
- Dropped after screening: snare, shaker, whoosh and accordion lost precision (they already have one-shot heads or
  misfire on short clips). Mallet instrument gained recall but added 32 false alarms on short clips and lost check-half
  precision (0.548 -> 0.521), so it stays off.

## Result (precision / recall, today -> with the flag)

| tag | pick half | check half | all | short clips found |
| --- | --- | --- | --- | --- |
| trumpet | 0.625 / 0.263 -> 0.850 / 0.895 | 0.833 / 0.541 -> 0.857 / 0.649 | 0.781 / 0.446 -> 0.854 / 0.732 | 0 -> 16 of 18 (false alarms 0 -> 0) |
| strings | 0.857 / 0.645 -> 0.889 / 0.860 | 0.791 / 0.723 -> 0.766 / 0.766 | 0.832 / 0.671 -> 0.847 / 0.829 | 0 -> 22 of 26 (false alarms 0 -> 2) |
| harmonica | 0.528 / 0.950 -> 0.541 / 1.000 | 0.708 / 0.895 -> 0.720 / 0.947 | 0.631 / 0.914 -> 0.644 / 0.966 | 0 -> 3 of 3 (false alarms 0 -> 0) |
| crowd ambience | 0.903 / 0.496 -> 0.910 / 0.540 | 0.891 / 0.573 -> 0.879 / 0.608 | 0.896 / 0.539 -> 0.892 / 0.578 | 0 -> 10 of 18 (false alarms 0 -> 2) |

No other measured tag moved. The crowd-ambience clips also gain the "ambience" umbrella and the "sound effect" source
tag (12 clips each; sound effect is unmeasured). All four tags already pass 60/30 on this set, so the pass count does not
change; recall does. Only clips of 2.25 s or less are affected, so NSynth (4 s notes) and full songs are unchanged.

Caveat: FSD50K eval is a judge set. The choice is a yes/no per head made on one half and confirmed on the other, not a
tuned cutoff, but the other counted sets (free-tag-set, heard) were not re-scored here because their caches are not saved.

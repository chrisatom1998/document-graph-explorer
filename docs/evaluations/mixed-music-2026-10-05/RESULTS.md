# Mixed-music (full-mix) results

Run 2026-10-05 in GitHub Actions (`mixed-music-eval.yml`, run 37356488384): 900 frozen OpenMIC-2018 test clips from
656 artists, analysed in the built app in headless Chromium. Base is main `d1b7b05`; branch adds the tested-tag display
fix. Displayed Sounds-panel source tags, 60/60 pass bar. Only explicitly labelled clips count, so positives are small.

| Label | Positives | main P / R | branch P / R |
|---|---|---|---|
| drums | 56 | 0.79 / 0.20 | 0.83 / 0.36 |
| voice | 40 | 0.75 / 0.38 | 0.77 / 0.43 |
| synthesizer | 61 | 1.00 / 0.39 | 1.00 / 0.41 |
| piano | 35 | 0.96 / 0.71 | 0.97 / 0.83 |
| guitar | 65 | 1.00 / 0.23 | 1.00 / 0.23 |
| organ | 15 | 0.67 / 0.27 | 0.67 / 0.27 |
| trumpet | 56 | 0.86 / 0.11 | 0.86 / 0.11 |
| bass, cymbals, violin, saxophone | 38–70 | — / 0.00 | — / 0.00 |

Labels passing 60/60: 1 of 11 on both (piano). Clips showing no tag: 346 → 339 of 900. No label lost precision or recall.

Where the branch's missed positives were found (from `missedPositivesFoundIn`):

- synthesizer: 33 of 36 misses were tagged by MTG-Jamendo, which is untested and therefore hidden.
- guitar: 30 of 50 in MTG-Jamendo; drums: 19 of 36 in MTG-Jamendo, 12 only in the AST instrument estimate.
- voice: 14 of 23 only in the AST instrument estimate, 8 nowhere.
- cymbals (70), bass (33 of 38), trumpet (44 of 50), violin (32 of 55), saxophone (30 of 55): mostly nowhere.

Reading: the display fix helps but full-mix recall stays low. The biggest remaining lever is that MTG-Jamendo already finds
most missed synth, guitar and drums but is not shown because it has never been measured. Calibrating it would have to use
a different set from this one (see the pre-registration caveats).

## Correction (2026-10-05, after merge)

Both builds above predate PR #104, which fixed the trained instrument detector (fusion) on songs. In these runs
fusion failed on every window, so the table measures the app without its main full-mix detector and understates
current main. PR #113 later analysed 600 of these clips with current main (records in
`docs/evaluations/edm-genre-tags-2026-10-05/openmic-main.json` on that branch). Scored the same way:

| Label | current main P / R |
|---|---|
| drums | 0.88 / 1.00 |
| voice | 0.83 / 1.00 |
| synthesizer | 0.95 / 0.93 |
| piano | 0.94 / 0.80 |
| cymbals | 0.94 / 0.92 |
| trumpet | 0.83 / 0.98 |
| bass | 0.55 / 0.82 |
| organ | 0.29 / 0.88 |
| guitar | 1.00 / 0.16 |
| violin, saxophone | — / 0.00 |

Fusion was fitted on OpenMIC's train partition, so these numbers are optimistic for other music. The remaining
OpenMIC gaps on current main are guitar, violin and saxophone recall and bass and organ precision; the "MTG-Jamendo is
the biggest lever" reading above applied to the pre-#104 build.

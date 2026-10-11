# Crash cymbal: let the tagger decide it (2026-10-11)

The app shows **crash cymbal** from a CLAP head in `learned.json`: since #240 the pre-#232 head at cutoff 0.838 (the clean head from #232, cutoff 0.994, shipped for a few hours in between). Measured through the app's own decision path on the FSD50K eval split, the shipped head reads precision 0.48 at recall 0.55, under the 0.60 precision line, and the clean head found 1 of the 20 crash clips. The pinned tagger's `cat:crash cymbal` output passes 60/30 on both group halves, so `taggerPolicy.json` now lets the tagger decide crash cymbal on recordings up to 30 s, the same way it decides hi-hat (#234).

## How it was measured

- Clips: the 4,884 clips of the FSD50K **eval** split (`cmjatom/dge-tagger-data`, `fsdprep/eval-fsd50k.json`), decoded from the original 44.1 kHz files; 20 are labelled crash cymbal, 4,864 are not. Neither the tagger nor the clean heads were trained on eval clips.
- Code path: the same chain the app runs (CLAP 10 s windows and heads, one-shot heads, prompt selection, tagger windows, then `confidentSoundSummary`), replayed by `scripts/eval-tag.ts` with the app's model files. That script lands with PR #235 (branch `claude/tag-decision-map`); until that merges, run it from that branch.
- Halves: clips are split by uploader into a **pick** half (13 crash clips) and a **check** half (7). The cutoff is chosen on the pick half and judged on the check half.
- Precision / recall are over the whole eval split unless a half is named. FA = false alarms as a share of the 4,864 non-crash clips.

## Before and after (FSD50K eval, app path)

| | Decider | Cutoff | All (P/R, tp/fp) | Pick half | Check half | FA |
|---|---|---|---|---|---|---|
| Before (main since #240) | CLAP head, pre-#232 weights | 0.838 | 0.48 / 0.55 (11/12) | 0.67 / 0.46 | 0.36 / 0.71 | 0.00 |
| Before (main between #232 and #240) | clean CLAP head | 0.994 | 0.50 / 0.05 (1/1) | 1.00 / 0.08 | 0.00 / 0.00 | 0.00 |
| After | tagger `cat:crash cymbal` | **0.4** | **0.92 / 0.55** (11/1) | 1.00 / 0.46 | 0.83 / 0.71 | 0.00 |

Tagger cutoff sweep (why 0.4):

| Cutoff | Pick P/R | Check P/R | All P/R (tp/fp) |
|---|---|---|---|
| 0.1 | 0.67 / 0.46 | 0.70 / 1.00 | 0.68 / 0.65 (13/6) |
| 0.1631 (model's own threshold) | 0.67 / 0.46 | 0.62 / 0.71 | 0.65 / 0.55 (11/6) |
| 0.2 | 0.75 / 0.46 | 0.62 / 0.71 | 0.69 / 0.55 (11/5) |
| 0.3 | 0.75 / 0.46 | 0.71 / 0.71 | 0.73 / 0.55 (11/4) |
| **0.4** | 1.00 / 0.46 | 0.83 / 0.71 | 0.92 / 0.55 (11/1) |
| 0.5 | 1.00 / 0.46 | 0.83 / 0.71 | 0.92 / 0.55 (11/1) |
| 0.6 | 1.00 / 0.46 | 1.00 / 0.57 | 1.00 / 0.50 (10/0) |

On the pick half recall is the same from 0.1 to 0.5 and the false alarms are gone by 0.4, so 0.4 is the lowest cutoff that drops no crash clip there. The one false alarm left at 0.4 is a clip FSD50K labels `cymbal` and `percussion`. The model's own threshold (0.1631, which #234 first tried) also passes 60/30 but with five more false alarms (a gong, a tambourine, a voice clip, an unlabelled clip and a second cymbal clip).

Neither CLAP head can be rescued by moving its cutoff. The shipped head (0.838) tops out at 0.77 / 0.50 overall at cutoff 0.96 (pick 0.86 / 0.46, check 0.67 / 0.57, 3 false alarms), the same recall as the tagger at 0.6 with more false alarms, and it passes the check half by one clip. The clean head reaches 0.63 / 0.60 at 0.9 with 7 false alarms.

## What does not change

Watched tags measured before and after, identical: cymbal, drums, percussion, hi-hat, snare, kick. The `cymbals` tagger entry (`minSeconds: 10`) keeps deciding `cymbal` on recordings of 10 s or more; this entry decides only `crash cymbal`.

Past 30 s the tagger has no full-song evidence, so the entry hands crash cymbal back to the other detectors (`long: { rule: 'detectors', afterSeconds: 30 }`), where the clean head still applies.

## Tagger model swap (#236)

#236 replaced the tagger with a re-combine that adds the recall network for 9 outputs. `cat:crash cymbal` still comes from the `all-tags` network: on 36 FSD50K clips (all 20 crash clips, the 6 clips the tagger flags between 0.16 and 0.55, and 10 random others) the old and new models give bit-identical crash cymbal scores (largest difference 0), while other outputs differ by up to 0.94. The numbers above therefore hold for the pinned model.

## Caveats

- 20 positive clips is a small set: 7 on the check half. The pass is measured, the margin is thin.
- #234 measured the clean head at 0.96 / 0.68 on a different free-tag set, with CLAP embeddings computed outside the app. On the app's own path the same head at 0.994 found almost nothing, which #240 confirmed (0.18 / 0.10 on its FSD50K run) and reverted.

## Reproducing

The JSON reports are not committed (they embed clip ids and scores for a private test set). To regenerate, with `HF_TOKEN` set and `eval-fsd50k.json` plus the original FSD50K eval wavs from `cmjatom/dge-tagger-data` (`fsdprep/`) downloaded:

```
npx vite-node scripts/eval-tag.ts --tag "crash cymbal" --watch cymbal,drums,percussion,hi-hat,snare,kick \
  --set <dir>/eval-fsd50k.json --audio-dir <dir>/fsd50k-wav --cache <cache-dir> --out crash-after.json
```

Add `--policy <main's taggerPolicy.json>` for the "before" row. The first run scores every clip (CLAP and tagger, about an hour on 2 CPU cores); later runs replay from the cache.

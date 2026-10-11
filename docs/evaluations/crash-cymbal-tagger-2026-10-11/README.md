# Crash cymbal: let the tagger decide it (2026-10-11)

The app showed **crash cymbal** from the clean CLAP head (`learned.json`, cutoff 0.994). Measured through the app's own decision path, that head finds 1 of the 20 labelled crash cymbal clips in the FSD50K eval split. The pinned tagger's `cat:crash cymbal` output passes 60/30 on both group halves, so `taggerPolicy.json` now lets the tagger decide crash cymbal on recordings up to 30 s, the same way it decides hi-hat (#234).

## How it was measured

- Clips: the 4,884 clips of the FSD50K **eval** split (`cmjatom/dge-tagger-data`, `fsdprep/eval-fsd50k.json`), decoded from the original 44.1 kHz files; 20 are labelled crash cymbal, 4,864 are not. Neither the tagger nor the clean heads were trained on eval clips.
- Code path: the same chain the app runs (CLAP 10 s windows and heads, one-shot heads, prompt selection, tagger windows, then `confidentSoundSummary`), replayed by `scripts/eval-tag.ts` with the app's model files. That script lands with PR #235 (branch `claude/tag-decision-map`); until that merges, run it from that branch.
- Halves: clips are split by uploader into a **pick** half (13 crash clips) and a **check** half (7). The cutoff is chosen on the pick half and judged on the check half.
- Precision / recall are over the whole eval split unless a half is named. FA = false alarms as a share of the 4,864 non-crash clips.

## Before and after (FSD50K eval, app path)

| | Decider | Cutoff | All (P/R, tp/fp) | Pick half | Check half | FA |
|---|---|---|---|---|---|---|
| Before | clean CLAP head | 0.994 | 0.50 / 0.05 (1/1) | 1.00 / 0.08 | 0.00 / 0.00 | 0.00 |
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

The CLAP head cannot be rescued by moving its cutoff: at 0.9 it reaches 0.63 / 0.60 overall and 0.60 / 0.86 on the check half, with more false alarms than the tagger at any cutoff from 0.3 up.

## What does not change

Watched tags measured before and after, identical: cymbal, drums, percussion, hi-hat, snare, kick. The `cymbals` tagger entry (`minSeconds: 10`) keeps deciding `cymbal` on recordings of 10 s or more; this entry decides only `crash cymbal`.

Past 30 s the tagger has no full-song evidence, so the entry hands crash cymbal back to the other detectors (`long: { rule: 'detectors', afterSeconds: 30 }`), where the clean head still applies.

## Caveats

- 20 positive clips is a small set: 7 on the check half. The pass is measured, the margin is thin.
- #234 measured the clean head at 0.96 / 0.68 on a different free-tag set, with CLAP embeddings computed outside the app. On the app's own path the same head at 0.994 finds almost nothing here, so the cutoff looks fitted to embeddings that differ slightly from the app's.

## Reproducing

The JSON reports are not committed (they embed clip ids and scores for a private test set). To regenerate, with `HF_TOKEN` set and `eval-fsd50k.json` plus the original FSD50K eval wavs from `cmjatom/dge-tagger-data` (`fsdprep/`) downloaded:

```
npx vite-node scripts/eval-tag.ts --tag "crash cymbal" --watch cymbal,drums,percussion,hi-hat,snare,kick \
  --set <dir>/eval-fsd50k.json --audio-dir <dir>/fsd50k-wav --cache <cache-dir> --out crash-after.json
```

Add `--policy <main's taggerPolicy.json>` for the "before" row. The first run scores every clip (CLAP and tagger, about an hour on 2 CPU cores); later runs replay from the cache.

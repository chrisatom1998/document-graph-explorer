# Short-note sound tags on NSynth test (2026-10-30)

The shipped electric-guitar and piano tags on a note shorter than 10 seconds were the CLAP heads in `learned.json`. On the NSynth **test** split (4,096 notes, instruments not in the training split) those heads were the weak ones: electric guitar precision 0.163, piano precision 0.369. The tagger already scores both sounds. This change uses those scores only as a check on the head, and only on short recordings. A 10 second window is unchanged, so a full mix can still carry both guitars, and piano from 10 seconds up is still the tagger's own decision.

No cutoff was fitted on this set. Electric guitar has no new threshold: the head is kept only when its probability is strictly above the acoustic-guitar head. Piano uses the cutoff already shipped for recordings of at least 10 seconds (0.5337).

## Before / after

A tag counts when `confidentSoundSummary` would list it. Notes are about 4 seconds, so one-shot heads are off and the learned heads are on. Precision / recall / F1. Other tags in the set did not move.

| Tag | Positives | Before | After | False positives |
|---|---:|---|---|---|
| electric guitar | 171 | 0.163 / 0.503 / 0.246 | 0.211 / 0.491 / 0.295 | 441 → 314 |
| piano | 119 | 0.369 / 0.899 / 0.523 | 0.418 / 0.790 / 0.547 | 183 → 131 |
| acoustic guitar | 481 | 0.515 / 0.439 / 0.474 | same | 199 |
| guitar | 652 | 0.695 / 0.259 / 0.378 | same | 74 |
| mallet instrument | 202 | 0.394 / 0.639 / 0.488 | same | 198 |
| organ | 502 | 0.946 / 0.594 / 0.729 | same | 17 |
| flute | 180 | 0.866 / 0.322 / 0.470 | same | 9 |
| **Micro (7 tags)** |  | 0.486 / 0.459 / 0.472 | **0.525 / 0.452 / 0.486** |  |
| **Macro F1** |  | 0.473 | **0.483** |  |

Electric guitar recall fell by 2 notes, both on `guitar_electronic_028` (44/97 → 42/97). `guitar_electronic_022` stayed 42/74. Piano recall fell from 107/119 to 94/119. Even MIDI pitches and odd MIDI pitches each gained F1 (0.471 → 0.509 and 0.568 → 0.579), so the piano check is not one side of the keyboard.

Truth: electric guitar is `guitar` + `electronic` (171, matching the published tagger table). Acoustic guitar is `guitar` + `acoustic` (481). Piano is the single acoustic keyboard instrument (119). Every other note is an explicit negative.

## What is still wrong

Of the 314 electric-guitar false positives that remain, 125 are electronic keyboards, 73 are acoustic guitars, 59 are electronic organs and 56 are basses. Requiring a wider gap over the acoustic head made F1 worse on this set (the true notes often lead by only a little). Letting the tagger decide mallet or piano by itself, at the cutoffs it already publishes, did not beat the CLAP head. Those need a model that separates an electric guitar from an electronic keyboard, not another threshold on this split.

## How much to trust the gain

No cutoff was fitted here: the electric-guitar gate is a plain "beats acoustic guitar" comparison, and the piano gate reuses the tagger cutoff already shipped for 10 s and up. But the design choices (a strict `>` against a wider gap, a gate against the tagger alone) were compared on this same NSynth test split, so the before/after gain is somewhat optimistic. Treat it as an upper estimate until it is confirmed on a split that played no part in those choices.

## How to run

Audio is the NSynth test json/wav archive (CC BY 4.0, about 350 MB compressed). It is not in the repo.

```bash
npm run setup:music
# examples.json and audio/*.wav from nsynth-test.jsonwav.tar.gz
node scripts/sound-id-eval/score-nsynth.mjs \
  --examples /path/nsynth-test/examples.json \
  --audio /path/nsynth-test/audio \
  --out .cache/nsynth-scores.jsonl
python3 scripts/sound-id-eval/report.py .cache/nsynth-scores.jsonl
```

`score-nsynth.mjs` resumes. One CPU pass of all 4,096 notes took about 28 minutes here. `report.py` applies the same two rules as `learnedDjScores` and `shortPianoVeto` and prints the table above.

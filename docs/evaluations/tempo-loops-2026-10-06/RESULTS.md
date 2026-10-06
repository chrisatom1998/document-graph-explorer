# Tempo CNN on short loops (2026-10-06)

Judge set: the loops thread's 330 listener-labelled FSL10K loops (240 melodic without drums, 90 with drums) plus 30 loops
listeners marked as having no defined tempo (`/mnt/project-files/datasets/fsl10k-loops-tempo-330.json`). Scored once with
`scripts/hf-training/eval_loops_tempo.py`; the model is tempo-v1 (the one shipped in #139), unchanged. The rule (confidence
above 0.5 to override, from the song tuning in #139) was not tuned on these loops.

Within 4% of the listeners' BPM:

| Set | App on main (7c22212) | CNN, padded (as #139) | CNN, tiled | App + CNN rule (this PR) |
|---|---|---|---|---|
| All 330 | 174 (52.7%) | 191 (57.9%) | 219 (66.4%) | **209 (63.3%)** |
| Melodic, no drums (240) | 48.7% | 57.5% | 62.9% | **57.9%** |
| With drums (90) | 63.3% | 58.9% | 75.6% | **77.8%** |

App + CNN rule: wrong tempo 65 (app 78), no tempo 56 (app 78). On the 30 loops with no defined tempo the CNN alone gives a
tempo to 2. Per-loop rows: `loops330-v1.json`.

## Loop-trained model (v2), tried and not shipped

Same network retrained with 2,171 FSL10K loops (uploader BPMs, 168 uploaders) added to the songs. Every listener-annotated loop and all 231 judge-set uploaders were excluded from training. Scored once (`loops330-v2.json`).

| Within 4% | v1 (shipped in #147) | v2 |
|---|---|---|
| 330 loops, app + CNN rule | 63.3% | 64.8% |
| 330 loops, CNN alone (tiled) | 66.4% | 71.8% |
| Round 1 DJ clips (10 s) | 85.6% | 84.8% |
| Round 2 DJ clips (10 s) | 84.9% | 82.7% |
| GTZAN test half, middle 10 s | 68.7% | 59.8% |
| GTZAN test half, full 30 s | 70.5% | 62.0% |

v2 also gives a tempo to 5 of the 30 loops listeners marked as having no tempo (v1: 2). The loop gain under the app's rule is 1.5 points while songs lose up to 9, so v1 stays. Training cost about $0.07 on HF Jobs.

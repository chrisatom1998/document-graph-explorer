# Tag fixes, 2026-10-31 (step 2 of the tag-accuracy push)

Step 1 (`docs/evaluations/tag-baseline-2026-10-31`) found the worst tags. This step fixes five of them (cymbal, wind
ambience, foley, hi-hat, vocal shout) and redefines drums. Every number here comes from a run on 2026-10-31; logs are
listed at the end.

## Rules followed

- **The step-1 set is a judge set.** No cutoff, prompt, head or rule was picked on it. It was scored once, before and
  after.
- **Tuning used a separate dev set** (`dev-set/`): 641 clips from 473 uploaders in FSD50K **dev**, only its own `val`
  split, at the same pinned revision (`ccf1acaff12f3f4a4c10052dddafbb6d22152c9b`). The tagger only validated on `val`
  and never trained on it. No dev uploader is a judge uploader. The short-clip and synth test reservations are skipped
  as before. Up to 100 positives per target tag (vocal shout 28, wind ambience 39, hi-hat 53, cymbal 75, foley 100),
  plus 400 clips with none of the five tags.
- **Cutoff rule, declared before looking:** the repo's precision-first pick (the lowest cutoff with pick-half precision
  ≥ 0.65 and tp ≥ 3), confirmed on the dev check half. If that fails 60/30 on the check half, take the best pick-half F1
  instead. Only foley needed the fallback.
- No training and no paid jobs.

## What changed and why

| tag | root cause (found on code and dev) | change |
|---|---|---|
| cymbal | **Wiring and gating, not the model.** (1) The tagger shows cymbal as `source:cymbals`, and the evaluator only looked for `effect:cymbal`. This is a measurement bug, fixed in `scripts/eval-tag.ts` through `soundReviewKey`. (2) `minSeconds: 10` gave clips under 10 s no tagger decision, and the `detectors` rule with no `afterSeconds` gave none to any clip with more than one window. | Remove `minSeconds`; long rule `detectors` with `afterSeconds: 30` (the tagger decides up to 30 s, like the other tagger tags). Cutoff 0.6699 → 0.45 (dev). The `cat:cymbal` output was also tried on dev; the shipped `cymbals` output was kept. |
| wind ambience | Nothing trained decided it. The tagger has a `cat:wind ambience` output that was never wired in. | New tagger entry `cat:wind ambience`, cutoff 0.05 (dev), up to 30 s. |
| vocal shout | Only the CLAP head (0.986) decided it. The tagger's `cat:vocal shout` output was unused. | New tagger entry `cat:vocal shout`, cutoff 0.03 (dev), up to 30 s. Moving the CLAP head cutoff failed 60/30 on dev. |
| hi-hat | The cutoff. The 2.25–10 s gating was already fine: no `minSeconds`, and the tagger decides up to 30 s. Moving the one-shot and closed-hi-hat heads changed nothing, because the tagger decides. | `cat:hi-hat` cutoff 0.3663 → 0.15 (dev). |
| foley | Tried the cutoff. On dev it is close to flat (see below). On the judge set it is not the fix; see "Got worse". | `cat:foley` cutoff 0.2941 → 0.15 (dev, F1 fallback). |
| drums | **Labels.** Chris (11:35 AM PT): "drums" means ANY drum sound, single kick or snare one-shots included. The eval labels only counted FSD50K `Drum_kit`. | Eval labels now count `Drum`, `Drum_kit`, `Bass_drum` (kick), `Snare_drum` and `Tabla` as drums (`EVAL_LABELS` in `scripts/tag-baseline/build_set.py`). FSD50K has no tom or kick class. `Percussion` on its own (cymbals, shakers, bells) is not a drum. **No threshold or model change.** Clip selection still uses the training map, so the judge set keeps the same 681 clips: 29 clips gain a drums label. `scripts/audio-model/labelmap.py` (training) is unchanged. |

`INSTRUMENT_ANALYSIS_REVISION` → 141/142 (137/138 is staccato, #267, and 139/140 is reese bass, #275, both on main), so saved sounds are analysed again.

## Dev set (tuning), check half, before → after

| tag | before P / R / F1 | after P / R / F1 |
|---|---|---|
| cymbal | 1.000 / 0.087 / 0.160 | 0.811 / 0.935 / 0.869 |
| wind ambience | 1.000 / 0.263 / 0.416 | 0.706 / 0.632 / 0.667 |
| foley | 0.694 / 0.714 / 0.704 | 0.604 / 0.829 / 0.699 |
| hi-hat | 0.800 / 0.500 / 0.615 | 0.688 / 0.688 / 0.688 |
| vocal shout | 0.714 / 0.385 / 0.500 | 0.706 / 0.923 / 0.800 |

## Judge set (681 clips), scored once

**before** means the shipped policy, the fixed evaluator and the new drums labels. Step 1's published numbers used the
old evaluator and old labels; only cymbal (evaluator) and drums (labels) differ from them.

| tag | step 1 P / R / F1 | before P / R / F1 | after P / R / F1 |
|---|---|---|---|
| cymbal | — / 0.000 / 0.000 | 0.500 / 0.105 / 0.174 | **0.648 / 0.921 / 0.761** |
| wind ambience | 0.000 / 0.000 / 0.000 | 0.000 / 0.000 / 0.000 | **0.323 / 0.500 / 0.392** |
| foley | 0.240 / 0.300 / 0.267 | 0.240 / 0.300 / 0.267 | 0.190 / 0.400 / 0.258 |
| hi-hat | 0.667 / 0.200 / 0.308 | 0.667 / 0.200 / 0.308 | **0.583 / 0.350 / 0.438** |
| vocal shout | 0.400 / 0.300 / 0.343 | 0.400 / 0.300 / 0.343 | **0.360 / 0.450 / 0.400** |
| drums (labels only) | 0.123 / 0.950 / 0.217 | 0.277 / 0.878 / 0.422 | 0.277 / 0.878 / 0.422 |

| | micro P / R / F1 | macro P / R / F1 | bars cleared (60/30, 50/50, 60/60, 70/70) |
|---|---|---|---|
| step 1 | 0.608 / 0.582 / 0.595 | 0.687 / 0.591 / 0.606 | 32, 30, 21, 10 |
| before | 0.628 / 0.592 / 0.609 | 0.701 / 0.592 / 0.614 | 32, 30, 21, 10 |
| after | 0.613 / 0.632 / 0.622 | 0.707 / 0.629 / 0.639 | 33, 31, 22, 10 |

No other tag changed between before and after. Full tables are in `before/` and `after/`.

### Got worse

- **foley** F1 fell from 0.267 to 0.258: recall rose from 0.30 to 0.40, but false alarms rose from 19 to 34. Dev had
  already shown no real gain on its check half. Lowering the cutoff is not the fix. On dev, the false alarms were mostly
  cymbals and hi-hats, chewing and packing tape, and the misses were dishes, glass and doorbells. Most of these are
  foley-like sounds that the label map does or does not call foley. That points to a decision about what foley means,
  not to a threshold. It is
  left for Chris rather than undone by looking at the judge set.
- hi-hat and vocal shout gained recall but lost precision. Their F1 went up.

### Drums after the relabel

- 112 false alarms remain.
- By FSD50K class, the most common are:
  - hands/clapping (21);
  - finger snaps (17);
  - bells (15);
  - cowbell (14);
  - cymbals (13);
  - crash cymbals (12);
  - tambourine (8);
  - explosions (7).
- These are not drums under Chris's definition. Fixing them is a model or cutoff question, and the brief said not to
  change the cutoff (`/tmp/dge-acc2-drums-fp.log`).

## Runtime

- Dev audio download: 1 min 15 s, 478 MB, kept outside the repo.
- Dev scoring: 151 s on 4 shards.
- Dev sweeps: 67 s (7 runs in parallel). Dev final check: 11 s.
- Judge decide: 74 s (3 runs in parallel, from step 1's model-output cache).

## Reproduce

```
scripts/tag-baseline/fetch.sh <dev-dir> --split dev-val --exclude docs/evaluations/tag-baseline-2026-10-31/manifest.csv \
  --tags "cymbal,wind ambience,foley,hi-hat,vocal shout" --per-tag 100 --per-uploader 5 --negatives 400
npx vite-node scripts/eval-tag.ts --set <dev-dir>/set/items.json --audio-dir <dev-dir>/audio --cache <dev-dir>/cache --tag hi-hat --policy <candidate.json>
scripts/tag-baseline/fetch.sh <judge-dir> && scripts/tag-baseline/run.sh <judge-dir> <out-dir> 4     # the judge set, once
```

## Logs (box, 2026-10-31)

- Dev:
  - `/tmp/dge-acc2-devset.log`, `/tmp/dge-acc2-devfetch.log`
  - `/tmp/dge-acc2-devscore.log`, `/tmp/dge-acc2-dev-score-{0..3}.log`
  - `/tmp/dge-acc2-dev-today.log`, `/tmp/dge-acc2-dev-sw-{cymbal,catcymbal,wind,foley,hihat,shout}.log`
  - `/tmp/dge-acc2-dev-final.log`, `/tmp/dge-acc2-dev-dec.log`
- Judge:
  - `/tmp/dge-acc2-judge-{before-oldlabels,before,after}.log`
  - `/tmp/dge-acc2-judge.log`
  - `/tmp/dge-acc2-compare.log`
  - `/tmp/dge-acc2-drums-fp.log`
- Tests: `/tmp/dge-acc2-vitest*.log`, `/tmp/dge-acc2-pytest.log`

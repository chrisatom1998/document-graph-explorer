# EAT heads (candidate, offline only)

Per-tag linear heads on frozen [EAT-base](https://huggingface.co/worstchan/EAT-base_epoch30_finetune_AS2M) embeddings,
blended with the shipped tagger's decision by one rule per tag. **This is a candidate.** The app does not load anything
from this folder, nothing here is under `public/`, and the default tagger is unchanged.
`src/audio/eatHeadsCandidate.test.ts` fails if `src/` or a model pack starts referencing it.

On the 681-clip judge set the candidate passes 37/46 tags at 60/30, against 33/46 for the shipped tagger. The results
and the overfitting caveat are in [`docs/evaluations/eat-heads-2026-11-01/`](../../docs/evaluations/eat-heads-2026-11-01/README.md).

## Files

| file | what it does |
|---|---|
| `select_train.py` | picks the FSD50K dev-train subsample, writing `train-manifest/fsd50k-train.csv` (split=train only; drop-ids, reserved families, judge and tuning uploaders removed) |
| `train-manifest/` | training ids and tags only, no audio: FSD50K dev-train, E-GMD v2 keep rows, AudioSet-a weak rows |
| `extract_eat.py` | CPU EAT embeddings (1,536-d) from a `id<TAB>path` list, using the pinned model revision |
| `train_heads.py` | trains the heads, tunes C, threshold and blend rule on dev-val only, scores the judge set once, and exports `candidate/` |
| `apply_candidate.py` | applies the exported heads and rules to `scripts/eval-tag.ts --decisions` output, with an optional 60/30 report |
| `common.py` | labels, metrics, the blend-rule search and head scoring |
| `candidate/eat-heads-2026-11-01.json` | 42 heads (float32, scaler folded in, about 360 KB) plus the rule for each of the 46 tags |

## Reproduce

Everything runs on CPU, at a cost of $0. Python needs `numpy`, `scikit-learn`, `torch`, `torchaudio`, `soundfile`
and `transformers`.

1. **Get the audio** into a private cache, never into git:
   - FSD50K dev train split.
   - The E-GMD and AudioSet-a rows from the private training dataset.
   - The 1,338-clip dev-val set.
   - The judge set.

   Decode streamed FLACs to 16 kHz WAV with ffmpeg first.
2. **Extract features:** `python extract_eat.py <name>-list.tsv feats/eat-<name>.npz 4`, once for each name: fsdtrain,
   eg2, asa, devval and judge. This takes about 64 CPU-minutes in total.
3. **Get the shipped decisions** for dev-val and the judge set:
   `npx vite-node scripts/eval-tag.ts --set <items.json> ... --decisions <out.json>`.
4. **Train:**

   ```bash
   python train_heads.py --feats feats --per-tag-csv <judge per-tag.csv> \
     --devval-set <devval items.json> --devval-decisions <devval decisions> \
     --judge-set <judge items.json> --judge-decisions <judge decisions> \
     --heads-out candidate/eat-heads-2026-11-01.json --report-dir out
   ```

   This takes about 3 minutes and is deterministic.

## Rules

- Never train or tune on judge audio.
- Never commit audio, or upload judge, held-out or commercial-pack audio.
- The heads are CC BY-NC-SA because of their training data; see `NOTICE`.
- EAT code and weights are MIT.

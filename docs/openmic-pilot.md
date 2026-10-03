# OpenMIC-2018 bounded pilot

`scripts/openmic-pilot.py` creates a small frozen evaluation input from the official [OpenMIC-2018 Zenodo archive](https://zenodo.org/records/1432913). It is evaluation plumbing only: it does not download anything, load a model, create predictions, train, choose a threshold, or score results.

The pilot contains one recording from each of 12 distinct official-train artists for development, 12 other official-train artists for calibration, and 24 official-test artists for the locked test set. Selection is hash-ranked on a documented seed and identity/provenance fields only. It cannot depend on labels or model predictions. It excludes the documented bad FMA recording IDs and accepts a metadata row only when its `license_url` is CC-BY or CC0.

After the complete archive is available, run:

```sh
python3 scripts/openmic-pilot.py \
  ../datasets/openmic-2018-v1.0.0.tgz \
  artifacts/openmic-pilot \
  --frozen-at 2026-10-03T00:00:00Z
```

The production command has a fixed expected archive MD5 of `e4ccf187e2bb5ab2e115416e8aafe7f4`. A mismatch stops before archive members are listed or extracted; there is no command-line checksum override. The output directory must not already contain the output JSON files or selected audio files.

The script first rejects unsafe tar paths and all symlink, hard-link, device, and FIFO members. It reads only bounded metadata, then extracts only the 48 selected regular OGG members to `audio/`, with per-file and total byte limits. Each output selection record freezes the official partition, sample key, artist, album, recording and license provenance, archive-member path, byte count, and SHA-256. `selectionSha256` is a canonical hash of the frozen selection record.

`openmic-pilot-manifest.json` conforms to `src/audio/evaluation.ts`. Official aggregated CSV sample/class pairs are observed labels: relevance at least `0.5` is `present`, lower relevance is `absent`, and only missing pairs are unknown. Duplicate pairs use the final CSV row, verified against the release NPZ `Y_true`/`Y_mask` for all 41,268 observed pairs (17,614 positive, 23,654 negative; maximum numeric difference 1.11e-16). Do not average conflicting duplicate rows or treat unknown pairs as negative. This protocol follows the [official modeling baseline](https://github.com/cosmir/openmic-2018/blob/master/examples/modeling-baseline.ipynb).

The release partitions are `partitions/split01_train.csv` and `split01_test.csv` (newline-separated sample keys). The frozen selection records the runtime aliases and three distinct evaluation policies: source candidate recovery, automatic primary source, and explicitly accepted sources. For example, `bass guitar` and `double bass` map to OpenMIC bass; bass guitar does not also map to guitar. Only source-dimension observations count; a musical bass role is not an instrument prediction. The full mapping is in `RUNTIME_LABEL_MAPPING` and included in the selection hash.

Candidate recovery measures suggestions shown for review, not calibrated acceptance. The product currently marks machine recognition observations `possible`; accepted-source recall can therefore be zero without changing candidate recovery. Report precision, recall, F1, support, annotation coverage, abstention, and per-class results separately for each policy. Keep raw worker outputs and product decisions separate. Never choose thresholds or aliases using locked-test results.

The 48-clip pilot is small and cannot establish 90% general accuracy. OpenMIC does not validate BPM, key, harp, vocal-chop subtype, effects, or exhaustive instrumentation. Pretraining overlap is unknown. BPM/key and electronic/chop performance require separate labeled evaluations.

Run the synthetic safety and reproducibility checks with:

```sh
python3 scripts/test-openmic-pilot.py
```

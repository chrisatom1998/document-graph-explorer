# Public-data short-clip training (2026-10-05)

Reproduces `docs/evaluations/short-clips-2026-10-04/public-data-2026-10-05.md`. Paths are those of the original run:
work dir `/home/user/work`, data `/home/user/data`, benchmark audio under `/home/user/media/dj-training-fingerprints/short-clips`
(the existing short-clip scripts expect `/Users/chrisjohnson/Documents/Media`; a symlink to `/home/user/media` works).

Run from the work dir, in order:

1. Download FSD50K `ground_truth` + `metadata` zips (Zenodo 4060432) into `/home/user/data/fsd50k-meta/` and unzip; AVP (Zenodo 3245959) as `avp.zip`;
   NSynth `nsynth-test.jsonwav.tar.gz`; EGFxSet (Zenodo 7044411) Clean, RAT, TubeScreamer, BluesDriver, Hall-/Plate-/Spring-Reverb zips into `egfx/`.
2. `python rangezip.py 4060432 FSD50K.eval_audio 2 - x > eval-members.json` and `python rangezip.py 4060432 FSD50K.dev_audio 6 - x > dev-members.json`
   (lists the split archives' central directories with HTTP Range requests).
3. `python plan_fsd.py` → `want-eval.txt`, `want-dev.txt`, `fsd-plan.json`.
4. `python rangezip.py 4060432 FSD50K.eval_audio 2 want-eval.txt /home/user/data/fsd-eval` and the same for `FSD50K.dev_audio 6 want-dev.txt /home/user/data/fsd-dev`.
5. NSynth train subset: stream `nsynth-train.jsonwav.tar.gz`, keeping notes with pitch 36–84, velocity ≥ 50, `sha256("nsynth-train|<name>") % 25 == 0`, ≤ 8 per instrument, plus `examples.json` (this run kept 5,459 notes / 923 instruments).
6. `python materialize.py` (benchmark test + calibration audio), `python build_train.py` (training pool + `train-items.json`).
7. `node scripts/public-training/clap-feat.mjs <list.json> <features-*.jsonl>` for calibration and training clips (never test).
8. `python train_heads.py export short-clip-candidate.json`.

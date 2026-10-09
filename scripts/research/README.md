# Audio research pilots

These offline evaluation tools do not change DGE's production models, UI, training,
thresholds or cache configuration. Run against a built app. All generated audio,
weights and raw runs belong under ignored `artifacts/` or an external directory.

## Corpus rules

`prepare.mjs` accepts an inventory of source files with provenance, permission for
evaluation, original-source group, split, and independently specified
`truthByDuration`. It makes opaque filenames and hashes every PCM crop. It never
copies a ten-second label to a shorter crop. Missing truth is unknown. Give every
crop and transformation of the same recording the same group. `loadManifest`
rejects changed bytes and original-source groups crossing development/test splits.
The scorer maps the pilot's `source:marimba` alias to DGE's canonical
`source:marimba / xylophone` label; this is a fixed taxonomy mapping.

`seed-pilot.py` selects the first two distinct tracks in each MASB axis (T/R/O),
downloads their documented Jamendo sources, adds the committed Iowa fixtures and
synthetic pulse/silence controls. The selection is fixed before predictions; it
is a tiny **development** pilot, not an acceptance set. Only the published
ten-second windows receive MASB labels. The original track audio is not committed.

`seed-effects.py` applies deterministic delay, hard clipping and low-pass processors
to the two Iowa fixtures. These are processing-identity labels, not human-verified
audible effects or a realistic DJ-effects benchmark. The marimba fixture is too
short for six seconds; that duration has no cross-source positive and is unscored.
These effect labels are an experiment taxonomy, not DGE's display-label taxonomy.

## Reproduce

Prerequisites: Node/npm dependencies, Python 3.12, ffmpeg/ffprobe, Chromium, and an
isolated Python environment. Install pinned upstream code:

```sh
python -m venv /tmp/dge-research-venv
/tmp/dge-research-venv/bin/pip install torch torchaudio --index-url https://download.pytorch.org/whl/cpu
/tmp/dge-research-venv/bin/pip install 'peace @ git+https://github.com/DBraun/PEACE@2d8a3887501bcdb4779544295845b1e69b6b9b78' 'tp-clap @ git+https://github.com/mohan-li/TP-CLAP@39455a4fe4710e27eedf53a5598a6ae6404d0382' socksio
/tmp/dge-research-venv/bin/python scripts/research/download-models.py /tmp/dge-models
git clone https://github.com/barry-mir/music-clap-bow /tmp/dge-masb
git -C /tmp/dge-masb checkout 9dd9338790f3b195fa984e888f6e57f93b5cd949
python scripts/research/seed-pilot.py /tmp/dge-masb /tmp/dge-pilot-sources
node scripts/research/prepare.mjs /tmp/dge-pilot-sources/inventory.json /tmp/dge-pilot
python scripts/research/seed-effects.py /tmp/dge-fx-sources
node scripts/research/prepare.mjs /tmp/dge-fx-sources/inventory.json /tmp/dge-fx
npm run build
CHROME_PATH=/path/to/chromium node_modules/.bin/vite-node scripts/research/run-dge.mjs /tmp/dge-pilot/manifest.json artifacts/dge-pilot
```

Each output path must be new. `DGE_RESEARCH_PORT` selects an alternative preview port.
The browser adapter has an independent deadline that closes a stalled page. A
partial or failed result never earns complete-pipeline accuracy credit.
Commands evaluate the current checkout. The archived 45-clip study used DGE
commit `fbf46ebd3db42f828104a9b0e98052f1052adde0`, before the runtime fix in #174;
reproducing that older baseline requires that app revision with these research
scripts copied into it. A separate two-clip follow-up covers the updated runtime.

```sh
/tmp/dge-research-venv/bin/python scripts/research/run-model.py /tmp/dge-pilot/manifest.json artifacts/peace.json --model peace --checkpoint /tmp/dge-models/peace/boxgraph --revision 484fe3cbf4a21226f0989fbbcadb126c59ec34ef --threads 2
/tmp/dge-research-venv/bin/python scripts/research/run-model.py /tmp/dge-pilot/manifest.json artifacts/tp-clap.json --model tp-clap --checkpoint /tmp/dge-models/tp-clap/tp-clap.pt --revision b14090f5210715958f5ab7056d3c47f5f61cb582 --audio-backbone /tmp/dge-models/ced --text-backbone /tmp/dge-models/bert --threads 2
node_modules/.bin/vite-node scripts/research/score.mjs /tmp/dge-pilot/manifest.json artifacts/tp-clap.json artifacts/tp-score.json
node --test scripts/research/core.test.mjs
```

For effects, substitute `/tmp/dge-fx/manifest.json`; TP-CLAP uses
`--prompt 'Which audio effects are audible?'`. PEACE's boxgraph weights are
**CC BY-NC 4.0**, its code MIT. TP-CLAP code/model card use Apache-2.0. Check all
upstream licenses before any product integration. Downloads are explicit; the
inference adapter sets Hub/Transformers offline mode. The CED backbone runs pinned
upstream Python code via Transformers' `trust_remote_code` mechanism.

For an embedding-only comparison against DGE's unchanged production CLAP worker:

```sh
CHROME_PATH=/path/to/chromium node scripts/research/run-clap.mjs /tmp/dge-fx/manifest.json artifacts/clap-fx.json
node_modules/.bin/vite-node scripts/research/score.mjs /tmp/dge-fx/manifest.json artifacts/clap-fx.json artifacts/clap-fx-score.json
```

This uses the built worker with the profile request and extracts its embedding.
It decodes via native ffmpeg at 48 kHz mono, and omits AST, the tagger, short-clip
heads, display labels and graph work. It is a component baseline, never a substitute
for the full-browser availability or end-to-end timing result.

## Read the results

- Label precision/recall: only explicit 0/1 truths count; unknowns stay unknown.
  Failed/partial analyses cannot earn true negatives. DGE labels are its displayed
  labels, including `possible` tags, not calibrated probabilities. PEACE and TP-CLAP
  embedding adapters do not pretend to be calibrated label classifiers.
- MASB: strict positive-caption cosine greater than negative; ties lose. TP-CLAP
  uses its unconditioned audio head for captions and a separately reported silence
  control. This is six pairs, not a replication of the full MASB benchmark. The
  general checkpoint is primary; the MTAT fine-tune is a separate exploratory control.
- Retrieval: cosine, different original-source groups, and both a known positive
  and a known negative required in the gallery. Report top-1, MRR and P@min(5,N).
  Do not mistake a gallery with no distractors for demonstrated retrieval quality.
  TP-CLAP queries use its prompt-conditioned head; galleries use its plain head.
- Tempo: 4% strict tolerance; half/double credit separate. No-pulse and no-key
  abstention are separate. Synthetic pulse tests do not measure real-music tempo
  accuracy. No positive key corpus is supplied by these seed scripts.
- Speed: browser timings include decode, all model jobs, graph persistence,
  polling and a 1.5-second stability wait. Python timings include decode and
  inference, with model loading separate. TP-CLAP total row time includes caption and
  silence controls where present; `embeddingElapsedMs` excludes those controls. First-use compilation and warm values
  must be separated. The cold flag marks only the first clip, not every first use
  of a new input shape; JAX may compile on later rows. `--threads` sets PyTorch threads and requests OMP threads;
  it does not cap all JAX/XLA threads. Run models sequentially on otherwise idle
  hardware for a speed decision. These different boundaries cannot establish a
  product speedup.

Do not train or select thresholds from this pilot, promote a model based on it,
or substitute constructed negatives for reviewed difficult real-world negatives.

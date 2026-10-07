# DGE's own all-tags tagger in the app (2026-10-06)

The tagger trained by `scripts/audio-model/` (run 3) now runs in every music analysis, for the tags where it beat the
app's measured detectors on held-out audio. Every other tag keeps the existing detectors. Tempo, key, file-name,
version and sounds-alike links are unchanged (they do not read sound tags). Instrument links follow the shown tags, as before.

## What ships

| | |
|---|---|
| Network | EfficientAT `mn10_as` (4.2M parameters, AudioSet-pretrained), fine-tuned to 252 sigmoid outputs: 20 OpenMIC instruments, 40 MTG-Jamendo instrument tags, 186 app sound tags (`cat:*`), 6 loop roles |
| File | `public/tagger-model/model.onnx`, 22,608,189 bytes (22.6 MB), float32; `model.json` (5 KB, class list) |
| Download | +22.6 MB for `npm run setup:music` / first build (total about 563 MB). Pinned by revision and SHA-256 in `public/tagger-model/manifest.json`; the `.onnx` is gitignored like the other weights |
| Runtime | onnxruntime-web (wasm), the runtime the Jamendo models already use, in the Jamendo worker on its single thread. No new dependency |
| Input | 10 s of 32 kHz mono in [-1, 1]; the log-mel front end (EfficientAT `AugmentMelSTFT` in eval mode: pre-emphasis, 800-sample Hann window, hop 320, 1024-point FFT, 128 kaldi mel bands, `(log(x + 1e-5) + 4.5) / 5`) is inside the ONNX graph, checked against PyTorch at export (max difference 9.5e-7) |
| Cost per track | At most 3 windows. onnxruntime-web wasm on one thread, Xeon 2.1 GHz: headless Chromium 0.14–0.20 s per window after a 0.48 s first run, 1.2 s to open the session once per worker; Node 0.18 s per window. In the built app (headless Chromium, 45 s track, full analysis) the three tagger requests took 1.70 s (first, includes loading the session), 0.26 s and 0.23 s: about 2.2 s for the first track of a session and 0.5–0.7 s per later track, plus three 10 s FFmpeg section reads at 32 kHz |
| Policy | `src/audio/taggerPolicy.json` (outputs, validation thresholds, labels each output decides); display in `src/audio/confidentSoundSummary.ts` |

### Licences

- Network code and AudioSet-pretrained weights: EfficientAT (Florian Schmid et al.), MIT.
- Fine-tuning data: FSD50K (clips under CC0 / CC BY / CC BY-NC), NSynth (CC BY 4.0), MTG-Jamendo (CC licences per
  track) and OpenMIC-2018 (CC licences per clip), Freesound clips (per-clip CC licences), SoundCloud preview clips, and
  the extra sets named in `scripts/audio-model/labelmap.py` (TinySOL, EGFxSet, WaivOps, Surge renders, FSLD, Slakh).
- Only the trained weights are published (MIT model card). No training audio is redistributed with the model or the app.
  Some sources carry non-commercial clip licences; check them before uses beyond research and this app.

## How the app runs it

- **Windows** (`taggerWindowStarts`, matching the held-out scorers): up to 30 s, whole 10 s windows from the start, as
  `evaluate.py` cut clips (one window padded with silence when shorter than 10 s); longer recordings, the middle 30 s as
  three windows, the excerpt the round 3 full-song set used (`prepare-holdout.py`). Audio is decoded to 32 kHz mono by the
  same FFmpeg resampler the training preparation used.
- **Aggregation**: a recording's score per output is its maximum over windows, and the tag shows when that passes the
  output's threshold. That is `evaluate.py`'s rule (any window passes). Thresholds were picked on validation artists only
  (`calibrate.py`). The shown score maps the threshold to the app's 0.5 likely cutoff.
- **Deciding a tag**: for each tag below, the tagger alone decides. Other models' estimates for that tag (and the labels in
  its `decides` list) are dropped. Listener confirmations and rejections still win. Instruments are decided only on
  recordings of at least 10 s (the held-out instrument sets had no shorter audio); shorter clips keep the existing
  detectors for them. Sound-type and effect tags are decided at any length (their held-out clips were 0.3–30 s).
- **Provenance**: tags that reached 0.70 precision and recall on every complete-label held-out set show with
  "Trained tagger score"; the rest still show, marked "maybe" with "Trained tagger score (maybe)". 70/70 is a target,
  not a display gate.
- **Failure**: if the model cannot load or a window fails, the result has no tagger scores, every tag stays with the
  other detectors, a note says so, and the analysis is not cached, so the next run retries.
- **Parity**: `src/audio/tagger.parity.test.ts` runs a fixed test signal (4.5, 10, 25 and 47 s) through the app's
  window helpers and onnxruntime-web, against `scripts/audio-model/parity.py` (the Python cutting rules with
  onnxruntime CPU). Window starts match exactly; all 20 policy scores agree within 1e-3 (stored scores are rounded to 1e-4).

## Per-tag policy

Held-out numbers are precision / recall. Main's are the app's measured detectors before this change:
DJ clip rounds 1 and 2 (docs/evaluations/all-tags-2026-10-06/judge/main, 500 OpenMIC 10 s clips each), the short-clip scorecard
(docs/evaluations/open-vocab-2026-10-05/scorecard.json, round 19) and the DJ effects test
(docs/evaluations/dj-effects-2026-10-06). The tagger's are its run 3 held-out scores (`heldout-scores.txt`).

### Instruments (decided on recordings of at least 10 s)

| Tag (also decides) | Tagger R1 | Main R1 | Tagger R2 | Main R2 | Round 3 full songs, recall (tagger vs main) | Shipped as |
|---|---|---|---|---|---|---|
| drums (drum kit) | .88 / .97 | .86 / .97 | .91 / .98 | .91 / .94 | .99 vs .79 | tested |
| piano | 1.00 / .96 | 1.00 / .87 | .93 / .93 | 1.00 / .87 | .87 vs .76 | tested |
| guitar | .94 / 1.00 | .94 / .97 | .83 / .95 | 1.00 / .95 | .91 vs .68 | tested |
| cymbals (cymbal) | .98 / .98 | .94 / .98 | .94 / .94 | .91 / .94 | — | tested |
| violin (violin / fiddle) | .80 / 1.00 | .73 / .92 | .86 / .80 | .71 / 1.00 | .62 vs .24 | tested |
| trumpet | .88 / .82 | .65 / .77 | .60 / .67 | .52 / .83 | .30 vs .30 | maybe |
| saxophone | .91 / .79 | 1.00 / .29 | .92 / .92 | .88 / .28 | .67 vs .47 | tested |
| bass (bass guitar, double bass) | .67 / .44 | .21 / .67 | .60 / .60 | .44 / .67 | .68 vs .20 | maybe |

Guitar and piano lose some round 2 precision (guitar .83 vs 1.00, piano .93 vs 1.00) for recall on full songs; they
were approved on the overall picture. Kept on main's detectors because the tagger is worse there: **synthesizer** (R1
.97/.85 vs .94/.94; full-song recall .87 vs .92), **voice** (R1 .96/.92 vs main after the voice veto .92/.96; full songs .80 vs .83), **organ** (R1 .64/.37 vs .62/.95) and **cello**
(full songs .25 vs .33).

Round 3 counts only recall: its uploader tags leave most absences unknown, and precision on full songs is still low for
every detector (tagger weak-label precision: drums .30, voice .37, synthesizer .48, piano .37).

### Sound types and effects (decided at any length)

Adopted only where both held-out precision and recall beat every number main has for the tag. Evidence sets: FSD50K
eval (4,884 human-labelled clips), NSynth test notes (4,096) and the NSynth test notes re-rendered with one effect each
(4,096, `render.py`). Main's numbers come from other held-out sets (real short clips), so these are cross-set
comparisons; the NSynth renders are closer to the tagger's training renders than real effects are.

| Tag | Tagger held-out | Set | Main | Shipped as |
|---|---|---|---|---|
| percussive | .98 / .80 | NSynth test | .41 / .15 | tested |
| swelling | .80 / .88 | NSynth effect renders | .32 / .11 | tested |
| wobbling | .83 / .70 | NSynth effect renders | .63 / .25 | tested |
| falling | .95 / .63 | NSynth effect renders | .78 / .48 | maybe |
| pulsing | .55 / .77 | NSynth effect renders | .00 / .00 | maybe |
| bright | .61 / .62 (renders .59 / .60) | NSynth test | .23 / .05 | maybe |
| dark | .68 / .57 (renders .62 / .56) | NSynth test | .45 / .28 | maybe |
| distorted | .74 / .68 (renders .63 / .70) | NSynth test | .03 / .09 | maybe |
| reverse effect | .96 / .57 | NSynth effect renders | .63 / .46; DJ effects .49 / .55 | maybe |
| bird ambience | .79 / .41 | FSD50K eval | .55 / .40 | maybe |
| rain ambience | .93 / .62 | FSD50K eval | .67 / .30 | maybe |
| vocal breath | .67 / .35 | FSD50K eval | .61 / .20 | maybe |

Not adopted (main stays), for example: crowd ambience (.74/.81 vs .89/.76), vinyl scratch (.70/.84 vs 1.00/.70),
whoosh (.74/.52 vs .94/.84), vocal laugh, whisper, accordion, harmonica, mallet instrument, strings, spoken phrase, gong,
siren (.87/.65 vs DJ effects .70/.74), water ambience (.75/.56 vs .76/.36), stutter effect (.79/.75 vs 1.00/.10),
synth sequence, flute, electric piano, bass guitar's own app-name output, and every Freesound-taught tag (its held-out
precision is a lower bound and below main's). Bitcrushed (.81/.72 on renders) is not adopted: the only main number is a
DJ effects head that was never shipped, so main's actual behaviour for it is unmeasured. Tags with no measured main
number (animal sound, foley, machine ambience, turntable, glockenspiel, vocal scream, record stop, rising, static noise,
vinyl crackle and others) and all `jamendo:*` outputs (no held-out per-tag score: the Jamendo validation split was
trained on) keep main's behaviour.

## Held-out sets and rules

Never trained or tuned on: DJ clip rounds 1–3, the round 3 Jamendo set, FSD50K eval, NSynth test, OpenMIC tuning clips,
TinySOL folds 0–1 and the sounds-alike benchmark. Thresholds come from validation artists of the training sources only.
The policy above was chosen from the existing reports; no threshold was changed after reading held-out results.

## Files

- `heldout-scores.txt`: the run's held-out scores as written by `evaluate.py` (aggregates only).
- `src/audio/taggerPolicy.json`, `src/audio/tagger.ts`, `src/audio/taggerInference.ts`: policy, windows and display helpers, worker inference.
- `src/audio/tagger.test.ts`, `src/audio/tagger.parity.test.ts`, `src/audio/taggerParity.fixture.json`, `scripts/audio-model/parity.py`.

# EAT linear heads as a candidate add-on to the sound tagger (Nov 1, 2026)

**Candidate only. Nothing in the app reads these heads, so production tagging is unchanged.** On the 46-tag judge set
(681 FSD50K eval clips) the shipped tagger passes 33/46 at the 60/30 bar (precision ≥ .60 and recall ≥ .30 per tag).
Adding linear heads on frozen EAT-base embeddings, combined with the shipped decision by one rule per tag, passes
**37/46**. Micro F1 goes from .629 to .665 and macro F1 from .641 to .644.

Do not ship this yet. The rules were picked on a small 1,338-clip tuning set (see "Overfitting risk" below).

## Method

- **Encoder:** frozen [EAT-base, fine-tuned on AS-2M](https://huggingface.co/worstchan/EAT-base_epoch30_finetune_AS2M),
  revision `60d61e8b`. MIT code and MIT weights.
  - Features: [CLS, mean frame token] = 1,536 numbers.
  - Each clip is the mean over up to three 10 s windows.
  - Input: a 128-bin kaldi fbank over 1,024 frames.
  - Code: `scripts/eat-heads/extract_eat.py`.
- **Heads:** one logistic regression per tag (`class_weight='balanced'`) on standardised features. The scaler is
  folded into the exported weights.
- **Training data** (CPU-sized subsample; ids and tags only in `scripts/eat-heads/train-manifest/`, no audio):
  - **4,694 FSD50K dev clips, split=train only.** These are never val or eval clips.
    - Removed first: the private recipe's drop-train-ids, the reserved test families, and every uploader in the judge
      set or the tuning set.
    - Then kept up to 150 positives per tag (rarest tags first, at most 25 per uploader) plus 2,000 clean negatives.
  - **1,238 E-GMD v2 keep rows.** Drums and percussion were added to every row.
  - **2,168 AudioSet-a rows.** These have weak labels: positive for the listed tag and unknown for the rest. Whisper,
    shout and scream imply voice, and cowbell implies percussion.
  - Not used: AudioSet-b, the instrument-note and synth/effect sets, and VGGSound.
- **Tuning (dev-val only):** done on the 1,338-clip FSD50K dev-val set.
  - The set uses the dev val split, with judge uploaders excluded.
  - C was picked per tag from {.003, .03, .3}, and the threshold was set for the best F1.
  - **Blend rule per tag:** keep the shipped decision, OR / AND it with `p ≥ t`, or replace it with `p ≥ t`.
  - **When a rule changes:** only when tuning F1 rises by at least 0.02.
  - **Guards:**
    - A tag that passes 60/30 on the tuning set must keep passing there.
    - Tags with fewer than 15 tuning positives keep the shipped decision.
- **Judge set:** scored once, with the heads and rules frozen. Judge audio was never trained or tuned on.
- **Tags that keep the shipped decision:** glockenspiel, harmonica, vinyl scratch and tabla have no head (fewer than 5
  training positives), so they always keep the shipped decision. Ten more kept it because no rule cleared the
  tuning-set margin and guards. In total, 32 of the 42 tags with a head changed rule.
- **Baseline:** the app at `main` 3d214a88 (tagger `14f80825`, CLAP heads, one-shot rules), via
  `scripts/eval-tag.ts --decisions`.
  - It gives the same decisions on these 46 tags as the 5c6a572 run the experiment started from.
  - The only differences are the new ambience umbrella and the female/male vocal tags, which are not in the 46.

## Results on the judge set

| option | 60/30 pass | micro P / R / F1 | macro P / R / F1 |
|---|---|---|---|
| shipped (baseline) | 33 | .624 / .635 / .629 | .709 / .629 / .641 |
| EAT heads alone | 24 | see `judge-eat-heads-alone-per-tag.csv` | |
| **shipped + EAT heads (candidate)** | **37** | .754 / .595 / .665 | .760 / .591 / .644 |

- **Newly pass (7):** bell, piano, water ambience, drums, voice, kick, whisper.
- **Newly fail (3):**
  - spoken phrase: .667 / .059, recall collapses.
  - animal sound: .576 / .613.
  - electric guitar: .565 / .650.
- **Still pass but weaker:** cymbal recall drops from .921 to .526.
- **Still fail:** foley, clap, wind ambience, vocal shout, hi-hat and machine ambience.

Per-tag 60/30 results for all 46 tags (P / R; rules picked on dev-val):

| tag | positives | baseline P / R | 60/30 | + EAT P / R | 60/30 | rule (tuned on dev-val) | change |
|---|---|---|---|---|---|---|---|
| foley | 20 | .19 / .4 | FAIL | .625 / .25 | FAIL | and eat>=0.850 |  |
| clap | 21 | .833 / .238 | FAIL | .333 / .476 | FAIL | replace eat>=0.787 |  |
| wind ambience | 20 | .323 / .5 | FAIL | .259 / .35 | FAIL | replace eat>=0.639 |  |
| vocal shout | 20 | .36 / .45 | FAIL | .36 / .45 | FAIL | keep |  |
| bell | 26 | .423 / .423 | FAIL | .615 / .308 | pass | and eat>=0.730 | newly passes |
| piano | 20 | .294 / .75 | FAIL | .6 / .6 | pass | and eat>=0.718 | newly passes |
| hi-hat | 20 | .583 / .35 | FAIL | .833 / .25 | FAIL | and eat>=0.188 |  |
| snare | 24 | .667 / .333 | pass | .667 / .333 | pass | keep |  |
| machine ambience | 20 | .5 / .45 | FAIL | .5 / .5 | FAIL | or eat>=0.915 |  |
| tambourine | 15 | .833 / .333 | pass | .857 / .4 | pass | or eat>=0.310 |  |
| spoken phrase | 34 | .722 / .382 | pass | .667 / .059 | FAIL | replace eat>=0.978 | newly fails |
| water ambience | 20 | .375 / .75 | FAIL | .625 / .5 | pass | and eat>=0.874 | newly passes |
| drums | 63 | .361 / .889 | FAIL | .849 / .714 | pass | and eat>=0.040 | newly passes |
| bird ambience | 20 | .727 / .4 | pass | .727 / .4 | pass | keep |  |
| voice | 99 | .536 / .525 | FAIL | .873 / .556 | pass | replace eat>=0.786 | newly passes |
| animal sound | 31 | .714 / .484 | pass | .576 / .613 | FAIL | replace eat>=0.355 | newly fails |
| bass guitar | 20 | .647 / .55 | pass | .647 / .55 | pass | or eat>=0.973 |  |
| strings | 20 | .688 / .55 | pass | .609 / .7 | pass | or eat>=0.531 |  |
| kick | 21 | .583 / .667 | FAIL | .8 / .381 | pass | replace eat>=0.799 | newly passes |
| organ | 19 | .769 / .526 | pass | .647 / .579 | pass | or eat>=0.819 |  |
| whisper | 20 | .536 / .75 | FAIL | .75 / .75 | pass | and eat>=0.143 | newly passes |
| breath | 21 | .706 / .571 | pass | .818 / .429 | pass | and eat>=0.950 |  |
| glockenspiel | 20 | .909 / .5 | pass | .909 / .5 | pass | keep |  |
| crash cymbal | 19 | .786 / .579 | pass | .786 / .579 | pass | and eat>=0.007 |  |
| rain ambience | 20 | .64 / .8 | pass | .923 / .6 | pass | and eat>=0.877 |  |
| vocal laugh | 20 | .737 / .7 | pass | .917 / .55 | pass | and eat>=0.800 |  |
| electric guitar | 20 | .812 / .65 | pass | .565 / .65 | FAIL | or eat>=0.404 | newly fails |
| mallet instrument | 22 | .68 / .773 | pass | .708 / .773 | pass | and eat>=0.009 |  |
| harp | 20 | .923 / .6 | pass | .923 / .6 | pass | keep |  |
| siren | 20 | .667 / .8 | pass | .667 / .8 | pass | keep |  |
| whoosh | 20 | .923 / .6 | pass | .923 / .6 | pass | keep |  |
| crowd ambience | 20 | .778 / .7 | pass | .739 / .85 | pass | replace eat>=0.793 |  |
| environmental sound | 46 | .857 / .652 | pass | .786 / .717 | pass | or eat>=0.898 |  |
| vocal scream | 20 | 1.0 / .6 | pass | 1.0 / .5 | pass | and eat>=0.796 |  |
| harmonica | 20 | .633 / .95 | pass | .633 / .95 | pass | keep |  |
| cymbal | 38 | .648 / .921 | pass | .833 / .526 | pass | and eat>=0.207 |  |
| guitar | 59 | .754 / .78 | pass | .93 / .678 | pass | replace eat>=0.432 |  |
| gong | 20 | .875 / .7 | pass | .875 / .7 | pass | or eat>=0.244 |  |
| percussion | 115 | .928 / .67 | pass | .902 / .722 | pass | or eat>=0.746 |  |
| finger snap | 20 | 1.0 / .65 | pass | 1.0 / .65 | pass | keep |  |
| vinyl scratch | 20 | .842 / .8 | pass | .842 / .8 | pass | keep |  |
| acoustic guitar | 20 | 1.0 / .75 | pass | 1.0 / .8 | pass | or eat>=0.726 |  |
| cowbell | 20 | 1.0 / .75 | pass | 1.0 / .75 | pass | keep |  |
| trumpet | 20 | 1.0 / .8 | pass | 1.0 / .8 | pass | keep |  |
| accordion | 19 | .857 / .947 | pass | .857 / .947 | pass | keep |  |
| tabla | 6 | 1.0 / 1.0 | pass | 1.0 / 1.0 | pass | keep |  |

## Overfitting risk

These rules come from a small tuning set. A follow-up stacked SINet and EAT on the same tuning set and searched rules
the same way:
- 36 of 46 tags changed rule, with tuning-set gains of up to +0.29 F1.
- The judge set scored 35/46, *below* EAT alone. Many of the tuning-set gains did not hold.

The EAT-only candidate changed rule on 32 of 42 tags and may carry some of the same optimism. Before this ships, the
rules need a bigger tuning set (more dev-val clips, or several folds) and a re-check on the judge set.

## Why it is not wired into the app

- EAT is a PyTorch model of about 360 MB that loads its own code (`trust_remote_code`). There is no ONNX export in the
  model packs.
- The browser runtime only runs the ONNX tagger and CLAP.
- Shipping this would need an ONNX/WebGPU port of EAT, a new model-pack entry with a pinned revision, and a size and
  latency budget.
- Until then the heads stay an offline candidate in `scripts/eat-heads/`, outside `public/`. They are not bundled,
  and `src/audio/eatHeadsCandidate.test.ts` fails if app code or the model packs start reading them.

## Licences

- **EAT code:** MIT, (c) 2024 Wenxi Chen, <https://github.com/cwx-worst-one/EAT/blob/main/LICENSE>.
- **EAT weights:** MIT, <https://huggingface.co/worstchan/EAT-base_epoch30_finetune_AS2M>.
- **The trained heads count as CC BY-NC-SA 4.0** (non-commercial), because they were trained on FSD50K (CC BY and
  CC BY-NC clips) and AudioSet data.
- See `scripts/eat-heads/NOTICE` and `scripts/licenses/EAT-MIT.txt`.

## Cost and runtime

- **Cost:** $0. Everything ran on CPU; no HF Jobs, no GPU, no purchases.
- **EAT features:** 419 s judge, 573 s dev-val, 1,930 s FSD50K train, 273 s E-GMD and 617 s AudioSet-a. That is about
  64 minutes, partly in parallel, plus 85 s of FLAC decoding.
- **Heads:** about 170 s to train.
- **Shipped app on dev-val:** 482 s to score and 109 s to decide. Re-deciding judge and dev-val on 3d214a88 took about
  2.5 minutes from cached scores.
- **Re-running `train_heads.py`:** reproduces these rules and the 37/46 exactly. `apply_candidate.py` reproduces the
  per-tag table from the exported weights.

## Files

| file | contents |
|---|---|
| `per-tag-60-30.csv` | baseline vs candidate, all 46 tags |
| `devval-fit.csv` | per head: training positives, C, threshold, rule, tuning F1 |
| `judge-eat-heads-alone-per-tag.csv` | the heads alone, without the shipped decision |
| `summary.json` | the summary numbers above |

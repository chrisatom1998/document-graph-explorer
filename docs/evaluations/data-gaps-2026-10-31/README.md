# DGE: training data each tag needs to reach 50/50 and 60/60 (Oct 31, 2026)

Written 31 Oct 2026, evening (PT). This is research only: nothing was trained, uploaded, bought or merged.

**Refresh this after HF job 6ae66f890e0338d1bb7d4830 finishes (about 10:45 PM PT).** That retrain changes the tagger-decided tags; the CLAP-head tags below do not move with it.

## Where the numbers come from

- **Judge set (#276):** `docs/evaluations/tag-baseline-2026-10-31/` on PR #276. It has 681 FSD50K-eval clips and 46 tags. Of those 46 tags, 31 pass 50/50, 22 pass 60/60 and 10 pass 70/70 (the #276 README).
- **Full catalog:** `docs/hf-sound-tag-training/gap.json` on main 18682ea (last changed Oct 30 12:51 PM PT). It lists 160 pickable tags, each with its binding test set, deciding head and P/R.
- **Tagger runs:** `eval.json` from recall-push-r1, all-tags-r20, all-tags-nearmiss-recall and all-tags-recall2. These are on private HF under `cmjatom/...` (`/tmp/dge-gaps-work/run-compare.txt`).
- **The live `latest.json` scoreboard is unreachable from the box** (it lives in Chris's local project folder), so it is not used here.
- **Counting rule:** a tag passes only if every counted held-out set passes. A set counts when it has at least 10 positives. Under that rule:
  - 98 tags have numbers;
  - 64 pass 50/50, 47 pass 60/60 and 26 pass 70/70;
  - 34 are short of 50/50;
  - 35 are unmeasured, 8 have too few positives, 4 are blocked and 9 are DSP-exempt.
- **"TP needed" is arithmetic, not a forecast.** It is computed from P, R and positives: extra true positives needed for recall, and false alarms to remove for precision, with the other side held fixed.

## Top 5 closest to 50/50

These are ranked by the fewest clip decisions that have to flip, then by distance to the bar. Four of the five are decided by **CLAP heads**: a cheap sklearn head retrain on CLAP embeddings, with no HF job. Tonight's tagger retrain does not change them.

1. **vocal chops** (CLAP head). P .496 / R .731 on 78 positives (`dj-labels-2026-10-04/added-heads-round14-bar45.json`); 115 training clips.
   - **Gap:** remove **1 false alarm** to reach 50/50 (20 for 60/60). Precision is the problem, not clip count.
   - **What gets it over:**
     - Hard negatives: sung or spoken vocals that are not chopped, plus non-vocal chops.
     - More positives from `round13/looperman-v1` (106 vocal-chop clips, staged but unused) and BSD (21).
     - Negatives from VocalSet <https://zenodo.org/records/1442513> (CC BY 4.0) and the staged round13 VocalSound (CC BY-SA 4.0).
     - Freesound adds only 1 new open clip.
2. **breakbeat** (CLAP head). P .662 / R .49 on 104 positives (round18 heads file); 1,040 training clips.
   - **Gap:** **+1 TP** for 50/50, +12 for 60/60.
   - **What gets it over:**
     - Staged but unused: `round13/looperman-v1` 210 and `datasets-v1/bsd-s0/s1` 265.
     - Freesound tag/title matches: 212 new CC0/CC BY clips from 48 uploaders after every exclusion.
     - Looperman <https://www.looperman.com/> (royalty-free loops).
3. **filter sweep** (CLAP head). P .552 / R .485 on 33 positives (`dj-effects-2026-10-06/shipped.json`); 77 training clips.
   - **Gap:** **+1 TP** for 50/50, +4 for 60/60.
   - **What gets it over:** real recorded sweeps, because DSP renders do not transfer. **This is the thinnest supply:**
     - nothing staged;
     - only 3 new open Freesound clips (2 uploaders).
     - The best route is the Looperman loops staged in round13, re-labelled for sweeps, plus a hand-checked Freesound search. Flag this as supply-limited.
4. **animal sound** (tagger). Judge set P .714 / R .484 on 31 positives (TP 15, FP 6, FN 16).
   - **Gap:** **+1 TP** for 50/50, +4 for 60/60.
   - **Why:** 27 of the 31 judge positives are birds, so this is a bird-call recall problem.
   - **What gets it over:**
     - Freesound clips CED rates as bird or animal: 259 bird and 231 animal new open clips (155 and 131 uploaders).
     - Staged but unused: VGGSound 500, coverage/v2 mined 498, bird ambience 2,251 (BSD 1,134, VGGSound 500, mined 617).
     - xeno-canto <https://xeno-canto.org/> (mostly CC BY-NC-SA: training-only, and the weights become NC).
   - Needs a tagger retrain (an HF job; see costs).
5. **foghorn bass** (CLAP head). P .471 / R .5 on 16 positives (round16 heads file); 53 training clips.
   - **Gap:** remove **1 false alarm** for 50/50; +2 TP and -3 FP for 60/60.
   - **What gets it over:** hard negatives (sub bass, reese bass, horn, brass synth) rather than more clips.
   - The staged VGGSound "foghorn" (167) and CED AudioSet "Foghorn" (18 open) are literal ship horns. They are weak positives at best, so check the labels first.
   - The 16-positive test is small.

**Next closest:**

| Tag | Decider | Change needed for 50/50 | Best supply |
|---|---|---|---|
| glitch effect | CLAP head | +1 TP on 20 positives | 478 new open Freesound clips; BSD 681 staged |
| machine ambience | tagger | judge 9/9/11, +1 TP | VGGSound 1,455 staged; 76 CED open clips |
| crowd ambience | CLAP head | FSD50K eval .92/.492 on 256 positives, +2 TP | BSD 379 staged; 100 CED / 356 text open clips. The judge set already passes. |
| cello | CLAP head | .776/.488 on 121 positives, +2 TP | see below |
| whisper | tagger | FSD50K eval .84/.467, +2 TP | VGGSound 500 + AudioSet 498 staged |
| bassoon | CLAP head | .913/.467, +2 TP | RWC 332 + VGGSound 500 + URMP 14 staged; TinySOL / Iowa / Philharmonia bassoon |

Cello supply:
- staged URMP 101 and hidden-instruments Freesound 85;
- TinySOL Vc, Iowa MIS cello and Philharmonia cello;
- only 17 CED open clips, from 3 uploaders.

## The prepare-freesound.py gap (fixed on a draft branch, needs a re-prep)

**What leaks**
- `prepare-freesound.py` (lines 61-69) and `stage-freesound.py` (lines 58-77) skip FSD50K-eval clip ids and the reserved families, but **not judge-set or FSD50K-eval uploaders**.
- The cached Freesound training set (`prep-cache/cb691f46e32e/fsprep`) has 13,359 sounds. Of those:
  - **589 are by the 430 judge-set uploaders**;
  - 1,471 are by any of the 2,266 FSD50K-eval uploaders.

**What is already caught**
- The train-time drop list in today's recipe (`tagger-r20/v1/drop-train-ids.json`) already removes 550 of the 589 and 1,231 of the 1,471.
- It also catches all 1,009 judge-uploader rows in run9 and all 102 in fsnew.

**What still leaks**
- **39 training sounds by 25 judge-set uploaders** are still trained on, and 240 by FSD50K-eval uploaders.
- The ids are in `dge-data-gaps-2026-10-31-extra-drop-ids.json`.

**The fix**
- A draft-branch change adds the judge-set manifest uploaders and all FSD50K-eval uploaders to `bad_users`, case-insensitive, in both scripts.
- Checked against the cached set, it excludes exactly the 1,471.

**Cost of the fix**
- Every `prepare*.py` file is part of the prep-cache key (`hf-job.sh` line 66), so landing it forces a full base re-prep. That is about 3 h on L4, about **$2.40** (#276 `tag-step3-2026-10-31/README.md` line 21).
- The cheaper interim fix is to append the 39 (or 240) ids to the train-time drop list. That needs no re-prep, but it means writing a new drop file to private HF. I did not do that.

## Cost estimates (nothing launched)

- **CLAP-head tags** (vocal chops, breakbeat, filter sweep, foghorn bass, glitch, crowd, cello, bassoon, horn, electric piano, atmospheric pad, chops, spoken phrase, electric guitar, mallet): the head retrain runs on CPU. **No HF job, $0.**
- **Tagger tags** (animal sound, machine ambience, whisper, bird ambience, hi-hat, clap, snare, tambourine, voice, organ...): one tagger retrain with the per-tag additions on L4 at $0.80/h. Same 7 h cap as tonight's job, so **at most $5.60**. Add about **$2.40** if the prepare-freesound fix lands first. **Worst case about $8.00.** It needs Chris's yes.

## What the recipe-comparison run showed

The all-tags-nearmiss-recall run added E-GMD, Looperman, AudioSet, RWC, VGGSound, NVS and VocalSound wholesale.

**Gains** (FSD50K eval, tagger P/R vs r20):

| Tag | r20 | nearmiss-recall |
|---|---|---|
| clap | .61/.28 | .65/.73 |
| kick | .80/.14 | .91/.34 |
| hi-hat | .73/.21 | .95/.36 |
| snare | .76/.28 | .87/.38 |
| crash | .75/.45 | .80/.60 |
| whoosh | .59/.37 | .63/.44 |

**Losses:**
- bell P .76 -> .58
- vocal laugh P .91 -> .70
- breath P .91 -> .79
- tambourine R .47 -> .33
- voice R .32 -> .24

**Net:** the same 50/50 count. So add the staged sets **per tag** (E-GMD for kick/snare/hi-hat, AudioSet Clapping/Applause for clap), not wholesale.


## Every tag below 50/50 (counted sets with at least 10 test positives)

### vocal chops  (short of 50/50)
- Worst counted set: **gap:docs/evaluations/dj-labels-2026-10-04/added-heads-round14-bar45.json**: P 0.496 / R 0.731, 78 test positives; train clips (gap.json floor): 115. Decided by: CLAP head (sklearn head retrain, no HF job) (clap-head-maybe).
- To 50/50: +0 true positives, -1 false alarms. To 60/60 (on gap:docs/evaluations/dj-labels-2026-10-04/added-heads-round14-bar45.json): +0 TP, -20 FP.
- Missing: cleaner labels / tag definition + hard negatives (precision).
- Unused data already staged (private HF, train-only, unreviewed): 127 clips: round13/looperman-v1 106; datasets-v1/bsd-s1 12; datasets-v1/bsd-s0 9.
- New Freesound CC0/CC BY candidates after all exclusions: CED-scored 0 (0 uploaders); tag/title text match 1 (1 uploaders).
- Labelled sets: Freesound (CED-scored, CC0/BY) <https://freesound.org/> [CC0 / CC BY per sound; in recipe: yes (freesound, fsnew, run9) - new ids in freesound-candidates.csv]; Looperman <https://www.looperman.com/> [free royalty-free loops (Looperman terms); in recipe: staged round13/looperman-v1, unused]; FSD50K dev <https://zenodo.org/records/4060432> [CC0 / CC BY / CC BY-NC per clip (Freesound); in recipe: yes (fsd50k)]

### breakbeat  (short of 50/50)
- Worst counted set: **gap:docs/evaluations/dj-labels-2026-10-04/added-heads-round18.json**: P 0.662 / R 0.49, 104 test positives; train clips (gap.json floor): 1040. Decided by: CLAP head (sklearn head retrain, no HF job) (clap-head-maybe).
- To 50/50: +1 true positives, -0 false alarms. To 60/60 (on gap:docs/evaluations/dj-labels-2026-10-04/added-heads-round18.json): +12 TP, -0 FP.
- Missing: more clips (recall).
- Unused data already staged (private HF, train-only, unreviewed): 475 clips: round13/looperman-v1 210; datasets-v1/bsd-s1 142; datasets-v1/bsd-s0 123.
- New Freesound CC0/CC BY candidates after all exclusions: CED-scored 0 (0 uploaders); tag/title text match 212 (48 uploaders).
- Labelled sets: Looperman <https://www.looperman.com/> [free royalty-free loops (Looperman terms); in recipe: staged round13/looperman-v1, unused]; E-GMD <https://magenta.tensorflow.org/datasets/e-gmd> [CC BY 4.0; in recipe: staged round13/egmd-v2, unused]; Slakh2100 <https://zenodo.org/records/4599666> [CC BY 4.0; in recipe: yes (slakh, slakhmore)]

### filter sweep  (short of 50/50)
- Worst counted set: **gap:docs/evaluations/dj-effects-2026-10-06/shipped.json**: P 0.552 / R 0.485, 33 test positives; train clips (gap.json floor): 77. Decided by: CLAP head (sklearn head retrain, no HF job) (clap-head-maybe).
- To 50/50: +1 true positives, -0 false alarms. To 60/60 (on gap:docs/evaluations/dj-effects-2026-10-06/shipped.json): +4 TP, -0 FP.
- Missing: more clips (recall).
- Unused data already staged (private HF, train-only, unreviewed): 0 clips.
- New Freesound CC0/CC BY candidates after all exclusions: CED-scored 0 (0 uploaders); tag/title text match 3 (2 uploaders).
- Labelled sets: Freesound (CED-scored, CC0/BY) <https://freesound.org/> [CC0 / CC BY per sound; in recipe: yes (freesound, fsnew, run9) - new ids in freesound-candidates.csv]; Looperman <https://www.looperman.com/> [free royalty-free loops (Looperman terms); in recipe: staged round13/looperman-v1, unused]; FSD50K dev <https://zenodo.org/records/4060432> [CC0 / CC BY / CC BY-NC per clip (Freesound); in recipe: yes (fsd50k)]
- Note: Earlier lesson: DSP renders do not transfer; needs real recorded sweeps (Freesound/Looperman).

### animal sound  (short of 50/50)
- Worst counted set: **judge #276**: P 0.714 / R 0.484, 31 test positives; train clips (gap.json floor): 2976. Decided by: tagger (tagger).
- To 50/50: +1 true positives, -0 false alarms. To 60/60 (on judge #276): +4 TP, -0 FP.
- Judge #276: P 0.714 / R 0.484 on 31 positives (TP 15, FP 6, FN 16).
- Tagger recall-push-r1 on FSD50K eval: 0.95/0.49(594) (nearmiss-recall run: 0.96/0.48).
- Missing: more clips (recall).
- Unused data already staged (private HF, train-only, unreviewed): 1000 clips: datasets-v1/vggsound-s0 250; datasets-v1/vggsound-s1 250; coverage/v2/mined/part-1 170; coverage/v2/mined/part-0 168; coverage/v2/mined/part-2 160.
- New Freesound CC0/CC BY candidates after all exclusions: CED-scored 231 (131 uploaders); tag/title text match 10 (2 uploaders).
- Labelled sets: AudioSet (strong/weak) <https://research.google.com/audioset/> [labels CC BY 4.0; audio is YouTube (owner rights; training-only under your rules); in recipe: staged round13 audioset-a/b, unused]; VGGSound <https://www.robots.ox.ac.uk/~vgg/data/vggsound/> [labels CC BY 4.0; audio is YouTube (training-only); in recipe: staged datasets-v1 vggsound-s0/s1, unused]; xeno-canto <https://xeno-canto.org/> [per recording, mostly CC BY-NC-SA 4.0; in recipe: no]; ESC-50 <https://github.com/karolpiczak/ESC-50> [CC BY-NC 3.0 (Freesound clips: dedupe uploaders); in recipe: no]; FSD50K dev <https://zenodo.org/records/4060432> [CC0 / CC BY / CC BY-NC per clip (Freesound); in recipe: yes (fsd50k)]
- Note: Judge set: 27 of 31 positives are birds, so this moves with bird ambience recall.

### foghorn bass  (short of 50/50)
- Worst counted set: **gap:docs/evaluations/dj-labels-2026-10-04/added-heads-round16.json**: P 0.471 / R 0.5, 16 test positives; train clips (gap.json floor): 53. Decided by: CLAP head (sklearn head retrain, no HF job) (clap-head-maybe).
- To 50/50: +0 true positives, -1 false alarms. To 60/60 (on gap:docs/evaluations/dj-labels-2026-10-04/added-heads-round16.json): +2 TP, -3 FP.
- Missing: cleaner labels / tag definition + hard negatives (precision).
- Unused data already staged (private HF, train-only, unreviewed): 169 clips: datasets-v1/vggsound-s1 87; datasets-v1/vggsound-s0 80; mine-blocked/v1/part-0 2.
- New Freesound CC0/CC BY candidates after all exclusions: CED-scored 18 (14 uploaders); tag/title text match 0 (1 uploaders).
- Labelled sets: Freesound (CED-scored, CC0/BY) <https://freesound.org/> [CC0 / CC BY per sound; in recipe: yes (freesound, fsnew, run9) - new ids in freesound-candidates.csv]; Looperman <https://www.looperman.com/> [free royalty-free loops (Looperman terms); in recipe: staged round13/looperman-v1, unused]; FSD50K dev <https://zenodo.org/records/4060432> [CC0 / CC BY / CC BY-NC per clip (Freesound); in recipe: yes (fsd50k)]
- Note: AudioSet "Foghorn" is the literal ship horn, not the synth bass; those CED hits are weak candidates. Only 16 test positives.

### glitch effect  (short of 50/50)
- Worst counted set: **gap:docs/evaluations/dj-labels-2026-10-04/added-heads-round14-bar45.json**: P 1 / R 0.45, 20 test positives; train clips (gap.json floor): 79. Decided by: CLAP head (sklearn head retrain, no HF job) (clap-head-maybe).
- To 50/50: +1 true positives, -0 false alarms. To 60/60 (on gap:docs/evaluations/dj-labels-2026-10-04/added-heads-round14-bar45.json): +3 TP, -0 FP.
- Missing: more clips (recall).
- Unused data already staged (private HF, train-only, unreviewed): 712 clips: datasets-v1/bsd-s0 343; datasets-v1/bsd-s1 338; round13/looperman-v1 31.
- New Freesound CC0/CC BY candidates after all exclusions: CED-scored 0 (0 uploaders); tag/title text match 478 (89 uploaders).
- Labelled sets: Freesound (CED-scored, CC0/BY) <https://freesound.org/> [CC0 / CC BY per sound; in recipe: yes (freesound, fsnew, run9) - new ids in freesound-candidates.csv]; Looperman <https://www.looperman.com/> [free royalty-free loops (Looperman terms); in recipe: staged round13/looperman-v1, unused]; FSD50K dev <https://zenodo.org/records/4060432> [CC0 / CC BY / CC BY-NC per clip (Freesound); in recipe: yes (fsd50k)]

### machine ambience  (short of 50/50)
- Worst counted set: **judge #276**: P 0.5 / R 0.45, 20 test positives; train clips (gap.json floor): 927. Decided by: tagger (tagger).
- To 50/50: +1 true positives, -0 false alarms. To 60/60 (on judge #276): +3 TP, -1 FP.
- Judge #276: P 0.5 / R 0.45 on 20 positives (TP 9, FP 9, FN 11).
- Tagger recall-push-r1 on FSD50K eval: 0.63/0.51(301) (nearmiss-recall run: 0.65/0.48).
- Missing: more clips (recall).
- Unused data already staged (private HF, train-only, unreviewed): 1487 clips: datasets-v1/vggsound-s1 755; datasets-v1/vggsound-s0 700; coverage/v2/mined/part-1 17; coverage/v2/mined/part-2 9; coverage/v2/mined/part-0 6.
- New Freesound CC0/CC BY candidates after all exclusions: CED-scored 76 (50 uploaders); tag/title text match 0 (0 uploaders).
- Labelled sets: AudioSet (strong/weak) <https://research.google.com/audioset/> [labels CC BY 4.0; audio is YouTube (owner rights; training-only under your rules); in recipe: staged round13 audioset-a/b, unused]; VGGSound <https://www.robots.ox.ac.uk/~vgg/data/vggsound/> [labels CC BY 4.0; audio is YouTube (training-only); in recipe: staged datasets-v1 vggsound-s0/s1, unused]; ESC-50 <https://github.com/karolpiczak/ESC-50> [CC BY-NC 3.0 (Freesound clips: dedupe uploaders); in recipe: no]; UrbanSound8K <https://urbansounddataset.weebly.com/urbansound8k.html> [CC BY-NC 3.0 (Freesound clips: dedupe uploaders); in recipe: no]; FSD50K dev <https://zenodo.org/records/4060432> [CC0 / CC BY / CC BY-NC per clip (Freesound); in recipe: yes (fsd50k)]
- Note: Judge 9 TP / 9 FP / 11 FN: one more TP passes 50/50.

### crowd ambience  (short of 50/50)
- Worst counted set: **gap:fsd50k-eval**: P 0.92 / R 0.492, 256 test positives; train clips (gap.json floor): 576. Decided by: CLAP head (sklearn head retrain, no HF job) (clap-head).
- To 50/50: +2 true positives, -0 false alarms. To 60/60 (on gap:fsd50k-eval): +28 TP, -0 FP.
- Judge #276: P 0.778 / R 0.7 on 20 positives (TP 14, FP 4, FN 6).
- Tagger recall-push-r1 on FSD50K eval: 0.74/0.79(110) (nearmiss-recall run: 0.75/0.80).
- Missing: more clips (recall).
- Unused data already staged (private HF, train-only, unreviewed): 380 clips: datasets-v1/bsd-s1 202; datasets-v1/bsd-s0 177; datasets-v1/rwc 1.
- New Freesound CC0/CC BY candidates after all exclusions: CED-scored 100 (54 uploaders); tag/title text match 356 (178 uploaders).
- Labelled sets: AudioSet (strong/weak) <https://research.google.com/audioset/> [labels CC BY 4.0; audio is YouTube (owner rights; training-only under your rules); in recipe: staged round13 audioset-a/b, unused]; VGGSound <https://www.robots.ox.ac.uk/~vgg/data/vggsound/> [labels CC BY 4.0; audio is YouTube (training-only); in recipe: staged datasets-v1 vggsound-s0/s1, unused]; FSD50K dev <https://zenodo.org/records/4060432> [CC0 / CC BY / CC BY-NC per clip (Freesound); in recipe: yes (fsd50k)]
- Note: Judge set already passes (.78/.70); binding set is FSD50K eval. Judge positives are mostly applause.

### cello  (short of 50/50)
- Worst counted set: **gap:docs/evaluations/dj-labels-2026-10-04/added-heads-round18.json**: P 0.776 / R 0.488, 121 test positives; train clips (gap.json floor): 340. Decided by: CLAP head (sklearn head retrain, no HF job) (clap-head-maybe).
- To 50/50: +2 true positives, -0 false alarms. To 60/60 (on gap:docs/evaluations/dj-labels-2026-10-04/added-heads-round18.json): +14 TP, -0 FP.
- Missing: more clips (recall).
- Unused data already staged (private HF, train-only, unreviewed): 215 clips: hidden-instruments/urmp 101; hidden-instruments/freesound 85; coverage/v2/mined/part-2 17; coverage/v2/mined/part-1 11; coverage/v2/mined/part-0 1.
- New Freesound CC0/CC BY candidates after all exclusions: CED-scored 17 (3 uploaders); tag/title text match 24 (7 uploaders).
- Labelled sets: TinySOL <https://zenodo.org/records/3685367> [CC BY 4.0; in recipe: yes (tinysol)]; Univ. of Iowa MIS <https://theremin.music.uiowa.edu/MIS.html> [free to use, no restrictions (UIowa notice); in recipe: yes (iowa)]; Philharmonia samples <https://philharmonia.co.uk/resources/sound-samples/> [free; no resale of the samples themselves; in recipe: no]; URMP <https://labsites.rochester.edu/air/projects/URMP.html> [research use; in recipe: staged hidden-instruments/urmp, unused]; Good-Sounds <https://zenodo.org/records/4588740> [CC BY-NC 4.0; in recipe: no]; IRMAS <https://zenodo.org/records/1290750> [CC BY-NC-SA 3.0 (weights become NC); in recipe: partly (cel/cla skipped in instrument notes)]; OpenMIC-2018 <https://zenodo.org/records/1432913> [CC BY 4.0 (10 s clips from FMA); in recipe: no]; MedleyDB <https://medleydb.weebly.com/> [CC BY-NC-SA 4.0; in recipe: no]; RWC Music DB <https://staff.aist.go.jp/m.goto/RWC-MDB/> [research licence (AIST); in recipe: staged datasets-v1/rwc, unused]

### whisper  (short of 50/50)
- Worst counted set: **gap:eval-fsd50k/all**: P 0.84 / R 0.467, 45 test positives; train clips (gap.json floor): 142. Decided by: tagger (tagger).
- To 50/50: +2 true positives, -0 false alarms. To 60/60 (on gap:eval-fsd50k/all): +6 TP, -0 FP.
- Judge #276: P 0.536 / R 0.75 on 20 positives (TP 15, FP 13, FN 5); old head trained on FSD50K eval: may be inflated.
- Tagger recall-push-r1 on FSD50K eval: 0.91/0.42(45) (nearmiss-recall run: 0.88/0.47).
- Missing: more clips (recall).
- Unused data already staged (private HF, train-only, unreviewed): 1162 clips: round13/vocal-v1/audioset-b 261; datasets-v1/vggsound-s0 250; datasets-v1/vggsound-s1 250; round13/vocal-v1/audioset-a 237; datasets-v1/bsd-s0 66.
- New Freesound CC0/CC BY candidates after all exclusions: CED-scored 6 (4 uploaders); tag/title text match 37 (24 uploaders).
- Labelled sets: VocalSound <https://github.com/YuanGongND/vocalsound> [CC BY-SA 4.0; in recipe: staged round13 vocalsound, unused]; VocalSet <https://zenodo.org/records/1442513> [CC BY 4.0; in recipe: no]; LibriSpeech <https://www.openslr.org/12> [CC BY 4.0; in recipe: no]; Common Voice <https://commonvoice.mozilla.org/datasets> [CC0; in recipe: no]; AudioSet (strong/weak) <https://research.google.com/audioset/> [labels CC BY 4.0; audio is YouTube (owner rights; training-only under your rules); in recipe: staged round13 audioset-a/b, unused]

### bassoon  (short of 50/50)
- Worst counted set: **gap:docs/evaluations/dj-labels-2026-10-04/added-heads-round23.json**: P 0.913 / R 0.467, 45 test positives; train clips (gap.json floor): 192. Decided by: CLAP head (sklearn head retrain, no HF job) (clap-head-maybe).
- To 50/50: +2 true positives, -0 false alarms. To 60/60 (on gap:docs/evaluations/dj-labels-2026-10-04/added-heads-round23.json): +6 TP, -0 FP.
- Missing: more clips (recall).
- Unused data already staged (private HF, train-only, unreviewed): 878 clips: datasets-v1/rwc 332; datasets-v1/vggsound-s0 250; datasets-v1/vggsound-s1 250; datasets-v1/bsd-s1 20; hidden-instruments/urmp 14.
- New Freesound CC0/CC BY candidates after all exclusions: CED-scored 0 (0 uploaders); tag/title text match 0 (0 uploaders).
- Labelled sets: TinySOL <https://zenodo.org/records/3685367> [CC BY 4.0; in recipe: yes (tinysol)]; Univ. of Iowa MIS <https://theremin.music.uiowa.edu/MIS.html> [free to use, no restrictions (UIowa notice); in recipe: yes (iowa)]; Philharmonia samples <https://philharmonia.co.uk/resources/sound-samples/> [free; no resale of the samples themselves; in recipe: no]; URMP <https://labsites.rochester.edu/air/projects/URMP.html> [research use; in recipe: staged hidden-instruments/urmp, unused]; Good-Sounds <https://zenodo.org/records/4588740> [CC BY-NC 4.0; in recipe: no]; IRMAS <https://zenodo.org/records/1290750> [CC BY-NC-SA 3.0 (weights become NC); in recipe: partly (cel/cla skipped in instrument notes)]; OpenMIC-2018 <https://zenodo.org/records/1432913> [CC BY 4.0 (10 s clips from FMA); in recipe: no]; MedleyDB <https://medleydb.weebly.com/> [CC BY-NC-SA 4.0; in recipe: no]; RWC Music DB <https://staff.aist.go.jp/m.goto/RWC-MDB/> [research licence (AIST); in recipe: staged datasets-v1/rwc, unused]

### bird ambience  (short of 50/50)
- Worst counted set: **judge #276**: P 0.727 / R 0.4, 20 test positives; train clips (gap.json floor): 459. Decided by: tagger (tagger).
- To 50/50: +2 true positives, -0 false alarms. To 60/60 (on judge #276): +4 TP, -0 FP.
- Judge #276: P 0.727 / R 0.4 on 20 positives (TP 8, FP 3, FN 12).
- Tagger recall-push-r1 on FSD50K eval: 0.84/0.34(265) (nearmiss-recall run: 0.84/0.37).
- Missing: more clips (recall).
- Unused data already staged (private HF, train-only, unreviewed): 2251 clips: datasets-v1/bsd-s1 574; datasets-v1/bsd-s0 560; datasets-v1/vggsound-s0 250; datasets-v1/vggsound-s1 250; coverage/v2/mined/part-2 233.
- New Freesound CC0/CC BY candidates after all exclusions: CED-scored 259 (155 uploaders); tag/title text match 1186 (601 uploaders).
- Labelled sets: AudioSet (strong/weak) <https://research.google.com/audioset/> [labels CC BY 4.0; audio is YouTube (owner rights; training-only under your rules); in recipe: staged round13 audioset-a/b, unused]; VGGSound <https://www.robots.ox.ac.uk/~vgg/data/vggsound/> [labels CC BY 4.0; audio is YouTube (training-only); in recipe: staged datasets-v1 vggsound-s0/s1, unused]; xeno-canto <https://xeno-canto.org/> [per recording, mostly CC BY-NC-SA 4.0; in recipe: no]; ESC-50 <https://github.com/karolpiczak/ESC-50> [CC BY-NC 3.0 (Freesound clips: dedupe uploaders); in recipe: no]; FSD50K dev <https://zenodo.org/records/4060432> [CC0 / CC BY / CC BY-NC per clip (Freesound); in recipe: yes (fsd50k)]
- Note: Judge positives are bird calls/song, not ambience beds: train on bird vocalisation clips (AudioSet "Bird vocalization").

### reverberant  (short of 50/50)
- Worst counted set: **gap:free-tag-set**: P 1 / R 0.44, 45 test positives; train clips (gap.json floor): n/a. Decided by: tagger (tagger).
- To 50/50: +3 true positives, -0 false alarms. To 60/60 (on gap:free-tag-set): +7 TP, -0 FP.
- Tagger recall-push-r1 on NSynth test: 0.88/0.72(967) (nearmiss-recall: 0.88/0.72).
- Missing: more clips (recall).
- Unused data already staged (private HF, train-only, unreviewed): 975 clips: datasets-v1/bsd-s1 515; datasets-v1/bsd-s0 460.
- New Freesound CC0/CC BY candidates after all exclusions: CED-scored 0 (0 uploaders); tag/title text match 807 (361 uploaders).
- Labelled sets: Freesound (CED-scored, CC0/BY) <https://freesound.org/> [CC0 / CC BY per sound; in recipe: yes (freesound, fsnew, run9) - new ids in freesound-candidates.csv]; Looperman <https://www.looperman.com/> [free royalty-free loops (Looperman terms); in recipe: staged round13/looperman-v1, unused]; FSD50K dev <https://zenodo.org/records/4060432> [CC0 / CC BY / CC BY-NC per clip (Freesound); in recipe: yes (fsd50k)]

### tambourine  (short of 50/50)
- Worst counted set: **judge #276**: P 0.833 / R 0.333, 15 test positives; train clips (gap.json floor): 190. Decided by: tagger (tagger).
- To 50/50: +3 true positives, -0 false alarms. To 60/60 (on judge #276): +4 TP, -0 FP.
- Judge #276: P 0.833 / R 0.333 on 15 positives (TP 5, FP 1, FN 10).
- Tagger recall-push-r1 on FSD50K eval: 0.88/0.47(15) (nearmiss-recall run: 0.83/0.33).
- Missing: more clips (recall).
- Unused data already staged (private HF, train-only, unreviewed): 560 clips: datasets-v1/vggsound-s0 250; datasets-v1/vggsound-s1 250; datasets-v1/bsd-s1 22; datasets-v1/rwc 22; datasets-v1/bsd-s0 16.
- New Freesound CC0/CC BY candidates after all exclusions: CED-scored 0 (0 uploaders); tag/title text match 16 (3 uploaders).
- Labelled sets: VGGSound <https://www.robots.ox.ac.uk/~vgg/data/vggsound/> [labels CC BY 4.0; audio is YouTube (training-only); in recipe: staged datasets-v1 vggsound-s0/s1, unused]; RWC Music DB <https://staff.aist.go.jp/m.goto/RWC-MDB/> [research licence (AIST); in recipe: staged datasets-v1/rwc, unused]; Univ. of Iowa MIS <https://theremin.music.uiowa.edu/MIS.html> [free to use, no restrictions (UIowa notice); in recipe: yes (iowa)]; OpenMIC-2018 <https://zenodo.org/records/1432913> [CC BY 4.0 (10 s clips from FMA); in recipe: no]; FSD50K dev <https://zenodo.org/records/4060432> [CC0 / CC BY / CC BY-NC per clip (Freesound); in recipe: yes (fsd50k)]

### electric piano  (short of 50/50)
- Worst counted set: **gap:docs/evaluations/dj-labels-2026-10-04/added-heads-round18.json**: P 0.854 / R 0.455, 77 test positives; train clips (gap.json floor): 713. Decided by: CLAP head (sklearn head retrain, no HF job) (clap-head-maybe).
- To 50/50: +4 true positives, -0 false alarms. To 60/60 (on gap:docs/evaluations/dj-labels-2026-10-04/added-heads-round18.json): +12 TP, -0 FP.
- Tagger recall-push-r1 on NSynth test: 0.53/0.80(539) (nearmiss-recall: 0.58/0.78).
- Missing: more clips (recall).
- Unused data already staged (private HF, train-only, unreviewed): 340 clips: datasets-v1/rwc 216; datasets-v1/bsd-s0 40; datasets-v1/bsd-s1 33; coverage/v2/mined/part-2 22; coverage/v2/mined/part-1 16.
- New Freesound CC0/CC BY candidates after all exclusions: CED-scored 34 (11 uploaders); tag/title text match 16 (9 uploaders).
- Labelled sets: NSynth <https://magenta.tensorflow.org/datasets/nsynth> [CC BY 4.0; in recipe: yes (nsynth)]; Slakh2100 <https://zenodo.org/records/4599666> [CC BY 4.0; in recipe: yes (slakh, slakhmore)]; RWC Music DB <https://staff.aist.go.jp/m.goto/RWC-MDB/> [research licence (AIST); in recipe: staged datasets-v1/rwc, unused]; IRMAS <https://zenodo.org/records/1290750> [CC BY-NC-SA 3.0 (weights become NC); in recipe: partly (cel/cla skipped in instrument notes)]; OpenMIC-2018 <https://zenodo.org/records/1432913> [CC BY 4.0 (10 s clips from FMA); in recipe: no]; MedleyDB <https://medleydb.weebly.com/> [CC BY-NC-SA 4.0; in recipe: no]

### bell  (short of 50/50)
- Worst counted set: **judge #276**: P 0.423 / R 0.423, 26 test positives; train clips (gap.json floor): 704. Decided by: tagger (tagger).
- To 50/50: +2 true positives, -2 false alarms. To 60/60 (on judge #276): +5 TP, -5 FP.
- Judge #276: P 0.423 / R 0.423 on 26 positives (TP 11, FP 15, FN 15).
- Tagger recall-push-r1 on FSD50K eval: 0.75/0.60(206) (nearmiss-recall run: 0.58/0.68).
- Missing: more clips (recall); cleaner labels / tag definition + hard negatives (precision).
- Unused data already staged (private HF, train-only, unreviewed): 2698 clips: round13/looperman-v1 996; round13/vocal-v1/audioset-b 361; round13/vocal-v1/audioset-a 345; datasets-v1/vggsound-s0 250; datasets-v1/vggsound-s1 250.
- New Freesound CC0/CC BY candidates after all exclusions: CED-scored 31 (34 uploaders); tag/title text match 446 (221 uploaders).
- Labelled sets: VGGSound <https://www.robots.ox.ac.uk/~vgg/data/vggsound/> [labels CC BY 4.0; audio is YouTube (training-only); in recipe: staged datasets-v1 vggsound-s0/s1, unused]; RWC Music DB <https://staff.aist.go.jp/m.goto/RWC-MDB/> [research licence (AIST); in recipe: staged datasets-v1/rwc, unused]; Univ. of Iowa MIS <https://theremin.music.uiowa.edu/MIS.html> [free to use, no restrictions (UIowa notice); in recipe: yes (iowa)]; OpenMIC-2018 <https://zenodo.org/records/1432913> [CC BY 4.0 (10 s clips from FMA); in recipe: no]; FSD50K dev <https://zenodo.org/records/4060432> [CC0 / CC BY / CC BY-NC per clip (Freesound); in recipe: yes (fsd50k)]
- Note: Judge set: 20 of 26 positives are cowbell; precision .42. Add cowbell positives or narrow the definition. nearmiss-recall raised recall but cut precision .76 -> .58.

### spoken phrase  (short of 50/50)
- Worst counted set: **judge #276**: P 0.722 / R 0.382, 34 test positives; train clips (gap.json floor): 635. Decided by: CLAP head (sklearn head retrain, no HF job) (clap-head).
- To 50/50: +4 true positives, -0 false alarms. To 60/60 (on judge #276): +8 TP, -0 FP.
- Judge #276: P 0.722 / R 0.382 on 34 positives (TP 13, FP 5, FN 21).
- Tagger recall-push-r1 on FSD50K eval: 0.90/0.25(409) (nearmiss-recall run: 0.90/0.23).
- Missing: more clips (recall).
- Unused data already staged (private HF, train-only, unreviewed): 1477 clips: datasets-v1/bsd-s0 743; datasets-v1/bsd-s1 734.
- New Freesound CC0/CC BY candidates after all exclusions: CED-scored 4599 (1937 uploaders); tag/title text match 98 (25 uploaders).
- Labelled sets: VocalSound <https://github.com/YuanGongND/vocalsound> [CC BY-SA 4.0; in recipe: staged round13 vocalsound, unused]; VocalSet <https://zenodo.org/records/1442513> [CC BY 4.0; in recipe: no]; LibriSpeech <https://www.openslr.org/12> [CC BY 4.0; in recipe: no]; Common Voice <https://commonvoice.mozilla.org/datasets> [CC0; in recipe: no]; AudioSet (strong/weak) <https://research.google.com/audioset/> [labels CC BY 4.0; audio is YouTube (owner rights; training-only under your rules); in recipe: staged round13 audioset-a/b, unused]

### snare  (short of 50/50)
- Worst counted set: **judge #276**: P 0.667 / R 0.333, 24 test positives; train clips (gap.json floor): 648. Decided by: clap-head (clap-head).
- To 50/50: +4 true positives, -0 false alarms. To 60/60 (on judge #276): +7 TP, -0 FP.
- Judge #276: P 0.667 / R 0.333 on 24 positives (TP 8, FP 4, FN 16).
- Tagger recall-push-r1 on FSD50K eval: 0.75/0.27(68) (nearmiss-recall run: 0.87/0.38).
- Missing: more clips (recall).
- Unused data already staged (private HF, train-only, unreviewed): 4607 clips: round13/egmd-v2 2743; datasets-v1/rwc 478; datasets-v1/bsd-s0 341; datasets-v1/bsd-s1 319; datasets-v1/vggsound-s0 250.
- New Freesound CC0/CC BY candidates after all exclusions: CED-scored 64 (23 uploaders); tag/title text match 321 (79 uploaders).
- Labelled sets: E-GMD <https://magenta.tensorflow.org/datasets/e-gmd> [CC BY 4.0; in recipe: staged round13/egmd-v2, unused]; MDB Drums <https://github.com/CarlSouthall/MDBDrums> [CC BY-NC-SA 4.0; in recipe: no]; IDMT-SMT-Drums <https://zenodo.org/records/7544164> [CC BY-NC-ND 4.0 (ND: flag before training); in recipe: no]; Looperman <https://www.looperman.com/> [free royalty-free loops (Looperman terms); in recipe: staged round13/looperman-v1, unused]; FSD50K dev <https://zenodo.org/records/4060432> [CC0 / CC BY / CC BY-NC per clip (Freesound); in recipe: yes (fsd50k)]
- Note: Judge positives are full drum kits. E-GMD staged egmd-v2 has 2,743 snare. nearmiss-recall .76/.28 -> .87/.38.

### clap  (short of 50/50)
- Worst counted set: **judge #276**: P 0.833 / R 0.238, 21 test positives; train clips (gap.json floor): 320. Decided by: tagger (tagger).
- To 50/50: +6 true positives, -0 false alarms. To 60/60 (on judge #276): +8 TP, -0 FP.
- Judge #276: P 0.833 / R 0.238 on 21 positives (TP 5, FP 1, FN 16).
- Tagger recall-push-r1 on FSD50K eval: 0.55/0.20(79) (nearmiss-recall run: 0.65/0.73).
- Missing: more clips (recall).
- Unused data already staged (private HF, train-only, unreviewed): 1663 clips: round13/vocal-v1/audioset-b 620; round13/vocal-v1/audioset-a 601; datasets-v1/bsd-s1 162; datasets-v1/bsd-s0 157; coverage/v2/mined/part-2 46.
- New Freesound CC0/CC BY candidates after all exclusions: CED-scored 0 (0 uploaders); tag/title text match 170 (65 uploaders).
- Labelled sets: AudioSet (strong/weak) <https://research.google.com/audioset/> [labels CC BY 4.0; audio is YouTube (owner rights; training-only under your rules); in recipe: staged round13 audioset-a/b, unused]; VGGSound <https://www.robots.ox.ac.uk/~vgg/data/vggsound/> [labels CC BY 4.0; audio is YouTube (training-only); in recipe: staged datasets-v1 vggsound-s0/s1, unused]; FSD50K dev <https://zenodo.org/records/4060432> [CC0 / CC BY / CC BY-NC per clip (Freesound); in recipe: yes (fsd50k)]
- Note: Judge set: 15 of 21 positives are applause. Decide whether "clap" includes applause, then add AudioSet Clapping/Applause or relabel the judge rows. nearmiss-recall (adds AudioSet + E-GMD) took FSD50K clap recall .28 -> .73.

### vocal shout  (short of 50/50)
- Worst counted set: **judge #276**: P 0.36 / R 0.45, 20 test positives; train clips (gap.json floor): 252. Decided by: clap-head (clap-head).
- To 50/50: +1 true positives, -6 false alarms. To 60/60 (on judge #276): +3 TP, -8 FP.
- Judge #276: P 0.36 / R 0.45 on 20 positives (TP 9, FP 16, FN 11).
- Tagger recall-push-r1 on FSD50K eval: 0.37/0.33(69) (nearmiss-recall run: 0.35/0.35).
- Missing: more clips (recall); cleaner labels / tag definition + hard negatives (precision).
- Unused data already staged (private HF, train-only, unreviewed): 2965 clips: round13/vocal-v1/audioset-b 1254; round13/vocal-v1/audioset-a 1176; datasets-v1/vggsound-s0 199; datasets-v1/vggsound-s1 193; datasets-v1/bsd-s1 75.
- New Freesound CC0/CC BY candidates after all exclusions: CED-scored 3 (2 uploaders); tag/title text match 116 (54 uploaders).
- Labelled sets: VocalSound <https://github.com/YuanGongND/vocalsound> [CC BY-SA 4.0; in recipe: staged round13 vocalsound, unused]; VocalSet <https://zenodo.org/records/1442513> [CC BY 4.0; in recipe: no]; LibriSpeech <https://www.openslr.org/12> [CC BY 4.0; in recipe: no]; Common Voice <https://commonvoice.mozilla.org/datasets> [CC0; in recipe: no]; AudioSet (strong/weak) <https://research.google.com/audioset/> [labels CC BY 4.0; audio is YouTube (owner rights; training-only under your rules); in recipe: staged round13 audioset-a/b, unused]

### water ambience  (short of 50/50)
- Worst counted set: **judge #276**: P 0.375 / R 0.75, 20 test positives; train clips (gap.json floor): 495. Decided by: tagger (tagger).
- To 50/50: +0 true positives, -10 false alarms. To 60/60 (on judge #276): +0 TP, -15 FP.
- Judge #276: P 0.375 / R 0.75 on 20 positives (TP 15, FP 25, FN 5); old head trained on FSD50K eval: may be inflated.
- Tagger recall-push-r1 on FSD50K eval: 0.73/0.53(229) (nearmiss-recall run: 0.68/0.57).
- Missing: cleaner labels / tag definition + hard negatives (precision).
- Unused data already staged (private HF, train-only, unreviewed): 1887 clips: datasets-v1/bsd-s1 555; datasets-v1/bsd-s0 543; coverage/v2/mined/part-2 278; coverage/v2/mined/part-1 263; coverage/v2/mined/part-0 248.
- New Freesound CC0/CC BY candidates after all exclusions: CED-scored 352 (219 uploaders); tag/title text match 2361 (1105 uploaders).
- Labelled sets: AudioSet (strong/weak) <https://research.google.com/audioset/> [labels CC BY 4.0; audio is YouTube (owner rights; training-only under your rules); in recipe: staged round13 audioset-a/b, unused]; VGGSound <https://www.robots.ox.ac.uk/~vgg/data/vggsound/> [labels CC BY 4.0; audio is YouTube (training-only); in recipe: staged datasets-v1 vggsound-s0/s1, unused]; ESC-50 <https://github.com/karolpiczak/ESC-50> [CC BY-NC 3.0 (Freesound clips: dedupe uploaders); in recipe: no]; UrbanSound8K <https://urbansounddataset.weebly.com/urbansound8k.html> [CC BY-NC 3.0 (Freesound clips: dedupe uploaders); in recipe: no]; FSD50K dev <https://zenodo.org/records/4060432> [CC0 / CC BY / CC BY-NC per clip (Freesound); in recipe: yes (fsd50k)]
- Note: Old head trained on FSD50K eval: judge number may be inflated. Precision short (.38).

### hi-hat  (short of 50/50)
- Worst counted set: **gap:eval-fsd50k/all**: P 0.762 / R 0.308, 52 test positives; train clips (gap.json floor): 384. Decided by: tagger (tagger).
- To 50/50: +10 true positives, -0 false alarms. To 60/60 (on gap:eval-fsd50k/all): +16 TP, -0 FP.
- Judge #276: P 0.583 / R 0.35 on 20 positives (TP 7, FP 5, FN 13).
- Tagger recall-push-r1 on FSD50K eval: 0.73/0.21(52) (nearmiss-recall run: 0.95/0.36).
- Missing: more clips (recall).
- Unused data already staged (private HF, train-only, unreviewed): 2702 clips: round13/egmd-v2 2145; datasets-v1/rwc 177; datasets-v1/bsd-s1 127; datasets-v1/bsd-s0 114; coverage/v2/mined/part-2 51.
- New Freesound CC0/CC BY candidates after all exclusions: CED-scored 36 (14 uploaders); tag/title text match 148 (46 uploaders).
- Labelled sets: E-GMD <https://magenta.tensorflow.org/datasets/e-gmd> [CC BY 4.0; in recipe: staged round13/egmd-v2, unused]; MDB Drums <https://github.com/CarlSouthall/MDBDrums> [CC BY-NC-SA 4.0; in recipe: no]; IDMT-SMT-Drums <https://zenodo.org/records/7544164> [CC BY-NC-ND 4.0 (ND: flag before training); in recipe: no]; Looperman <https://www.looperman.com/> [free royalty-free loops (Looperman terms); in recipe: staged round13/looperman-v1, unused]; FSD50K dev <https://zenodo.org/records/4060432> [CC0 / CC BY / CC BY-NC per clip (Freesound); in recipe: yes (fsd50k)]
- Note: Judge positives are full drum kits. Needs in-kit hits: E-GMD (staged egmd-v2, 2,145 hi-hat). nearmiss-recall took FSD50K hi-hat .73/.21 -> .95/.36.

### wind ambience  (short of 50/50)
- Worst counted set: **judge #276**: P 0.323 / R 0.5, 20 test positives; train clips (gap.json floor): n/a. Decided by: raw-prompt (raw-prompt).
- To 50/50: +0 true positives, -11 false alarms. To 60/60 (on judge #276): +2 TP, -13 FP.
- Judge #276: P 0.323 / R 0.5 on 20 positives (TP 10, FP 21, FN 10).
- Tagger recall-push-r1 on FSD50K eval: 0.27/0.23(66) (nearmiss-recall run: 0.29/0.20).
- Missing: cleaner labels / tag definition + hard negatives (precision).
- Unused data already staged (private HF, train-only, unreviewed): 1579 clips: datasets-v1/vggsound-s1 500; datasets-v1/vggsound-s0 473; datasets-v1/bsd-s1 298; datasets-v1/bsd-s0 293; coverage/v2/mined/part-0 9.
- New Freesound CC0/CC BY candidates after all exclusions: CED-scored 13 (11 uploaders); tag/title text match 621 (353 uploaders).
- Labelled sets: AudioSet (strong/weak) <https://research.google.com/audioset/> [labels CC BY 4.0; audio is YouTube (owner rights; training-only under your rules); in recipe: staged round13 audioset-a/b, unused]; VGGSound <https://www.robots.ox.ac.uk/~vgg/data/vggsound/> [labels CC BY 4.0; audio is YouTube (training-only); in recipe: staged datasets-v1 vggsound-s0/s1, unused]; ESC-50 <https://github.com/karolpiczak/ESC-50> [CC BY-NC 3.0 (Freesound clips: dedupe uploaders); in recipe: no]; UrbanSound8K <https://urbansounddataset.weebly.com/urbansound8k.html> [CC BY-NC 3.0 (Freesound clips: dedupe uploaders); in recipe: no]; FSD50K dev <https://zenodo.org/records/4060432> [CC0 / CC BY / CC BY-NC per clip (Freesound); in recipe: yes (fsd50k)]
- Note: Precision .32: confused with other noise beds; add hard negatives (mic wind noise vs wind beds).

### atmospheric pad  (short of 50/50)
- Worst counted set: **gap:docs/evaluations/dj-labels-2026-10-04/added-heads-round21.json**: P 0.671 / R 0.482, 631 test positives; train clips (gap.json floor): 3136. Decided by: CLAP head (sklearn head retrain, no HF job) (clap-head-maybe).
- To 50/50: +12 true positives, -0 false alarms. To 60/60 (on gap:docs/evaluations/dj-labels-2026-10-04/added-heads-round21.json): +75 TP, -0 FP.
- Missing: more clips (recall).
- Unused data already staged (private HF, train-only, unreviewed): 768 clips: datasets-v1/bsd-s1 298; datasets-v1/bsd-s0 290; datasets-v1/dsp-arp-v2 180.
- New Freesound CC0/CC BY candidates after all exclusions: CED-scored 0 (0 uploaders); tag/title text match 427 (165 uploaders).
- Labelled sets: Freesound (CED-scored, CC0/BY) <https://freesound.org/> [CC0 / CC BY per sound; in recipe: yes (freesound, fsnew, run9) - new ids in freesound-candidates.csv]; Looperman <https://www.looperman.com/> [free royalty-free loops (Looperman terms); in recipe: staged round13/looperman-v1, unused]; FSD50K dev <https://zenodo.org/records/4060432> [CC0 / CC BY / CC BY-NC per clip (Freesound); in recipe: yes (fsd50k)]

### horn  (short of 50/50)
- Worst counted set: **gap:docs/evaluations/dj-labels-2026-10-04/added-heads-round19.json**: P 0.815 / R 0.459, 316 test positives; train clips (gap.json floor): 947. Decided by: CLAP head (sklearn head retrain, no HF job) (clap-head-maybe).
- To 50/50: +13 true positives, -0 false alarms. To 60/60 (on gap:docs/evaluations/dj-labels-2026-10-04/added-heads-round19.json): +45 TP, -0 FP.
- Missing: more clips (recall).
- Unused data already staged (private HF, train-only, unreviewed): 1088 clips: datasets-v1/rwc 495; datasets-v1/vggsound-s0 250; datasets-v1/vggsound-s1 250; datasets-v1/bsd-s1 52; datasets-v1/bsd-s0 40.
- New Freesound CC0/CC BY candidates after all exclusions: CED-scored 0 (0 uploaders); tag/title text match 202 (122 uploaders).
- Labelled sets: TinySOL <https://zenodo.org/records/3685367> [CC BY 4.0; in recipe: yes (tinysol)]; Univ. of Iowa MIS <https://theremin.music.uiowa.edu/MIS.html> [free to use, no restrictions (UIowa notice); in recipe: yes (iowa)]; Philharmonia samples <https://philharmonia.co.uk/resources/sound-samples/> [free; no resale of the samples themselves; in recipe: no]; URMP <https://labsites.rochester.edu/air/projects/URMP.html> [research use; in recipe: staged hidden-instruments/urmp, unused]; Good-Sounds <https://zenodo.org/records/4588740> [CC BY-NC 4.0; in recipe: no]; IRMAS <https://zenodo.org/records/1290750> [CC BY-NC-SA 3.0 (weights become NC); in recipe: partly (cel/cla skipped in instrument notes)]; OpenMIC-2018 <https://zenodo.org/records/1432913> [CC BY 4.0 (10 s clips from FMA); in recipe: no]; MedleyDB <https://medleydb.weebly.com/> [CC BY-NC-SA 4.0; in recipe: no]; RWC Music DB <https://staff.aist.go.jp/m.goto/RWC-MDB/> [research licence (AIST); in recipe: staged datasets-v1/rwc, unused]

### chops  (short of 50/50)
- Worst counted set: **gap:docs/evaluations/dj-labels-2026-10-04/added-heads-round14-bar45.json**: P 0.45 / R 0.733, 86 test positives; train clips (gap.json floor): 139. Decided by: CLAP head (sklearn head retrain, no HF job) (clap-head-maybe).
- To 50/50: +0 true positives, -14 false alarms. To 60/60 (on gap:docs/evaluations/dj-labels-2026-10-04/added-heads-round14-bar45.json): +0 TP, -35 FP.
- Missing: cleaner labels / tag definition + hard negatives (precision).
- Unused data already staged (private HF, train-only, unreviewed): 182 clips: round13/looperman-v1 140; datasets-v1/bsd-s1 25; datasets-v1/bsd-s0 17.
- New Freesound CC0/CC BY candidates after all exclusions: CED-scored 0 (0 uploaders); tag/title text match 18 (6 uploaders).
- Labelled sets: Freesound (CED-scored, CC0/BY) <https://freesound.org/> [CC0 / CC BY per sound; in recipe: yes (freesound, fsnew, run9) - new ids in freesound-candidates.csv]; Looperman <https://www.looperman.com/> [free royalty-free loops (Looperman terms); in recipe: staged round13/looperman-v1, unused]; FSD50K dev <https://zenodo.org/records/4060432> [CC0 / CC BY / CC BY-NC per clip (Freesound); in recipe: yes (fsd50k)]

### voice  (short of 50/50)
- Worst counted set: **gap:eval-nsynth-test/all**: P 0.814 / R 0.404, 141 test positives; train clips (gap.json floor): 3665. Decided by: tagger (tagger).
- To 50/50: +14 true positives, -0 false alarms. To 60/60 (on gap:eval-nsynth-test/all): +28 TP, -0 FP.
- Judge #276: P 0.536 / R 0.525 on 99 positives (TP 52, FP 45, FN 47).
- Tagger recall-push-r1 on FSD50K eval: 0.99/0.33(750) (nearmiss-recall run: 0.99/0.24).
- Missing: more clips (recall).
- Unused data already staged (private HF, train-only, unreviewed): 8574 clips: datasets-v1/rwc 2800; datasets-v1/bsd-s1 1062; datasets-v1/bsd-s0 1052; round13/looperman-v1 1000; datasets-v1/vggsound-s0 949.
- New Freesound CC0/CC BY candidates after all exclusions: CED-scored 0 (0 uploaders); tag/title text match 1594 (536 uploaders).
- Labelled sets: VocalSound <https://github.com/YuanGongND/vocalsound> [CC BY-SA 4.0; in recipe: staged round13 vocalsound, unused]; VocalSet <https://zenodo.org/records/1442513> [CC BY 4.0; in recipe: no]; LibriSpeech <https://www.openslr.org/12> [CC BY 4.0; in recipe: no]; Common Voice <https://commonvoice.mozilla.org/datasets> [CC0; in recipe: no]; AudioSet (strong/weak) <https://research.google.com/audioset/> [labels CC BY 4.0; audio is YouTube (owner rights; training-only under your rules); in recipe: staged round13 audioset-a/b, unused]

### piano  (short of 50/50)
- Worst counted set: **judge #276**: P 0.294 / R 0.75, 20 test positives; train clips (gap.json floor): 684. Decided by: tagger (tagger).
- To 50/50: +0 true positives, -21 false alarms. To 60/60 (on judge #276): +0 TP, -26 FP.
- Judge #276: P 0.294 / R 0.75 on 20 positives (TP 15, FP 36, FN 5); old head trained on FSD50K eval: may be inflated.
- Tagger recall-push-r1 on FSD50K eval: 0.38/0.65(26) (nearmiss-recall run: 0.41/0.65).
- Tagger recall-push-r1 on NSynth test: 0.46/0.60(119) (nearmiss-recall: 0.44/0.56).
- Missing: cleaner labels / tag definition + hard negatives (precision).
- Unused data already staged (private HF, train-only, unreviewed): 1030 clips: datasets-v1/bsd-s0 366; datasets-v1/bsd-s1 364; datasets-v1/rwc 300.
- New Freesound CC0/CC BY candidates after all exclusions: CED-scored 164 (74 uploaders); tag/title text match 790 (261 uploaders).
- Labelled sets: NSynth <https://magenta.tensorflow.org/datasets/nsynth> [CC BY 4.0; in recipe: yes (nsynth)]; Slakh2100 <https://zenodo.org/records/4599666> [CC BY 4.0; in recipe: yes (slakh, slakhmore)]; RWC Music DB <https://staff.aist.go.jp/m.goto/RWC-MDB/> [research licence (AIST); in recipe: staged datasets-v1/rwc, unused]; IRMAS <https://zenodo.org/records/1290750> [CC BY-NC-SA 3.0 (weights become NC); in recipe: partly (cel/cla skipped in instrument notes)]; OpenMIC-2018 <https://zenodo.org/records/1432913> [CC BY 4.0 (10 s clips from FMA); in recipe: no]; MedleyDB <https://medleydb.weebly.com/> [CC BY-NC-SA 4.0; in recipe: no]
- Note: Old head trained on FSD50K eval: the judge number may be inflated. Precision short: needs hard negatives (electric piano, keys) more than clips.

### foley  (short of 50/50)
- Worst counted set: **judge #276**: P 0.19 / R 0.4, 20 test positives; train clips (gap.json floor): 2965. Decided by: tagger (tagger).
- To 50/50: +2 true positives, -24 false alarms. To 60/60 (on judge #276): +4 TP, -26 FP.
- Judge #276: P 0.19 / R 0.4 on 20 positives (TP 8, FP 34, FN 12).
- Tagger recall-push-r1 on FSD50K eval: 0.68/0.68(763) (nearmiss-recall run: 0.69/0.67).
- Missing: more clips (recall); cleaner labels / tag definition + hard negatives (precision).
- Unused data already staged (private HF, train-only, unreviewed): 3168 clips: datasets-v1/bsd-s1 1162; datasets-v1/bsd-s0 1131; datasets-v1/vggsound-s1 432; datasets-v1/vggsound-s0 421; coverage/v2/mined/part-2 14.
- New Freesound CC0/CC BY candidates after all exclusions: CED-scored 0 (0 uploaders); tag/title text match 1012 (182 uploaders).
- Labelled sets: Freesound (CED-scored, CC0/BY) <https://freesound.org/> [CC0 / CC BY per sound; in recipe: yes (freesound, fsnew, run9) - new ids in freesound-candidates.csv]; Looperman <https://www.looperman.com/> [free royalty-free loops (Looperman terms); in recipe: staged round13/looperman-v1, unused]; FSD50K dev <https://zenodo.org/records/4060432> [CC0 / CC BY / CC BY-NC per clip (Freesound); in recipe: yes (fsd50k)]
- Note: Precision .19: the definition is too broad; needs a tighter tag definition and hard negatives, not more clips.

### drums  (short of 50/50)
- Worst counted set: **judge #276**: P 0.361 / R 0.889, 63 test positives; train clips (gap.json floor): 289. Decided by: tagger (tagger).
- To 50/50: +0 true positives, -43 false alarms. To 60/60 (on judge #276): +0 TP, -62 FP.
- Judge #276: P 0.361 / R 0.889 on 63 positives (TP 56, FP 99, FN 7); old head trained on FSD50K eval: may be inflated.
- Tagger recall-push-r1 on FSD50K eval: 0.32/0.84(31) (nearmiss-recall run: 0.29/0.81).
- Missing: cleaner labels / tag definition + hard negatives (precision).
- Unused data already staged (private HF, train-only, unreviewed): 7253 clips: round13/egmd-v2 2817; round13/looperman-v1 996; datasets-v1/rwc 983; datasets-v1/bsd-s0 721; datasets-v1/bsd-s1 703.
- New Freesound CC0/CC BY candidates after all exclusions: CED-scored 0 (0 uploaders); tag/title text match 998 (284 uploaders).
- Labelled sets: Looperman <https://www.looperman.com/> [free royalty-free loops (Looperman terms); in recipe: staged round13/looperman-v1, unused]; E-GMD <https://magenta.tensorflow.org/datasets/e-gmd> [CC BY 4.0; in recipe: staged round13/egmd-v2, unused]; Slakh2100 <https://zenodo.org/records/4599666> [CC BY 4.0; in recipe: yes (slakh, slakhmore)]
- Note: Old head trained on FSD50K eval: may be inflated. Precision .36.

### mallet instrument  (short of 50/50)
- Worst counted set: **gap:nsynth-test**: P 0.386 / R 0.663, 172 test positives; train clips (gap.json floor): 249. Decided by: CLAP head (sklearn head retrain, no HF job) (clap-head).
- To 50/50: +0 true positives, -67 false alarms. To 60/60 (on gap:nsynth-test): +0 TP, -105 FP.
- Judge #276: P 0.68 / R 0.773 on 22 positives (TP 17, FP 8, FN 5); old head trained on FSD50K eval: may be inflated.
- Tagger recall-push-r1 on FSD50K eval: 0.71/0.81(95) (nearmiss-recall run: 0.78/0.79).
- Tagger recall-push-r1 on NSynth test: 0.84/0.47(202) (nearmiss-recall: 0.80/0.47).
- Missing: cleaner labels / tag definition + hard negatives (precision).
- Unused data already staged (private HF, train-only, unreviewed): 2065 clips: datasets-v1/vggsound-s0 750; datasets-v1/vggsound-s1 750; datasets-v1/rwc 565.
- New Freesound CC0/CC BY candidates after all exclusions: CED-scored 0 (0 uploaders); tag/title text match 0 (0 uploaders).
- Labelled sets: VGGSound <https://www.robots.ox.ac.uk/~vgg/data/vggsound/> [labels CC BY 4.0; audio is YouTube (training-only); in recipe: staged datasets-v1 vggsound-s0/s1, unused]; RWC Music DB <https://staff.aist.go.jp/m.goto/RWC-MDB/> [research licence (AIST); in recipe: staged datasets-v1/rwc, unused]; Univ. of Iowa MIS <https://theremin.music.uiowa.edu/MIS.html> [free to use, no restrictions (UIowa notice); in recipe: yes (iowa)]; OpenMIC-2018 <https://zenodo.org/records/1432913> [CC BY 4.0 (10 s clips from FMA); in recipe: no]; FSD50K dev <https://zenodo.org/records/4060432> [CC0 / CC BY / CC BY-NC per clip (Freesound); in recipe: yes (fsd50k)]

### guitar  (short of 50/50)
- Worst counted set: **gap:nsynth-test (positives not listed)**: P 0.67 / R 0.42, n/a test positives; train clips (gap.json floor): 1594. Decided by: tagger (tagger).
- To 50/50: +? true positives, -? false alarms. To 60/60 (on gap:nsynth-test (positives not listed)): +? TP, -? FP.
- Judge #276: P 0.754 / R 0.78 on 59 positives (TP 46, FP 15, FN 13).
- Tagger recall-push-r1 on FSD50K eval: 0.89/0.78(213) (nearmiss-recall run: 0.91/0.79).
- Tagger recall-push-r1 on NSynth test: 0.77/0.19(652) (nearmiss-recall: 0.79/0.24).
- Missing: more clips (recall).
- Unused data already staged (private HF, train-only, unreviewed): 2118 clips: datasets-v1/rwc 1074; datasets-v1/bsd-s1 281; datasets-v1/bsd-s0 263; datasets-v1/vggsound-s0 250; datasets-v1/vggsound-s1 250.
- New Freesound CC0/CC BY candidates after all exclusions: CED-scored 0 (0 uploaders); tag/title text match 854 (302 uploaders).
- Labelled sets: GuitarSet <https://zenodo.org/records/3371780> [CC BY 4.0; in recipe: no]; IDMT-SMT-Guitar <https://zenodo.org/records/7544110> [CC BY-NC-ND 4.0 (ND: flag before training); in recipe: no]; NSynth <https://magenta.tensorflow.org/datasets/nsynth> [CC BY 4.0; in recipe: yes (nsynth)]; Slakh2100 <https://zenodo.org/records/4599666> [CC BY 4.0; in recipe: yes (slakh, slakhmore)]; IRMAS <https://zenodo.org/records/1290750> [CC BY-NC-SA 3.0 (weights become NC); in recipe: partly (cel/cla skipped in instrument notes)]; RWC Music DB <https://staff.aist.go.jp/m.goto/RWC-MDB/> [research licence (AIST); in recipe: staged datasets-v1/rwc, unused]

### organ  (short of 50/50)
- Worst counted set: **gap:fsd50k-eval (positives not listed)**: P 0.82 / R 0.4, n/a test positives; train clips (gap.json floor): 268. Decided by: tagger (tagger).
- To 50/50: +? true positives, -? false alarms. To 60/60 (on gap:fsd50k-eval (positives not listed)): +? TP, -? FP.
- Judge #276: P 0.769 / R 0.526 on 19 positives (TP 10, FP 3, FN 9); old head trained on FSD50K eval: may be inflated.
- Tagger recall-push-r1 on FSD50K eval: 0.79/0.55(20) (nearmiss-recall run: 0.79/0.55).
- Tagger recall-push-r1 on NSynth test: 0.94/0.62(502) (nearmiss-recall: 0.94/0.62).
- Missing: more clips (recall).
- Unused data already staged (private HF, train-only, unreviewed): 1421 clips: datasets-v1/vggsound-s0 500; datasets-v1/vggsound-s1 500; datasets-v1/rwc 197; datasets-v1/bsd-s0 110; datasets-v1/bsd-s1 98.
- New Freesound CC0/CC BY candidates after all exclusions: CED-scored 12 (8 uploaders); tag/title text match 136 (55 uploaders).
- Labelled sets: NSynth <https://magenta.tensorflow.org/datasets/nsynth> [CC BY 4.0; in recipe: yes (nsynth)]; Slakh2100 <https://zenodo.org/records/4599666> [CC BY 4.0; in recipe: yes (slakh, slakhmore)]; RWC Music DB <https://staff.aist.go.jp/m.goto/RWC-MDB/> [research licence (AIST); in recipe: staged datasets-v1/rwc, unused]; IRMAS <https://zenodo.org/records/1290750> [CC BY-NC-SA 3.0 (weights become NC); in recipe: partly (cel/cla skipped in instrument notes)]; OpenMIC-2018 <https://zenodo.org/records/1432913> [CC BY 4.0 (10 s clips from FMA); in recipe: no]; MedleyDB <https://medleydb.weebly.com/> [CC BY-NC-SA 4.0; in recipe: no]

### electric guitar  (short of 50/50)
- Worst counted set: **gap:nsynth-test**: P 0.154 / R 0.66, 100 test positives; train clips (gap.json floor): 440. Decided by: CLAP head (sklearn head retrain, no HF job) (clap-head).
- To 50/50: +0 true positives, -297 false alarms. To 60/60 (on gap:nsynth-test): +0 TP, -319 FP.
- Judge #276: P 0.812 / R 0.65 on 20 positives (TP 13, FP 3, FN 7); old head trained on FSD50K eval: may be inflated.
- Tagger recall-push-r1 on FSD50K eval: 0.88/0.61(109) (nearmiss-recall run: 0.90/0.58).
- Tagger recall-push-r1 on NSynth test: 0.54/0.04(171) (nearmiss-recall: 0.48/0.08).
- Missing: cleaner labels / tag definition + hard negatives (precision).
- Unused data already staged (private HF, train-only, unreviewed): 383 clips: datasets-v1/rwc 359; datasets-v1/bsd-s1 10; datasets-v1/bsd-s0 8; coverage/v2/mined/part-0 3; coverage/v2/mined/part-2 3.
- New Freesound CC0/CC BY candidates after all exclusions: CED-scored 0 (0 uploaders); tag/title text match 108 (29 uploaders).
- Labelled sets: GuitarSet <https://zenodo.org/records/3371780> [CC BY 4.0; in recipe: no]; IDMT-SMT-Guitar <https://zenodo.org/records/7544110> [CC BY-NC-ND 4.0 (ND: flag before training); in recipe: no]; NSynth <https://magenta.tensorflow.org/datasets/nsynth> [CC BY 4.0; in recipe: yes (nsynth)]; Slakh2100 <https://zenodo.org/records/4599666> [CC BY 4.0; in recipe: yes (slakh, slakhmore)]; IRMAS <https://zenodo.org/records/1290750> [CC BY-NC-SA 3.0 (weights become NC); in recipe: partly (cel/cla skipped in instrument notes)]; RWC Music DB <https://staff.aist.go.jp/m.goto/RWC-MDB/> [research licence (AIST); in recipe: staged datasets-v1/rwc, unused]

## Passing 50/50 but short of 60/60

### breath  (pass 50/50 (short of 60/60))
- Worst counted set: **gap:docs/evaluations/round16-clean-2026-10-10/report.json**: P 0.817 / R 0.513, 113 test positives; train clips (gap.json floor): 309. Decided by: clap-head (clap-head).
- To 50/50: +0 true positives, -0 false alarms. To 60/60 (on gap:docs/evaluations/round16-clean-2026-10-10/report.json): +10 TP, -0 FP.
- Judge #276: P 0.706 / R 0.571 on 21 positives (TP 12, FP 5, FN 9).
- Tagger recall-push-r1 on FSD50K eval: 0.91/0.30(131) (nearmiss-recall run: 0.79/0.37).
- Missing: more clips (recall).
- Unused data already staged (private HF, train-only, unreviewed): 8413 clips: datasets-v1/nvs 3511; round13/vocal-v1/vocalsound 1816; round13/vocal-v1/audioset-a 1500; round13/vocal-v1/audioset-b 1500; datasets-v1/bsd-s1 49.
- New Freesound CC0/CC BY candidates after all exclusions: CED-scored 2 (3 uploaders); tag/title text match 162 (93 uploaders).

### acoustic guitar  (pass 50/50 (short of 60/60))
- Worst counted set: **gap:nsynth-test**: P 0.526 / R 0.623, 273 test positives; train clips (gap.json floor): 464. Decided by: clap-head (clap-head).
- To 50/50: +0 true positives, -0 false alarms. To 60/60 (on gap:nsynth-test): +0 TP, -40 FP.
- Judge #276: P 1.0 / R 0.75 on 20 positives (TP 15, FP 0, FN 5); old head trained on FSD50K eval: may be inflated.
- Tagger recall-push-r1 on FSD50K eval: 0.74/0.67(52) (nearmiss-recall run: 0.77/0.65).
- Tagger recall-push-r1 on NSynth test: 0.59/0.10(481) (nearmiss-recall: 0.61/0.14).
- Missing: cleaner labels / tag definition + hard negatives (precision).
- Unused data already staged (private HF, train-only, unreviewed): 913 clips: datasets-v1/rwc 715; datasets-v1/bsd-s1 50; coverage/v2/mined/part-2 44; coverage/v2/mined/part-0 38; datasets-v1/bsd-s0 34.
- New Freesound CC0/CC BY candidates after all exclusions: CED-scored 43 (0 uploaders); tag/title text match 42 (19 uploaders).
- Labelled sets: GuitarSet <https://zenodo.org/records/3371780> [CC BY 4.0; in recipe: no]; IDMT-SMT-Guitar <https://zenodo.org/records/7544110> [CC BY-NC-ND 4.0 (ND: flag before training); in recipe: no]; NSynth <https://magenta.tensorflow.org/datasets/nsynth> [CC BY 4.0; in recipe: yes (nsynth)]; Slakh2100 <https://zenodo.org/records/4599666> [CC BY 4.0; in recipe: yes (slakh, slakhmore)]; IRMAS <https://zenodo.org/records/1290750> [CC BY-NC-SA 3.0 (weights become NC); in recipe: partly (cel/cla skipped in instrument notes)]; RWC Music DB <https://staff.aist.go.jp/m.goto/RWC-MDB/> [research licence (AIST); in recipe: staged datasets-v1/rwc, unused]

### bass guitar  (pass 50/50 (short of 60/60))
- Worst counted set: **gap:eval-fsd50k/all**: P 0.641 / R 0.532, 47 test positives; train clips (gap.json floor): 268. Decided by: tagger (tagger).
- To 50/50: +0 true positives, -0 false alarms. To 60/60 (on gap:eval-fsd50k/all): +4 TP, -0 FP.
- Judge #276: P 0.647 / R 0.55 on 20 positives (TP 11, FP 6, FN 9).
- Tagger recall-push-r1 on FSD50K eval: 0.65/0.43(47) (nearmiss-recall run: 0.70/0.45).
- Tagger recall-push-r1 on NSynth test: 0.99/0.94(160) (nearmiss-recall: 0.99/0.97).
- Missing: more clips (recall).
- Unused data already staged (private HF, train-only, unreviewed): 655 clips: datasets-v1/rwc 599; coverage/v2/mined/part-2 24; coverage/v2/mined/part-0 12; coverage/v2/mined/part-1 12; datasets-v1/bsd-s0 4.
- New Freesound CC0/CC BY candidates after all exclusions: CED-scored 34 (0 uploaders); tag/title text match 13 (3 uploaders).

### strings  (pass 50/50 (short of 60/60))
- Worst counted set: **gap:free-tag-set-test**: P 1 / R 0.573, 89 test positives; train clips (gap.json floor): 1841. Decided by: clap-head (clap-head).
- To 50/50: +0 true positives, -0 false alarms. To 60/60 (on judge #276): +1 TP, -0 FP.
- Judge #276: P 0.688 / R 0.55 on 20 positives (TP 11, FP 5, FN 9); old head trained on FSD50K eval: may be inflated.
- Tagger recall-push-r1 on FSD50K eval: 0.80/0.61(51) (nearmiss-recall run: 0.86/0.59).
- Tagger recall-push-r1 on NSynth test: 0.98/0.99(306) (nearmiss-recall: 0.97/1.00).
- Missing: more clips (recall).
- Unused data already staged (private HF, train-only, unreviewed): 2493 clips: datasets-v1/rwc 1738; datasets-v1/vggsound-s0 250; datasets-v1/vggsound-s1 250; datasets-v1/bsd-s0 131; datasets-v1/bsd-s1 124.
- New Freesound CC0/CC BY candidates after all exclusions: CED-scored 0 (0 uploaders); tag/title text match 287 (114 uploaders).

### clarinet  (pass 50/50 (short of 60/60))
- Worst counted set: **gap:docs/evaluations/dj-labels-2026-10-04/added-heads-round16.json**: P 0.842 / R 0.516, 31 test positives; train clips (gap.json floor): 146. Decided by: clap-head-maybe (clap-head-maybe).
- To 50/50: +0 true positives, -0 false alarms. To 60/60 (on gap:docs/evaluations/dj-labels-2026-10-04/added-heads-round16.json): +3 TP, -0 FP.
- Missing: more clips (recall).
- Unused data already staged (private HF, train-only, unreviewed): 161 clips: hidden-instruments/freesound 75; hidden-instruments/urmp 71; coverage/v2/mined/part-2 15.
- New Freesound CC0/CC BY candidates after all exclusions: CED-scored 16 (0 uploaders); tag/title text match 19 (5 uploaders).

### choir  (pass 50/50 (short of 60/60))
- Worst counted set: **gap:docs/evaluations/dj-labels-2026-10-04/added-heads-round14-bar45.json**: P 0.75 / R 0.514, 35 test positives; train clips (gap.json floor): 55. Decided by: clap-head (clap-head).
- To 50/50: +0 true positives, -0 false alarms. To 60/60 (on gap:docs/evaluations/dj-labels-2026-10-04/added-heads-round14-bar45.json): +3 TP, -0 FP.
- Missing: more clips (recall).
- Unused data already staged (private HF, train-only, unreviewed): 2135 clips: round13/looperman-v1 997; round13/vocal-v1/audioset-a 579; round13/vocal-v1/audioset-b 485; datasets-v1/bsd-s1 39; datasets-v1/bsd-s0 35.
- New Freesound CC0/CC BY candidates after all exclusions: CED-scored 0 (0 uploaders); tag/title text match 13 (6 uploaders).

### acid synth  (pass 50/50 (short of 60/60))
- Worst counted set: **gap:heard**: P 0.71 / R 0.5, 10 test positives; train clips (gap.json floor): n/a. Decided by: tagger (tagger).
- To 50/50: +0 true positives, -0 false alarms. To 60/60 (on gap:heard): +1 TP, -0 FP.
- Missing: more clips (recall).
- Unused data already staged (private HF, train-only, unreviewed): 48 clips: datasets-v1/bsd-s0 25; datasets-v1/bsd-s1 23.
- New Freesound CC0/CC BY candidates after all exclusions: CED-scored 0 (0 uploaders); tag/title text match 3 (2 uploaders).

### chiptune synth  (pass 50/50 (short of 60/60))
- Worst counted set: **gap:docs/evaluations/dj-labels-2026-10-04/added-heads-round19.json**: P 0.857 / R 0.524, 355 test positives; train clips (gap.json floor): 1086. Decided by: clap-head (clap-head).
- To 50/50: +0 true positives, -0 false alarms. To 60/60 (on gap:docs/evaluations/dj-labels-2026-10-04/added-heads-round19.json): +27 TP, -0 FP.
- Missing: more clips (recall).
- Unused data already staged (private HF, train-only, unreviewed): 92 clips: datasets-v1/bsd-s0 45; datasets-v1/bsd-s1 42; round13/looperman-v1 5.
- New Freesound CC0/CC BY candidates after all exclusions: CED-scored 0 (0 uploaders); tag/title text match 193 (56 uploaders).

### crash cymbal  (pass 50/50 (short of 60/60))
- Worst counted set: **gap:eval-fsd50k/all**: P 0.647 / R 0.55, 20 test positives; train clips (gap.json floor): 178. Decided by: tagger (tagger).
- To 50/50: +0 true positives, -0 false alarms. To 60/60 (on gap:eval-fsd50k/all): +1 TP, -0 FP.
- Judge #276: P 0.786 / R 0.579 on 19 positives (TP 11, FP 3, FN 8); old head trained on FSD50K eval: may be inflated.
- Tagger recall-push-r1 on FSD50K eval: 0.75/0.45(20) (nearmiss-recall run: 0.80/0.60).
- Missing: more clips (recall).
- Unused data already staged (private HF, train-only, unreviewed): 657 clips: datasets-v1/bsd-s0 220; datasets-v1/bsd-s1 201; round13/egmd-v2 134; datasets-v1/rwc 102.
- New Freesound CC0/CC BY candidates after all exclusions: CED-scored 0 (0 uploaders); tag/title text match 288 (90 uploaders).

### bongo  (pass 50/50 (short of 60/60))
- Worst counted set: **gap:docs/evaluations/tag-heads-2026-10-09/shipped.json**: P 0.541 / R 0.625, 32 test positives; train clips (gap.json floor): 101. Decided by: clap-head (clap-head).
- To 50/50: +0 true positives, -0 false alarms. To 60/60 (on gap:docs/evaluations/tag-heads-2026-10-09/shipped.json): +0 TP, -4 FP.
- Missing: cleaner labels / tag definition + hard negatives (precision).
- Unused data already staged (private HF, train-only, unreviewed): 553 clips: datasets-v1/vggsound-s0 250; datasets-v1/vggsound-s1 250; datasets-v1/rwc 18; datasets-v1/bsd-s1 16; mine-blocked/v1/part-0 10.
- New Freesound CC0/CC BY candidates after all exclusions: CED-scored 0 (0 uploaders); tag/title text match 33 (6 uploaders).

### clave  (pass 50/50 (short of 60/60))
- Worst counted set: **gap:docs/evaluations/open-vocab-2026-10-05/added-heads-zero-shot-2.json**: P 0.9 / R 0.5, 18 test positives; train clips (gap.json floor): n/a. Decided by: clap-head-maybe (clap-head-maybe).
- To 50/50: +0 true positives, -0 false alarms. To 60/60 (on gap:docs/evaluations/open-vocab-2026-10-05/added-heads-zero-shot-2.json): +2 TP, -0 FP.
- Missing: more clips (recall).
- Unused data already staged (private HF, train-only, unreviewed): 12 clips: datasets-v1/bsd-s1 7; datasets-v1/bsd-s0 5.
- New Freesound CC0/CC BY candidates after all exclusions: CED-scored 0 (0 uploaders); tag/title text match 20 (4 uploaders).

### drum fill  (pass 50/50 (short of 60/60))
- Worst counted set: **gap:docs/evaluations/dj-labels-2026-10-04/added-heads-round14-bar45.json**: P 0.558 / R 0.643, 98 test positives; train clips (gap.json floor): 291. Decided by: clap-head (clap-head).
- To 50/50: +0 true positives, -0 false alarms. To 60/60 (on gap:docs/evaluations/dj-labels-2026-10-04/added-heads-round14-bar45.json): +0 TP, -8 FP.
- Missing: cleaner labels / tag definition + hard negatives (precision).
- Unused data already staged (private HF, train-only, unreviewed): 1005 clips: round13/egmd-v2 800; datasets-v1/bsd-s1 97; datasets-v1/bsd-s0 94; round13/looperman-v1 14.
- New Freesound CC0/CC BY candidates after all exclusions: CED-scored 0 (0 uploaders); tag/title text match 34 (5 uploaders).

### whoosh  (pass 50/50 (short of 60/60))
- Worst counted set: **gap:fsd50k-eval**: P 0.841 / R 0.58, 100 test positives; train clips (gap.json floor): 227. Decided by: clap-head (clap-head).
- To 50/50: +0 true positives, -0 false alarms. To 60/60 (on gap:fsd50k-eval): +2 TP, -0 FP.
- Judge #276: P 0.923 / R 0.6 on 20 positives (TP 12, FP 1, FN 8); old head trained on FSD50K eval: may be inflated.
- Tagger recall-push-r1 on FSD50K eval: 0.56/0.33(27) (nearmiss-recall run: 0.63/0.44).
- Missing: more clips (recall).
- Unused data already staged (private HF, train-only, unreviewed): 302 clips: datasets-v1/bsd-s1 132; datasets-v1/bsd-s0 131; coverage/v2/mined/part-2 19; coverage/v2/mined/part-0 12; coverage/v2/mined/part-1 8.
- New Freesound CC0/CC BY candidates after all exclusions: CED-scored 31 (0 uploaders); tag/title text match 289 (130 uploaders).
- Labelled sets: Freesound (CED-scored, CC0/BY) <https://freesound.org/> [CC0 / CC BY per sound; in recipe: yes (freesound, fsnew, run9) - new ids in freesound-candidates.csv]; Looperman <https://www.looperman.com/> [free royalty-free loops (Looperman terms); in recipe: staged round13/looperman-v1, unused]; FSD50K dev <https://zenodo.org/records/4060432> [CC0 / CC BY / CC BY-NC per clip (Freesound); in recipe: yes (fsd50k)]

### staccato  (pass 50/50 (short of 60/60))
- Worst counted set: **gap:docs/evaluations/open-vocab-2026-10-05/added-heads-dsp2.json**: P 0.517 / R 0.536, 308 test positives; train clips (gap.json floor): 924. Decided by: clap-head-maybe (clap-head-maybe).
- To 50/50: +0 true positives, -0 false alarms. To 60/60 (on gap:docs/evaluations/open-vocab-2026-10-05/added-heads-dsp2.json): +20 TP, -31 FP.
- Missing: more clips (recall); cleaner labels / tag definition + hard negatives (precision).
- Unused data already staged (private HF, train-only, unreviewed): 2745 clips: datasets-v1/rwc 2682; datasets-v1/bsd-s1 34; datasets-v1/bsd-s0 29.
- New Freesound CC0/CC BY candidates after all exclusions: CED-scored 0 (0 uploaders); tag/title text match 1 (1 uploaders).

### mandolin  (pass 50/50 (short of 60/60))
- Worst counted set: **gap:docs/evaluations/open-vocab-2026-10-05/added-heads-zero-shot.json**: P 0.889 / R 0.552, 29 test positives; train clips (gap.json floor): n/a. Decided by: clap-head-maybe (clap-head-maybe).
- To 50/50: +0 true positives, -0 false alarms. To 60/60 (on gap:docs/evaluations/open-vocab-2026-10-05/added-heads-zero-shot.json): +2 TP, -0 FP.
- Missing: more clips (recall).
- Unused data already staged (private HF, train-only, unreviewed): 767 clips: datasets-v1/rwc 263; datasets-v1/vggsound-s0 250; datasets-v1/vggsound-s1 250; coverage/v2/mined/part-0 3; datasets-v1/bsd-s1 1.
- New Freesound CC0/CC BY candidates after all exclusions: CED-scored 1 (0 uploaders); tag/title text match 0 (0 uploaders).

### glockenspiel  (pass 50/50 (short of 60/60))
- Worst counted set: **gap:eval-fsd50k/all**: P 0.82 / R 0.683, 60 test positives; train clips (gap.json floor): 47. Decided by: tagger (tagger).
- To 50/50: +0 true positives, -0 false alarms. To 60/60 (on judge #276): +2 TP, -0 FP.
- Judge #276: P 0.909 / R 0.5 on 20 positives (TP 10, FP 1, FN 10).
- Tagger recall-push-r1 on FSD50K eval: 0.78/0.67(60) (nearmiss-recall run: 0.83/0.58).
- Unused data already staged (private HF, train-only, unreviewed): 607 clips: datasets-v1/vggsound-s0 250; datasets-v1/vggsound-s1 250; datasets-v1/rwc 50; coverage/v2/mined/part-1 15; datasets-v1/bsd-s1 13.
- New Freesound CC0/CC BY candidates after all exclusions: CED-scored 5 (0 uploaders); tag/title text match 11 (5 uploaders).

### kick  (pass 50/50 (short of 60/60))
- Worst counted set: **gap:fsd50k-eval (positives not listed)**: P 0.84 / R 0.73, n/a test positives; train clips (gap.json floor): 181. Decided by: tagger (tagger).
- To 50/50: +? true positives, -? false alarms. To 60/60 (on judge #276): +0 TP, -1 FP.
- Judge #276: P 0.583 / R 0.667 on 21 positives (TP 14, FP 10, FN 7); old head trained on FSD50K eval: may be inflated.
- Tagger recall-push-r1 on FSD50K eval: 0.89/0.14(58) (nearmiss-recall run: 0.91/0.34).
- Unused data already staged (private HF, train-only, unreviewed): 3289 clips: round13/egmd-v2 2606; datasets-v1/bsd-s0 215; datasets-v1/bsd-s1 205; coverage/v2/mined/part-0 78; round13/looperman-v1 66.
- New Freesound CC0/CC BY candidates after all exclusions: CED-scored 85 (38 uploaders); tag/title text match 746 (191 uploaders).
- Labelled sets: E-GMD <https://magenta.tensorflow.org/datasets/e-gmd> [CC BY 4.0; in recipe: staged round13/egmd-v2, unused]; MDB Drums <https://github.com/CarlSouthall/MDBDrums> [CC BY-NC-SA 4.0; in recipe: no]; IDMT-SMT-Drums <https://zenodo.org/records/7544164> [CC BY-NC-ND 4.0 (ND: flag before training); in recipe: no]; Looperman <https://www.looperman.com/> [free royalty-free loops (Looperman terms); in recipe: staged round13/looperman-v1, unused]; FSD50K dev <https://zenodo.org/records/4060432> [CC0 / CC BY / CC BY-NC per clip (Freesound); in recipe: yes (fsd50k)]
- Note: E-GMD staged egmd-v2 2,606 kick; nearmiss-recall .80/.14 -> .91/.34 on FSD50K eval.

## Too few held-out positives to count (under 10)

### double bass  (too few test positives (<10) to count; gap.json marks it short)
- Worst counted set: **gap:eval-round1/all**: P 0.667 / R 0.444, 9 test positives; train clips (gap.json floor): n/a. Decided by: tagger (tagger).
- To 50/50: +1 true positives, -0 false alarms. To 60/60 (on gap:eval-round1/all): +2 TP, -0 FP.
- Missing: more clips (recall).
- Unused data already staged (private HF, train-only, unreviewed): 1299 clips: datasets-v1/rwc 643; datasets-v1/vggsound-s0 250; datasets-v1/vggsound-s1 250; hidden-instruments/freesound 59; datasets-v1/bsd-s0 26.
- New Freesound CC0/CC BY candidates after all exclusions: CED-scored 16 (2 uploaders); tag/title text match 18 (2 uploaders).
- Labelled sets: TinySOL <https://zenodo.org/records/3685367> [CC BY 4.0; in recipe: yes (tinysol)]; Univ. of Iowa MIS <https://theremin.music.uiowa.edu/MIS.html> [free to use, no restrictions (UIowa notice); in recipe: yes (iowa)]; Philharmonia samples <https://philharmonia.co.uk/resources/sound-samples/> [free; no resale of the samples themselves; in recipe: no]; URMP <https://labsites.rochester.edu/air/projects/URMP.html> [research use; in recipe: staged hidden-instruments/urmp, unused]; Good-Sounds <https://zenodo.org/records/4588740> [CC BY-NC 4.0; in recipe: no]; IRMAS <https://zenodo.org/records/1290750> [CC BY-NC-SA 3.0 (weights become NC); in recipe: partly (cel/cla skipped in instrument notes)]; OpenMIC-2018 <https://zenodo.org/records/1432913> [CC BY 4.0 (10 s clips from FMA); in recipe: no]; MedleyDB <https://medleydb.weebly.com/> [CC BY-NC-SA 4.0; in recipe: no]; RWC Music DB <https://staff.aist.go.jp/m.goto/RWC-MDB/> [research licence (AIST); in recipe: staged datasets-v1/rwc, unused]

### laser  (too few test positives (<10) to count; gap.json marks it short)
- Worst counted set: **gap:heard**: P 0.8 / R 0.44, 9 test positives; train clips (gap.json floor): n/a. Decided by: tagger (tagger).
- To 50/50: +1 true positives, -0 false alarms. To 60/60 (on gap:heard): +2 TP, -0 FP.
- Missing: more clips (recall).
- Unused data already staged (private HF, train-only, unreviewed): 204 clips: datasets-v1/bsd-s0 78; datasets-v1/bsd-s1 74; coverage/v2/mined/part-0 16; coverage/v2/mined/part-2 16; round13/looperman-v1 13.
- New Freesound CC0/CC BY candidates after all exclusions: CED-scored 0 (0 uploaders); tag/title text match 122 (34 uploaders).
- Labelled sets: Freesound (CED-scored, CC0/BY) <https://freesound.org/> [CC0 / CC BY per sound; in recipe: yes (freesound, fsnew, run9) - new ids in freesound-candidates.csv]; Looperman <https://www.looperman.com/> [free royalty-free loops (Looperman terms); in recipe: staged round13/looperman-v1, unused]; FSD50K dev <https://zenodo.org/records/4060432> [CC0 / CC BY / CC BY-NC per clip (Freesound); in recipe: yes (fsd50k)]
- Note: Only 9 held-out positives ("heard").

### conga  (too few test positives (<10) to count; gap.json marks it short)
- Worst counted set: **gap:heard**: P 1 / R 0.4, 5 test positives; train clips (gap.json floor): n/a. Decided by: tagger (tagger).
- To 50/50: +1 true positives, -0 false alarms. To 60/60 (on gap:heard): +1 TP, -0 FP.
- Missing: more clips (recall).
- Unused data already staged (private HF, train-only, unreviewed): 448 clips: datasets-v1/vggsound-s1 210; datasets-v1/vggsound-s0 205; datasets-v1/rwc 16; datasets-v1/bsd-s1 8; datasets-v1/bsd-s0 6.
- New Freesound CC0/CC BY candidates after all exclusions: CED-scored 0 (0 uploaders); tag/title text match 17 (2 uploaders).
- Labelled sets: VGGSound <https://www.robots.ox.ac.uk/~vgg/data/vggsound/> [labels CC BY 4.0; audio is YouTube (training-only); in recipe: staged datasets-v1 vggsound-s0/s1, unused]; RWC Music DB <https://staff.aist.go.jp/m.goto/RWC-MDB/> [research licence (AIST); in recipe: staged datasets-v1/rwc, unused]; Univ. of Iowa MIS <https://theremin.music.uiowa.edu/MIS.html> [free to use, no restrictions (UIowa notice); in recipe: yes (iowa)]; OpenMIC-2018 <https://zenodo.org/records/1432913> [CC BY 4.0 (10 s clips from FMA); in recipe: no]; FSD50K dev <https://zenodo.org/records/4060432> [CC0 / CC BY / CC BY-NC per clip (Freesound); in recipe: yes (fsd50k)]
- Note: Only 5 held-out positives ("heard"): too few to count; needs a test set as much as data.

### static noise  (too few test positives (<10) to count; gap.json marks it short)
- Worst counted set: **gap:heard**: P 1 / R 0.36, 5 test positives; train clips (gap.json floor): n/a. Decided by: tagger (tagger).
- To 50/50: +1 true positives, -0 false alarms. To 60/60 (on gap:heard): +1 TP, -0 FP.
- Missing: more clips (recall).
- Unused data already staged (private HF, train-only, unreviewed): 777 clips: datasets-v1/bsd-s0 343; datasets-v1/bsd-s1 323; round13/vocal-v1/audioset-b 32; round13/vocal-v1/audioset-a 29; coverage/v2/mined/part-0 22.
- New Freesound CC0/CC BY candidates after all exclusions: CED-scored 68 (34 uploaders); tag/title text match 288 (137 uploaders).
- Labelled sets: Freesound (CED-scored, CC0/BY) <https://freesound.org/> [CC0 / CC BY per sound; in recipe: yes (freesound, fsnew, run9) - new ids in freesound-candidates.csv]; Looperman <https://www.looperman.com/> [free royalty-free loops (Looperman terms); in recipe: staged round13/looperman-v1, unused]; FSD50K dev <https://zenodo.org/records/4060432> [CC0 / CC BY / CC BY-NC per clip (Freesound); in recipe: yes (fsd50k)]
- Note: Only 5 held-out positives ("heard").

### vocal phrase  (too few test positives (<10) to count)
- Worst counted set: **gap:heard**: P 1 / R 0.6, 5 test positives; train clips (gap.json floor): n/a. Decided by: tagger (tagger).
- To 50/50: +0 true positives, -0 false alarms. To 60/60 (on gap:heard): +0 TP, -0 FP.
- Unused data already staged (private HF, train-only, unreviewed): 1 clips: datasets-v1/bsd-s1 1.
- New Freesound CC0/CC BY candidates after all exclusions: CED-scored 0 (0 uploaders); tag/title text match 0 (0 uploaders).

### vocal chant  (too few test positives (<10) to count)
- Worst counted set: **gap:heard**: P 0.71 / R 1, 5 test positives; train clips (gap.json floor): n/a. Decided by: tagger (tagger).
- To 50/50: +0 true positives, -0 false alarms. To 60/60 (on gap:heard): +0 TP, -0 FP.
- Unused data already staged (private HF, train-only, unreviewed): 308 clips: round13/vocal-v1/audioset-a 135; round13/vocal-v1/audioset-b 107; datasets-v1/bsd-s0 29; datasets-v1/bsd-s1 27; round13/looperman-v1 10.
- New Freesound CC0/CC BY candidates after all exclusions: CED-scored 0 (0 uploaders); tag/title text match 8 (5 uploaders).

### riser  (too few test positives (<10) to count)
- Worst counted set: **gap:heard**: P 0.75 / R 0.5, 6 test positives; train clips (gap.json floor): n/a. Decided by: tagger (tagger).
- To 50/50: +0 true positives, -0 false alarms. To 60/60 (on gap:heard): +1 TP, -0 FP.
- Missing: more clips (recall).
- Unused data already staged (private HF, train-only, unreviewed): 166 clips: round13/looperman-v1 77; datasets-v1/bsd-s0 47; datasets-v1/bsd-s1 42.
- New Freesound CC0/CC BY candidates after all exclusions: CED-scored 0 (0 uploaders); tag/title text match 38 (10 uploaders).

### whistle  (too few test positives (<10) to count)
- Worst counted set: **gap:heard**: P 1 / R 0.6, 5 test positives; train clips (gap.json floor): n/a. Decided by: tagger (tagger).
- To 50/50: +0 true positives, -0 false alarms. To 60/60 (on gap:heard): +0 TP, -0 FP.
- Unused data already staged (private HF, train-only, unreviewed): 1688 clips: round13/vocal-v1/audioset-b 488; round13/vocal-v1/audioset-a 446; datasets-v1/vggsound-s0 250; datasets-v1/vggsound-s1 250; datasets-v1/bsd-s0 76.
- New Freesound CC0/CC BY candidates after all exclusions: CED-scored 57 (0 uploaders); tag/title text match 40 (10 uploaders).

## Unmeasured: no held-out real numbers yet

These need a held-out real test set (uploader-split, never trained on) before data can be judged. Staged and Freesound counts are in the CSV.

sound effect (5210 staged, 1105 new Freesound text matches), vocal hum (683 staged, 11 new Freesound text matches), vocoder vocal (236 staged, 9 new Freesound text matches), synth pluck (501 staged, 25 new Freesound text matches), synth lead (254 staged, 58 new Freesound text matches), synth bass (1296 staged, 1 new Freesound text matches), vocal-like synth (0 staged, 0 new Freesound text matches), synth chord (1632 staged, 187 new Freesound text matches), supersaw (3 staged, 2 new Freesound text matches), brass synth (0 staged, 0 new Freesound text matches), string synth (12 staged, 0 new Freesound text matches), sub bass (458 staged, 25 new Freesound text matches), reese bass (66 staged, 0 new Freesound text matches), wobble bass (1450 staged, 31 new Freesound text matches), rimshot (1117 staged, 25 new Freesound text matches), percussion hit (4495 staged, 157 new Freesound text matches), sub drop (3 staged, 0 new Freesound text matches), record stop (0 staged, 0 new Freesound text matches), vinyl crackle (436 staged, 219 new Freesound text matches), plucked (361 staged, 189 new Freesound text matches), syncopated (5 staged, 0 new Freesound text matches), rolling (42 staged, 31 new Freesound text matches), dry (91 staged, 60 new Freesound text matches), falling (972 staged, 127 new Freesound text matches), gliding (229 staged, 211 new Freesound text matches), bitcrushed (3 staged, 0 new Freesound text matches), filtered (13 staged, 12 new Freesound text matches), chorused (34 staged, 39 new Freesound text matches), flanged (4 staged, 1 new Freesound text matches), banjo (639 staged, 0 new Freesound text matches), sitar (534 staged, 0 new Freesound text matches), steel drum (435 staged, 0 new Freesound text matches), waterphone (1 staged, 0 new Freesound text matches), vocal shush (153 staged, 0 new Freesound text matches), synth hit (3 staged, 1 new Freesound text matches)

## Blocked, DSP-exempt, shipping

- Blocked (no allowed audio, reported as blocked, not failed): dark, bright, rhythmic, steel guitar - Blocked (no allowed held-out audio). VGGSound staged has 500 candidates (train-only); would also need a held-out test.
- DSP/timbre exempt: airy, metallic, warm, gritty, smooth, hollow, nasal, woody, glassy
- gap.json tier "full" with no per-set numbers: violin / fiddle, flute, pitched vocal, fm synth, marimba, vibraphone
- Pass 60/60: percussion, environmental sound, vocal scream, vocal laugh, synth arpeggio, bass growl, 808 bass, open hi-hat, tom, shaker, snare roll, impact, reverse cymbal, siren, air horn, rain ambience, distorted, harp, harmonica, cymbal, finger snap
- Pass 70/70: synthesizer, trumpet, saxophone, vocal ad-lib, beatbox, ride cymbal, cowbell, drum loop, percussion loop, top loop, vinyl scratch, reverse effect, ambient drone, sustained, percussive, swelling, pulsing, wobbling, oboe, accordion, ukulele, kalimba, tabla, jaw harp, singing bowl, gong

## Method, exclusions and licences

**Candidate pools**
- **Staged but unused:** per-tag `tags_train` counts from the private `cmjatom/dge-private-train` summaries for sets that are not in the recall-push-r1 recipe (`data-manifest.json`). Those sets are:
  - datasets-v1: bsd, vggsound, rwc, nvs, cnvve, dsp, real-arp;
  - mine-blocked;
  - round13: audioset-a/b, avp, vocalsound, looperman, egmd-v2;
  - coverage/v2 mined;
  - hidden-instruments.
  - All of them are train-only and unreviewed. real-arp-v1 licences: CC0 110, BY 89, NC 38, Sampling+ 13.
- **CED-scored Freesound:** run `ced-freesound-38026076860-1`, 494,513 Freesound sounds scored over 527 AudioSet classes.
  - A clip counts if its CED score is at least 0.5 on the tag's AudioSet classes and its licence is CC0, CC BY 4.0 or CC BY 3.0 (NC is counted separately).
  - At most 15 clips per uploader.
- **Text match:** catalog aliases plus the labeller's extra terms, matched against the Freesound metadata dump (Chr0my/freesound.org). Licence comes from the CED index; sounds not in that index are left out.

**Excluded everywhere**
- FSD50K eval ids and uploaders, and the 430 judge-set uploaders.
- FSD50K dev-val uploaders (as #276 `select_weak.py` does).
- The reserved test families (short-clips and synth-clips: ids and uploaders).
- The synth-clip, dj-effects and freesound-test uploader hash rules.
- Cached Freesound test sounds and uploaders.
- Anything already staged (82,540 ids).

**Never used:** the judge set, any held-out set, and the don't-use packs:
- free-tag-set test half, splice-shortlist test half, chris-drive judge half;
- free-dj-tracks, the 417 stem songs, the licensed-pilot holdout;
- GTZAN, DJ clip rounds, and commercial-split/packs.csv packs.

**Licences**
- Training may use any licence under Chris's rules. NC data (IRMAS, Good-Sounds, ESC-50, xeno-canto, MedleyDB, MDB Drums) makes the weights CC BY-NC-SA.
- ND sets (IDMT-SMT) are flagged: confirm before training on them.
- YouTube-derived audio (AudioSet, VGGSound) is training-only and never published.
- Raw commercial audio never goes public.

**Files**
- this file and `per-tag.csv`: one row per tag, with every column;
- `freesound-candidates.csv`: the new open Freesound ids per tag, with links;
- `dge-data-gaps-2026-10-31-extra-drop-ids.json`: the leaked training ids.

# Round 3 held-out audio set (frozen 2026-10-06)

Rounds 1 and 2 (`dj-clips-2026-10-06`, `dj-clips-round2-2026-10-06`) have been read, so they can't judge new fixes
honestly. This set is for judging only. **Don't tune, calibrate, pick thresholds on, or look at per-track results of
anything listed here.** If a fix needs data, use the "free for tuning" pools below.

| Set | Tracks | Audio | Truth | Scores |
|---|---|---|---|---|
| `jamendo-manifest.json` | 500 MTG-Jamendo split-0 **test** tracks, 232 artists (at most 3 each); 424 in DJ genres (house, techno, trance, dance, drum & bass, dubstep, hip-hop, chill-out, downtempo...), 76 general electronic | Middle 30 s of the dataset's low-quality MP3 | Uploader instrument tags (present); voice/instrumental where three annotators agreed (present and absent); untagged = weak absent | Sound tags: 11 OpenMIC classes plus cello |
| `mtg-key-manifest.json` | 318 GiantSteps MTG key Beatport tracks not used by round 2, held out by the hash rule, with a Beatport BPM (244 have a confident single key; the other 180 held-out tracks have no BPM and are left out) | Middle 10 s of the Beatport preview | Beatport BPM, manual key with confidence | Tempo, key |

Labelled positives in the Jamendo set: synthesizer 209, drums 141, piano 140, bass 113, guitar 110, voice 76 (plus 302
agreed instrumental), violin 29, saxophone 15, cello 12, trumpet 10, organ 5. Organ and trumpet are too thin to pass or
fail on.

**What's held out**
- Every MTG-Jamendo split-0 test track (`data/splits/split-0/*-test.tsv` in MTG/mtg-jamendo-dataset), not just these 500.
  Free for tuning: split-0 train and validation.
- GiantSteps MTG key tracks not in `round2-mtg-key-tracks.txt` whose
  `int(sha256("dge-holdout-r3-2026-10-06|" + name)[:8], 16)` is even (`name` like `100066.LOFI`). Free for tuning: the
  odd ones (488 tracks).

**How to read the numbers.** The strict view (`jamendo-tags-strict*`) only uses labels that are real: recall for every
class, plus voice precision. Uploader tags are incomplete, so precision in the weak view (`jamendo-tags-weak`) is a
lower bound (bass and voice are under-tagged most). Compare branches against main's run on the same view, not against
the 0.60 bar alone. DGE's Jamendo instrument head was trained on MTG-Jamendo; split-0 test is the partition its
published metrics are measured on (assumed to be outside its training data; the run logs the model's dataset metadata).
Tags describe whole tracks, so an instrument may be missing from the 30 s excerpt; recall is a lower bound too.

**Running it.** `.github/workflows/holdout-r3-eval.yml` tests an app build against both sets:
- Actions → "Held-out audio check, round 3" → Run workflow from your own branch (not main), with `app_ref` = the
  branch or commit to test;
- or push a branch that contains your change as `holdout-r3/<name>`.
Only aggregate reports are committed, under `results/<app ref>-<commit>/`, on the branch the run was triggered from
(never on main, so a run started from main keeps its reports only as artifacts). The run always drives the app with
its own copy of `scripts/short-clip-upload-eval.mjs`, which handles the UI before and after #137. Audio is fetched at run time and never committed.

Chris's own labelled tracks can be added as a further set later; they'd be the closest match to real DJ use.

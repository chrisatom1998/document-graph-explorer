# DJ clip accuracy, round 2: 500 + 500 new ten-second clips (2026-10-06)

**Tested:** main at ddc0908. Its tag, tempo and key code is the same as the 5673326 that round 1 tested; #115 changed
only link building. The app was built and run in headless Chromium on GitHub Actions (run 37406166208), and every clip
was uploaded through the real Add-files flow in full analysis mode. Round 1 is
`docs/evaluations/dj-clips-2026-10-06/RESULTS.md`. Pass bar: precision and recall both at least 0.60.

## What is new

| Set | Clips | Truth | Overlap with round 1 |
|---|---|---|---|
| OpenMIC-2018 test split | 500 × 10 s, 370 artists; **161 in DJ genres** (round 1 had 60), 134 general Electronic, 205 other | Crowd instrument labels | No clip and no artist from round 1 or from the 900-clip calibration set |
| GiantSteps **MTG key** dataset | 500 × middle 10 s of Beatport EDM previews, 16 genres incl. hip-hop | Beatport BPM, manual key, Beatport genre | No track shared with round 1's GiantSteps tempo set, or with the tempo-tuning clips on #116 |

Two caveats:
- **The OpenMIC share-alike reserve is now used.** Round 1 left only 2 clean non-share-alike test clips, so all 500 here
  are share-alike clips. The clean OpenMIC test pool is now used up, so a round 3 needs a different labelled source.
- **Tempo truth is weaker than in round 1.** It is Beatport's listed BPM, not crowd-corrected. Beatport lists 25 of 41
  drum & bass tracks at half tempo (about 87), and 3 tracks list 0 BPM (left out, so n = 497). The committed
  `mtg-key.txt` files were scored before the scorer skipped those 3, so their tempo rates use 500 as the denominator
  (0.856 / 0.906 on main); the numbers below exclude them. Round 1's GiantSteps tempo
  tracks were picked from tracks whose Beatport BPM users had disputed. They are probably harder than a typical
  Beatport track (inferred from how that dataset was built, not measured).

## Sound tags (OpenMIC, 500 clips)

| Label | Round 2 pos / neg | Round 2 P / R | Round 2 | Round 1 P / R | Round 1 |
|---|---|---|---|---|---|
| drums | 52 / 9 | 0.91 / 0.94 | pass | 0.86 / 0.97 | pass |
| synthesizer | 39 / 8 | 0.89 / 1.00 | pass | 0.94 / 0.94 | pass |
| cymbals | 34 / 9 | 0.91 / 0.94 | pass | 0.94 / 0.98 | pass |
| voice | 31 / 17 | 0.88 / 0.90 | pass | 0.89 / 0.96 | pass |
| piano | 15 / 17 | 1.00 / 0.87 | pass | 1.00 / 0.87 | pass |
| trumpet | 18 / 63 | **0.50** / 0.89 | fail | 0.65 / 0.77 | pass |
| organ | 16 / 37 | **0.48** / 0.88 | fail | 0.62 / 0.95 | pass (barely) |
| bass | 15 / 35 | **0.43** / 0.67 | fail | 0.21 / 0.67 | fail |
| saxophone | 25 / 27 | 0.88 / **0.28** | fail | 1.00 / 0.29 | fail |
| violin | 15 / 25 | 0.50 / **0.13** | fail | 0.60 / 0.25 | fail |
| guitar | 20 / 11 | 1.00 / **0.10** | fail | 1.00 / 0.30 | fail |

**5 of 11 pass (round 1: 7 of 11).** The four DJ-critical labels (drums, synth, cymbals, voice) pass again with room
to spare, and piano repeats exactly. Trumpet and organ drop below the bar on precision: 16 and 15 false alarms out of 63
and 37 clips without them. Round 1's organ pass was already marginal. Guitar is worse (2 of 20 found). 13 of the 18
missed guitars had a hidden MTG-Jamendo guitar tag, which is the same pattern as round 1 and the Jamendo guitar ≥ 0.40
follow-up offered on #113. Sax and violin recall repeat round 1: most misses have no signal from any model.

**DJ-genre clips only (161):** drums P 0.85 / R 0.88, synth 1.00 / 1.00 on 26, cymbals 0.94 / 0.94, voice 1.00 / 1.00
on 5, and organ passes (0.63 / 1.00). Bass fails (0.38 / 0.50), and trumpet has 6 false alarms against 2 real ones.
Other labels have fewer than 5 positives here. Every clip showed at least one tag.

## Tempo (500 Beatport tracks)

| Metric | Round 2 (Beatport BPM, n 497) | Round 1 (crowd BPM, n 500) |
|---|---|---|
| Within 4% | **86.1%** | 53.6% |
| Allowing half / double / ⅓ / 3× | 91.1% | 73.8% |
| Wrong at half or double | 25 | 101 |
| Wrong at ⅔, ¾, 4/3 or 3/2 (triplet feel) | 32 | about 98 |

| Genre | Clips | Within 4% | Allowing half / double |
|---|---|---|---|
| tech house, techno, minimal, electro house | 112 | 96–100% | 96–100% |
| deep house, hard dance, breaks, trance, progressive | 155 | 91–94% | 91–97% |
| psy-trance, house, chill-out, electronica | 104 | 83–88% | 86–88% |
| hip-hop | 37 | 78% | 92% |
| dubstep | 51 | 76% | 88% |
| drum & bass | 41 | **46%** | 68% |

Tempo looks much better than round 1, but most of the jump is probably the easier set and looser truth, not the app
(this is inferred; the app's tempo code is unchanged). The patterns are the same as round 1. Four-on-the-floor is
nearly always right, drum & bass is weakest, and the leftover errors are triplet-feel confusions (⅔, ¾, 4/3). Wrong
tempos still get high confidence (median 0.85 wrong vs 1.00 right), so they are shown and linked.

### PR #116's tempo fix on the same 500 tracks

#116's half-time and triplet fix (head 4739461) was tuned on unused GiantSteps tempo tracks and GTZAN. None of them are
in this set, so this is a clean check (run 37408031481, same clips and scorer).

| | main | #116 fix |
|---|---|---|
| Within 4% (n 497) | 86.1% | 84.7% |
| Allowing half / double | 91.1% | 91.5% |
| Drum & bass reported at 160–180 BPM | 7 of 41 | **26 of 41** |
| Drum & bass within 4% of Beatport's BPM | 19 | 11 |

The fix does what it was built for. Drum & bass now mostly comes out at its real 170s tempo. But Beatport lists 24 of
these 41 tracks at 80–90, so the strict score drops against that truth. Outside drum & bass it fixed 5 tracks
(dubstep and techno that were read at half tempo) and broke 4 (two hip-hop tracks at 78 and 90 BPM and one chill-out
track at 90 were doubled to 155–180, and one dubstep track listed at 70 was doubled to 140). On these tracks it is
roughly neutral overall: it helps drum & bass for DJs, with a small cost on slow hip-hop and chill-out. Triplet-feel errors
(⅔, ¾, 4/3, 3/2) go from 32 to 30.

## Key (new; 395 clips with a single high-confidence manual key)

| Metric | Result |
|---|---|
| Key shown | 370 of 395 (94%) |
| Exactly right | **46%** of all, 49% of shown |
| MIREX weighted score | 0.56 |
| Right tonic, wrong major/minor | 74, of which 59 are minor tracks called major |
| Off by a fifth / relative key | 33 / 32 |

The biggest single error is calling minor tracks major. 69% of the labelled tracks are minor, but the app says major
on 53% of the keys it shows. Key strength does separate right from wrong: keys with strength ≥ 0.9 are right 77% of
the time (48 clips), against 49% overall. Best genres: progressive house, deep house and electronica (exact 59–65%).
Worst: hip-hop, drum & bass and techno (29–31%).

## Tags on real DJ tracks (no tag truth)

Synthesizer showed on 417 of 500 tracks and drums on 266 (53%; round 1 51%). Drums are missing on most trance (7 of
33), hard dance (8 of 31), house (10 of 21) and psy-trance (13 of 33) tracks. They show on most techno (22 of 27),
minimal (27 of 31), deep house (27 of 32) and tech house (23 of 26) tracks. Cello showed on 24 tracks (round 1: 25),
spread over 14 genres, so it is a steady false tag. Banjo showed on 3 and mandolin on 2.

## What this says

- **Repeats on new clips:** drums, synth, cymbals, voice and piano are solid. Guitar, sax and violin recall and bass
  precision fail. Drums are missing on trance and hard dance. Cello is a false tag on about 5% of EDM tracks.
- **New:** trumpet and organ false alarms now fail the bar. Key is right about half the time, and the main error is
  minor called major.
- **Tempo:** same weak spots (drum & bass, triplet feel). The headline number is not comparable to round 1 because the
  truth and track mix differ. #116's fix moves drum & bass to its real tempo (26 of 41 vs 7), doubles a few slow
  hip-hop and chill-out tracks, and is otherwise neutral here.

## Files (branch claude/project-thread-unl6fy)
- `docs/evaluations/dj-clips-round2-2026-10-06/` holds both frozen manifests and `results/` (`openmic-tags*.txt/json`,
  `openmic-clips.json`, `mtg-key.txt/json` with per-clip tempo, key and tags; `tempo-fix-116/` for #116's fix).
- Re-run with `.github/workflows/dj-clips-eval-round2.yml`. The selection scripts are `scripts/dj-clips/openmic-round2.py`
  and `scripts/dj-clips/mtg-key.py`.

# Key detection: learned key profiles (2026-10-06)

**Problem.** Round 2 of the DJ clip test ([PR #119](https://github.com/chrisatom1998/document-graph-explorer/pull/119))
found the app's key exactly right on only 46% of 395 Beatport tracks, and the main error was minor tracks called major
(59 of 74 parallel-key errors). 69% of those tracks are minor, but the app said major on 53% of the keys it showed.

**Cause.** The app used Essentia's `KeyExtractor` with its default `bgate` profile, which leans major on EDM. Essentia's
EDM profile `edma` is worse here, not better (46% → 41% on the same 395 tracks).

**Fix.** `src/audio/key.ts` now scores the 24 keys with profiles learned from labelled audio: a 36-bin mean chroma
(Essentia HPCP, a third of a semitone per bin) is log-compressed, centred and scaled, and each key's score is its mode's
36 weights against the chroma rotated to that tonic. A softmax over the 24 keys must reach 0.25 for a key to be shown
(about the same share of tracks as before); strength maps that floor to 0.6, so 0.6 still marks the weakest key shown and
every place that reads `strength >= 0.6` keeps its meaning. The excerpt gates (single repeated pitch, too few pitch
classes, under 3 s) and the half-of-excerpts vote for long recordings are unchanged. Tempo and tags are untouched.
`KEY_ANALYSIS_REVISION` goes to 3 so existing libraries re-estimate keys.

## Data

| Set | Use | Rows | Truth |
|---|---|---|---|
| tune-mtg | tuning | 392 GiantSteps MTG key tracks × 10 s at 25/50/75% | Manual key, annotator confidence 2 |
| tune-gtzan | tuning | 415 GTZAN clips (30 s), seeded half | Lerch's GTZAN key annotations |
| mtg-500 | judging only | Round 2's 395 confident-key tracks, the same middle 10 s | as tune-mtg |
| gs-key | judging only | Original GiantSteps key set: 430 tracks, middle 10 s and whole preview | GiantSteps key annotations |
| test-gtzan | judging only | The other 422 GTZAN clips | as tune-gtzan |

The recorded run fetched audio from the JKU backup only; 174 of the 604 GiantSteps key tracks were not served there, so
gs-key has 430. The harness now also tries Beatport's preview URL and lists any track no source serves
(`unavailable.json`) instead of dropping it silently. The MTG key tracks reserved for round 3 (the fresh audio test set thread's rule) were never fetched. Features:
`.github/workflows/key-features.yml` → `features/*.json.gz` (no audio). Model choice: track-grouped 5-fold
cross-validation on the tuning sets only (`cv.txt`; 36 variants: 12 vs 36 bins, bass chroma, compression, L2).

## Before / after (offline, the app's exact key code run in Node on the same excerpts; `score.txt`)

Exact = right tonic and mode, over all labelled tracks (no key shown counts as wrong). MIREX = weighted score
(fifth 0.5, relative 0.3, parallel 0.2).

| Held-out set | n | Exact before → after | MIREX before → after | Minor called major | Shown |
|---|---|---|---|---|---|
| Round 2's 500 (confident key) | 395 | 46.1% → **54.4%** | 0.56 → 0.64 | 59 → 11 | 94% → 95% |
| GiantSteps key, 10 s | 430 | 46.7% → **56.0%** | 0.56 → 0.63 | 32 → 8 | 94% → 96% |
| GiantSteps key, whole preview | 430 | 50.2% → **60.2%** | 0.58 → 0.66 | 28 → 3 | 87% → 88% |
| GTZAN (other half) | 422 | 61.6% → **65.4%** | 0.69 → 0.72 | 32 → 13 | 95% → 95% |

The offline "before" on round 2's 500 (46.1%, MIREX 0.564) matches round 2's in-browser result exactly, so the
harness reproduces the app. On GTZAN genres exact rises 8–12 points on blues, hip-hop, jazz and metal, is flat on pop,
rock and country, and falls 6 on reggae (51 clips). On the 500 Beatport tracks it gains most on psy-trance, trance, techno,
breaks and hard dance; house, tech-house and progressive house lose a few tracks each (each genre has 19–26 tracks).
The model now leans minor: about a quarter of shown EDM keys are major (the sets are 70–85% minor), and the remaining
parallel errors are mostly major tracks called minor.

Errors that remain are mostly tonic errors (fifths and unrelated keys), which a profile alone cannot fix.

## Browser check on round 2's 500

The built app in headless Chromium (`.github/workflows/key-fix-browser.yml`, run 37415134127; `browser/mtg-key.txt`):
key exact **54.4%** (was 46.1%), MIREX 0.64 (was 0.56), shown 376 of 395, matching the offline numbers exactly. Tempo
(84.2% within 4%) and every tag count are identical to main with #116. Chris's 16 SHADOW_UK1 melodic loops: 5/16
exact before and after (the same five loops).

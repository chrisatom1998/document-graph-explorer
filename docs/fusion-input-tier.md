# Fusion input tier: format and length qualification, 4 October 2026

The installed fusion release was accepted on an exact input contract — full analysis of a
ten-second Ogg excerpt — and `supportsFusionInput` enforced that contract literally:

```ts
return mode === 'full' && duration === 10 && (mime === 'audio/ogg' || mime === 'application/ogg');
```

A second gate in `fusionPresentation` was tighter still, requiring exactly one scored window
spanning exactly 0–10 s. Together these meant the trained head never ran on an ordinary upload:
not a WAV loop, not an MP3 song, not a 10.02-second Ogg. Every real recording fell back to the
hand-written rules in `ensemble.ts`. This was verified in the running app before the change.

## What changed

`supportsFusionInput` now matches the release's **own** declared input rule. `policy.json`
states `inputSupport` as `app-mse-v1`: a content guard — non-silence and at least 2.048 seconds —
with no container condition. The scorer never observes the container; every model reads decoded
PCM. The gate is now `mode === 'full' && duration >= 2.048`.

`fusionPresentation` accepts any number of scored windows. A label is reported when it is
accepted in **any** complete window, because requiring agreement across every window would
discard anything that does not play for the whole recording. A window that produced no native
output (silence) is skipped; a `failed` or `unsupported` window means the recording was not
fully scored, and nothing is presented.

Neither the model weights, the policy thresholds, the decision rule, nor the acceptance receipt
changed. `acceptance.json` still attests exactly what it attested before: the 256-clip held-out
run on ten-second Ogg input. This document is separate evidence for the input domain only.

## Evidence

24 clips from the already-consumed development and calibration splits of the 2026-10-03 OpenMIC
pilot, each uploaded through the real app UI in a cold browser profile, in four variants. The
locked 24-clip test split was not opened. No labels participate: this measures whether the same
audio produces the same decisions, not whether those decisions are correct.

| Comparison | Clips identical | Primary source identical | Labels agreeing | Disagreements |
| --- | ---: | ---: | ---: | ---: |
| Ogg vs WAV (lossless) | 24/24 | 24/24 | 85 | 0 |
| Ogg vs MP3 (192 kbps) | 23/24 | 24/24 | 84 | 1 |
| Ogg vs 20 s (3 windows) | 23/24 | 23/24 | 85 | 1 |

96 of 96 analyses completed. No page errors and no non-loopback requests were recorded. Fusion
ran on every variant: one window for 10-second Ogg and WAV, two for MP3 (lossy encoding adds
padding past 10 s), three for the 20-second doubles.

Both disagreements concern a single borderline saxophone decision: lost under MP3 on
`020100_69120`, gained in the 20-second variant of `124841_69120`. 254 of 256 label decisions
agree, so lossy encoding and window count move borderline calls and nothing else. This is a
consistency result on 24 recordings, not a precision or recall measurement, and it does not
extend the receipt's accuracy claim to any new tier.

Reproduce:

```
node scripts/qualify-fusion-input.mjs <clip directory> <output directory>
```

with `ogg/`, `wav/`, `mp3/` and `wav20/` subdirectories of matching stems, `APP_URL` pointing at
a running dev server and `CHROMIUM_PATH` at an installed Chromium. Per-analysis results are in
[agreement.json](evaluations/fusion-input-tier-2026-10-04/agreement.json). No audio is committed.

## Confirmed on real user samples

Three files from a UK bass sample pack, uploaded through the UI:

| File | Length | Fusion | Result |
| --- | ---: | --- | --- |
| `Vocal_Badboysound.wav` | 1.29 s | correctly skipped — below the 2.048 s policy minimum | source `voice` |
| `Melodic_Loop_Drone_Dm.wav` | 6.86 s | ran, 1 window | `synthesizer` |
| `Melodic_Loop_BigSaw_Dm_140.wav` | 6.86 s | ran, 1 window | `synthesizer`, plus a `guitar` false positive |

All three were outside the old tier and would have received no trained-head decision at all.
The `BigSaw` false positive is a taxonomy limit, not a regression: the twenty OpenMIC classes
contain no supersaw, and a distorted saw lead resembles a distorted guitar to an
instrument-trained model.

## Limits

- 24 recordings in one genre-mixed public corpus; agreement on them is not a guarantee for
  other material.
- Only one lossy format and one bitrate were checked.
- The longest input tested is 20 seconds over three windows. Behaviour on a full-length track
  with many windows follows the same rule but has not been measured against labels.
- The union-over-windows rule is a deliberate recall choice. An instrument accepted in one
  window of many is reported for the whole recording.
- No accuracy claim for any category changes on the strength of this document.

# Why tags with 300+ training clips still score low (2026-10-10)

Chris asked for the label and detector fixes for the tags that already have plenty of training audio but stay below
60/60 on held-out real clips. Source: the live scoreboard (`reports/scoreboard/latest.json`, built from run 7's
winners file at 00:11 PDT, before #193 shipped 35 maybe heads at 50/50). 73 tags have 300+ training clips and sit
below 60/60; 9 timbre tags are excluded. Nothing below was tuned on a test set.

Ownership: cutoff tuning for precise-but-rare tags belongs to "Recall boost for near-misses"; training runs belong to
"Plan training round 9"; run 7's six winning tags ship from "Score runs 7 and 8".

## 1. A detector passes on real clips, but the app doesn't show it (6)

| Tag | Best real score | What it is | Fix |
|---|---|---|---|
| hand percussion | 0.97 / 0.73 (round 19, n=154) | trained CLAP head, never shipped (labels were "owned by the other session") | ship the head; weights are in the round-16 export on Chris's Mac |
| vocal shout | 0.91 / 0.55 (n=129) | same | same |
| breath | 0.81 / 0.50 (n=142) | same | same |
| bell | 0.73 / 0.55 (n=223) | same | same |
| water ambience | 0.75 / 0.56 (FSD50K eval, n=191) | output already in the public tagger file, not in taggerPolicy.json | promote it (asked the run 7 thread, which is rewriting taggerPolicy.json) |
| percussion | 0.87 / 0.55 (FSD50K eval, n=343) | run 7 output | shipping with run 7 |

tuned percussion (0.92 / 0.61 in round 16) has the same kind of unshipped head.

## 2. Measured only on code-made audio (4)

filtered (0.97 / 0.80) and reverberant (0.85 / 0.60) looked like passes, but round 19's "extra sources" for them is
`fxr`, the effect renders. Render-trained effect heads were already shown to fail on real recordings (reverberant
8% / 3%). distorted and falling are measured on NSynth renders only. They need real test clips first, then real
training audio (EGFxSet's real pedals cover reverberant and distorted).

## 3. Labels are the problem (both numbers low)

| Tag | Real score | Cause | Fix |
|---|---|---|---|
| noise | 0.22 / 0.10 | the catalog means "a burst of white noise", but Freesound uploaders tag anything noisy "noise"; static noise already lists "white noise" as an alias | merge into static noise, or label only from CED's White/Pink noise classes |
| foley hit | 0.12 / 0.01 | uploader words; overlaps foley, impact and percussion hit | FSD50K labels added in #195 (Thump, Knock, Slam, Clink: 1,179 train, 618 test clips) |
| percussion hit | 0.41 / 0.34 | overlaps kick, snare, tom and foley hit (all are "hits") | keep only CED/one-shot rows not already a named drum |
| synth stab | 0.07 / 0.03 | "stab" also means orchestra stabs; overlaps synth hit | merge into synth hit, or listen |
| synth bass | 0.19 / 0.18 | overlaps 808, sub, reese, wobble and acid bass, which split its positives | treat as the parent: positive whenever a child is |
| synth drone | 0.15 / 0.23 | overlaps atmospheric pad, texture and ambient drone | parent/child labels, not negatives for each other |
| synth sequence | 0.22 / 0.08 | overlaps synth arpeggio | same |
| fm synth, wobble bass, acid bass, synth lead, synth pluck | 0.10-0.28 recall | CLAP fingerprints don't separate synth types; uploader words are loose | labelled synth sets (Surge renders only as a supplement) |
| rimshot | 0.28 / 0.24 | overlaps snare; WaivOps rimshot is rendered | CED "Rimshot" picks (35 at 0.5) |
| bitcrushed, glitch effect, saturated, echoing | 0.22-0.49 | effect words used loosely; saturated overlaps distorted | CED-confirmed rows in round 9; saturated/distorted never negatives for each other |
| sound effect | 0.51 / 0.15 | an umbrella word: almost every Freesound clip is a sound effect | labelled sets only (round 9 already drops uploader words) |
| breath / vocal breath | 0.81 / 0.50 and 0.67 / 0.35 | FSD50K teaches both from the same Breathing/Sigh labels, so they are one tag twice | merge vocal breath into breath |

## 4. A rule, not a sound model

syncopated, rhythmic, sustained, staccato, rising, falling, gliding, rolling, dry: describe timing or envelope, which a
sound-embedding model barely hears, and uploader tags for them are unreliable (round 19: sustained 0 of 19).
Earlier DSP attempts: syncopated 0.19 / 0.57, rising 0.45 / 0.26, rolling only 6 test clips. They need a hand-checked
test set before any rule can be shipped honestly.

## 5. Recall only (precise when they fire)

acid synth, bongo, breakbeat, cello, clarinet, double bass, electric piano, flute, bird ambience, machine ambience,
vocal phrase, whistle, texture, atmospheric pad, wind ambience, tuned percussion, vinyl crackle, vocoder vocal, plucked,
gliding, static noise, vocal breath, tom, laser. Owned by "Recall boost for near-misses" (cutoffs) and round 9 (more
real positives). Several only have the CLAP zero-shot fallback today, so there is no cutoff to tune; they need a head.

## 6. No allowed audio or no test

dark, bright, rhythmic (no allowed audio); vocal harmony (no measurement yet).

## False alarms, not missed sounds (from the cutoff-tuning thread)

Cutoff tuning flipped none of these, so the fix is cleaner training data or hard negatives (look-alike clips labelled absent), not a lower bar:
clarinet (31/74), mandolin (44/78), whistle (16/81) on 6,250 practice clips; marimba (13/90) and sound effect (39/91).
Hard-negative lists for these go to the round 9 training thread as label input. 28 near-miss tags (string synth, vocal shush, tuba, sitar, ...) have no trained detector yet and need training data first.

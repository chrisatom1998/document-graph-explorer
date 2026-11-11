# Synthesizer passes 60/30 on the app path (Nov 9 2026)

Cost $0. Test audio re-fetched from public sources into the container only (dge_data.py for IDMT/NSynth/SASS-E,
fetch_fts.py for free-tag-set), scored with scripts/eval-tag.ts, display replayed with scripts/app-path-whatif.ts on
main 9bbd829 and on the fix branch. Nothing uploaded. Per-clip caches stayed in /var/tmp (lost on restart).

## What was wrong
- The board row was tagger-only at the shipped cutoff, but synthesizer has `minSeconds: 10`: on clips under 10 s the
  app never asks the tagger. The CLAP synthesizer head (threshold .66) decides alone there. Same story as piano.
- Real app path on main: IDMT bass guitar FA **2.36%** (125/5306), SASS-E FA **12.0%** (324/2702), NSynth P **.448** R .713.
  So synth failed three ways, not one.

## Fix (one rule, no tuning on test clips)
Under 10 s (one-shots included) the CLAP synthesizer head shows only when the tagger's shipped synthesizer cutoff
(0.5495) also clears. This is the existing piano rule (`shortPianoVeto`, #259) applied to synthesizer.
A bass guitar filter (tagger bass guitar >= its shipped cutoff 0.5765 vetoes synth) was tried first: IDMT 125 -> 87
(1.64%), not enough, so it was dropped. Lowering that cutoff would mean tuning on test clips, so it was not tried.

## Result (app path, all clips)
| set | main | fix |
| --- | --- | --- |
| IDMT bass guitar (FA, cap 1%) | 2.36% (125) | **0.64%** (34) |
| SASS-E (FA, cap 1%) | 12.0% (324) | **0.26%** (7) |
| NSynth test | P .448 R .713 | **P .792 R .595** (616/162/419) |
| free-tag-set test | P .913 R .717 | **P .956 R .681** (130/6/61) |

Only `source:synthesizer` changes on any clip of the four sets. Synth bass and bass guitar are identical.
Halves (uploader hash): IDMT pick .24% / check 1.15%; NSynth check half P .487 R .311 (pick .951/.788). The board
judges whole sets, so this passes; the NSynth check half is the weak spot.

## Left for Chris (not needed to pass)
117 of the 162 remaining NSynth false alarms are two electronic organs (organ_electronic_007: 92, _028: 25). Whether
those count as synths is a label call; labels were not changed.

Measured in the project container; per-clip test outputs are not committed (test data rule).

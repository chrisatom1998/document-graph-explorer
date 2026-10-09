# GPT-Audio-1.5 as a labeller: check before building (2026-10-09)

Question (Chris): could OpenAI's GPT-Audio-1.5 improve DGE's labelling accuracy, and if so, add it.
Rule: it ships only if it beats main on the judge-only sets; it never becomes a hard dependency of the browser-only app.

## What the model is (OpenAI's model page, checked 2026-10-09)
- `gpt-audio-1.5`: audio and text in, audio and text out. **Chat Completions only** (not Responses or Realtime).
  Function calling is supported, so answers can be forced into fixed choice lists. 128k context.
- Price per 1M tokens: audio in **$32**, text in $2.50, text out $10.
  OpenAI does not publish the audio tokens per second. Earlier GPT-4o audio models used about 10 to 21 per second,
  so a 10 s clip is roughly **$0.003 to $0.007** and a 4 minute song sent whole roughly **$0.08 to $0.16**.
  `label.py` records the real usage of every call, so the run will measure this.
- It is a general audio chat model, not a music tagger: no per-tag scores and no thresholds to tune, only yes/no answers.

## What we already know about audio chat models here
In October 2026 the repo tried Gemini as a labeller (`scripts/gemini-label-test-set.py`, commit 4f70b6f).
Gemini 3.1 Pro got 36 of 48 expert-labelled FSD50K clips right, below the 40/48 bar set beforehand, so it was only
used to rank clips for human review. GPT-Audio-1.5 may do better or worse. The run below measures it.

## The check (ready to run, needs a key)
Workflow `.github/workflows/gpt-audio-eval.yml`, three jobs, spend capped from measured usage (**$5 total cap**, expected about $3 to $4):

| Set (judge-only) | Clips | What it decides | Main today |
|---|---|---|---|
| DJ clip round 2, OpenMIC instruments | all 500 | the 11 instrument tags, incl. bass and organ that miss on main | bass .60/.60, organ .48/.88, trumpet .60/.67 |
| DJ effects, round-1 held-out | 300 of 1,193 (seeded, label-blind) | 21 DJ effects | 2 of 20 at 70/70 |
| GiantSteps MTG key (Beatport) | 150 of 500 (seeded) | exact key | 54.9% |

Main's numbers are copied from committed reports into `reference-main.json` (sources listed there).
The scorer prints precision and recall with 95% intervals and calls a tag "better" only when GPT's interval for
min(P, R) clears main's. The prompts were written once, before any answer was seen, and are not tuned on these sets.

To run: add the repository secret `OPENAI_API_KEY` (GitHub: Settings > Secrets and variables > Actions), then run the
workflow from the Actions tab or push a change to `run.txt`. Results land in `results/`.

## If it wins on some tags: how it would ship
- An optional "Check with GPT-Audio" provider in Settings, off by default, using the person's own OpenAI key kept in the
  browser like the existing OpenRouter key. No key is committed or shipped, and offline/air-gap mode turns it off.
- Only the tags where it beat main would use it, and each one shows "GPT-Audio-1.5 (cloud)" as its source.
- It sends a few 10 s windows per track (cost shown before running), never the whole library by default.
- Everything else keeps working without it.

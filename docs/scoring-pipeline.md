# How sound tags are scored and judged "good enough to ship"

This page is for people who do not read code: producers, managers, anyone who wants to know why a tag such as
*kick*, *snare*, *drums* or *riser* does or does not show up in the app.

Everything below was checked against the code. Where the code and the loose way people talk about it differ, this page says so.

---

## 1. Tags, scores and cutoffs

- A **tag** is a word the app puts on a sound clip: kick, snare, drums, riser, and so on.
- A **score** is a number a model gives a clip for one tag. Higher means "more like this sound". The trained tagger and
  the trained heads give scores from 0 to 1. The raw text-prompt (CLAP) matching scores can run from -1 to 1.
- A **cutoff** (the code calls it a *threshold*) is the line on that number.
  The tag shows when the clip's score is **at or above** the cutoff. Below it, the tag stays hidden.

Each tag the scoreboard can measure has its own effective cutoff. Some scoreboard tags have no working model output
or cutoff switched on; those cannot be measured. A low cutoff tags more clips, including wrong ones. A high cutoff tags fewer clips and is
usually more accurate, but it misses more real ones.

On the test scoreboard a clip's score for a tag is its best score over the complete 10-second windows within the clip's first 30 seconds.
A clip shorter than 10 seconds is padded with silence and scored as one window; for longer clips a leftover piece under
10 seconds at the end is ignored (`reports/scoreboard/scripts/score_model.py`).

## 2. Precision, recall and false alarms

Two questions tell you whether a tag is any good.

- **Precision:** of the clips we tagged, how many really had the sound?
  If the app tags 10 clips "snare" and 7 are snares, precision is 0.70 (70%).
- **Recall:** of the clips that really had the sound, how many did we catch?
  If 20 clips are snares and we tagged 7 of them, recall is 0.35 (35%).
- **False alarm:** a clip tagged with a sound it does not have. Every wrong tag in the precision example is one.

They pull against each other. Moving the cutoff up usually raises precision and lowers recall. Moving it down does the opposite.

On the scoreboard, a *positive* is a test clip that really has the sound. A *negative* is a test clip that is known not to have it.

## 3. The ship line: "60/30"

A tag is "good enough to ship" when it clears the **ship line**. The scoreboard records the ship line as **60/30**.

- The **first number is precision**: at least **0.60**.
- The **second number is recall**: at least **0.30**.

So the line asks that most tags shown are right (6 in 10 or better), and it accepts catching only 3 in 10 of the real
ones. That tilts toward "be right when you speak up" over "find everything".

In `reports/scoreboard/scripts/precision_first.py` the line is stored as `'60/30': (0.6, 0.3)` (precision first, recall second).

### The exact rule

The rule is applied **separately to each test set**. A test set is a folder of clips with known answers.
This is the plain "all clips" version of the rule. The final ship-line flag uses a stricter half-by-half version,
described at the end of this section.

1. **Which sets count.** A set counts for a tag only if it has **at least 5 positives** (clips that really have the sound).
2. **Every counted set must pass.** In each counted set, precision must be at least 0.60 **and** recall at least 0.30.
   One weak counted set fails the tag.
3. **Negatives must exist.** At least one counted set must contain negatives. Without any clip that lacks the sound,
   precision tells you nothing, so the tag cannot pass.
4. **False-alarm cap.** Take a set where the tag has **fewer than 5 positives** (so it is not counted) but there are
   **at least 50 negatives**. The tag fails if it fires on **more than 1%** of those negatives.
5. **"Unmeasured" fails.** A tag with no counted set, or with none that has negatives, is called *unmeasured* and fails.
   In the final step of `precision_first.py` such a tag is labelled "untested" and never passes.

A tag that never fires on a counted set gets precision 0 there, so it fails too.

**The half-by-half version (what `shipLinePass` uses).** The fair test in section 4 judges each half of the clips
separately (the halves are explained there). A set still counts only if it has at least 5 positives overall, but it is
judged on a half only if that half has at least one positive. Each judged half needs at least one counted set that has
negatives, and every counted set judged there must reach 0.60 precision and 0.30 recall. The false-alarm cap (rule 4)
is also checked half by half, so the 50-negative minimum applies to the negatives in that half.

### Is the ship bar really 60/30?

Mostly yes, with some details to know. The code does not say "60/30 replaced 50/50". It says this:

- `reports/scoreboard/scripts/build_scoreboard.py` builds the scoreboard and reports **three symmetric bars**:
  50/50, 60/60 and 70/70 (the same number for precision and recall).
- `reports/scoreboard/scripts/precision_first.py` defines **three lines**: **50/30, 60/30 and 50/50**.
  Its opening note records a request to hold precision at or above 0.5 and let recall follow.
  At the end of the script it writes **60/30 into the board as `shipLine`**. A comment there credits the choice to Chris, 11 Oct 2026.
- A tag's `shipLinePass` flag on the board comes from the fair "best of both" test at 60/30 (section 4).
- Repo documents still talk about 50/50 and 60/60 too. For example, `docs/evaluations/data-gaps-2026-10-31/README.md`
  measures "training data each tag needs to reach 50/50 and 60/60".

So 60/30 is the ship line written into the board. 50/50, 60/60 and 70/70 are still reported as stricter or alternative bars.

## 4. How the cutoff is chosen on the scoreboard

Two kinds of cutoff exist for one tag (`reports/scoreboard/scripts/precision_first.py`):

- **Shipped cutoff.** The one currently in the app. It comes from the app's tagger policy file (`src/audio/taggerPolicy.json`)
  or from the model's own cutoff list.
- **Precision-first cutoff.** A cutoff chosen to reach the line's precision target (0.5 for the 50/x lines, 0.6 for 60/30).
  Recall is whatever follows. There is one such cutoff for each half of the clips (see below), for each precision target.
  How one is picked:
  1. In one test set, line the clips up from highest score to lowest. Walk down the list and, at each real positive,
     check whether the precision so far (real positives so far out of all clips so far) reaches the target.
     The score of the **last real positive that qualifies** becomes that set's cutoff. This is not always the lowest
     possible cutoff, because wrong clips and tied scores can change the precision as the list goes on.
     If no point reaches the target, that set gets a cutoff nobody can reach.
  2. Only test sets with at least 3 positives in that half give a cutoff. The tag's cutoff is the **highest** of these
     per-set cutoffs, so every such set holds the target.
  3. If no set has 3 positives in that half, all the sets are pooled into one list and the same walk is done once.
     With no positives at all, the tag gets no cutoff and never fires.

### No grading your own homework

If you pick a cutoff on the same clips you then grade it on, the result looks better than it is. So the script splits the clips in two:

1. Every clip goes into **half A or half B**. The split uses the clip's **uploader, pack or instrument**, so one source
   never lands on both sides. The script turns that name into a fixed number (a SHA-256 fingerprint, then odd or even),
   so the same source always lands in the same half. (A pack's clips sound alike, and mixing them would let the test peek at the answer.)
2. A cutoff is picked on **one half only**, and judged on the **other half**.
3. **"Fair best of both":** for each tag, the script picks *shipped* or *precision-first* on one half
   (it keeps *shipped* if that passes there, or if precision-first fails there too).
   It then checks the choice on the other half.
   This is done both ways round (pick on A, judge on B; pick on B, judge on A).
4. A tag passes the ship line only if **both directions pass**.

## 5. Cutoffs inside the app itself

The scoreboard decides whether a tag is *good enough*. The app then uses several checks of its own to decide what to show
on a given clip. These live in `src/audio/djTags.ts`.

### Text-prompt scoring (CLAP) in `selectDjTags`

CLAP is a model that compares a clip with written descriptions. For each family of descriptions the best-scoring one wins only if
it clears a **cutoff** and beats the runner-up by a **margin**.

| Family | Cutoff | Margin over runner-up |
|---|---|---|
| Sound type (`dj-type`) | 0.35 | 0.04 |
| Breath (`breath`) | 0.35, or **0.45** if the winner is "vocal breath" | 0.05 |
| Tone and rhythm (`dj-tone`, `dj-rhythm`, shown as character) | 0.30 | 0.04 |
| Every other family, if its tags are "character" | 0.35 | 0.05 |
| Every other family, otherwise | 0.40 | 0.05 |

Extra rules: "vocal breath" is never accepted from the sound-type family (the breath family decides it).
Other families need at least two competing descriptions, since an isolated score is never trusted.

### Trained heads

A **trained head** is a small model trained for one tag. In `applyReviewedDecisions`, a head "already cleared its own measured threshold",
so its include decision is accepted without a second cutoff. It is labelled **Trained head**.
If the model's metadata marks the head as `maybe`, it is labelled **Trained head (maybe)**.
(Two code comments explain "maybe" differently: "passed at 50% but not 65% on unseen brands" and "below the full-tag bar
of 50% precision and recall". This page does not say which is right.)

### Reviewed examples

When a person has reviewed examples of a tag, those can override the rest:

- An **include** with a score of **0.88 or more** adds the tag, labelled **Reviewed examples**.
- An **exclude** with a score of **0.94 or more** removes the tag.

### Whose evidence wins

Scores from different models are not on the same scale. So a tag is only replaced by *better-checked* evidence,
never by a bigger number from a less-checked model. The order (`djEvidenceRank`) is:

1. **Reviewed examples** (rank 3)
2. **Trained head** (rank 2)
3. **Trained head (maybe)** (rank 1)
4. **Untested** (rank 0, for example plain CLAP prompt scores)

At equal rank, the higher score wins.

## 6. Umbrella tags: two separate mechanisms

"Drums" is an umbrella over kick, snare, clap and many others. Two different things roll names together. They are not the same.

### 6a. In the app: a child tag also shows its umbrella

Every production tag in `src/audio/djCatalog.json` can have a `source` field naming its umbrella.
For example kick has `source: drums`. `deriveTestedSources` in `src/audio/djTags.ts` uses it. Its conditions are:

- The child must be a **production** tag.
- Its evidence must be a **Trained head** or **Trained head (maybe)**. Reviewed examples do not trigger it, and neither do untested scores.
- The `source` it names must be a real source-group tag in the catalog.
- The umbrella copies the child's **score and evidence label**. So a "maybe" kick gives a "maybe" drums.
- The umbrella replaces an existing one only if the new evidence **outranks** it (section 5). An untested guess never blocks it.

Result: when kick is shown from a trained head, drums is shown too.

This is the rule for *tested* umbrellas only. The app has other paths that can also add an umbrella from a tag with no
trained-head evidence, for example an ordinary text-prompt (CLAP) tag (`src/audio/djClassification.ts`). Those umbrellas
are untested and can be replaced by better-checked evidence.

### 6b. Merged look-alike names

`MERGED_DJ_LABELS` (in `src/audio/djTags.ts`) lists names the models could not tell apart. People see and confirm one name.
Examples from the code: **closed hi-hat is shown as hi-hat**, **djembe, cajon, triangle and hand percussion are shown as percussion**,
viola as strings, trombone and tuba as horn. The old names stay in the catalog because trained heads and saved analyses use them.

On the scoreboard (`reports/scoreboard/scripts/build_scoreboard.py`) this list is used for **folding**: a test clip labelled with a
merged child (say, djembe) also counts as a **positive for its parent** (percussion). Folding can chain up to 5 steps.
`precision_first.py` and `app_clap_score.py` do the same, using the same list copied into the board file (`mergedInto`).
`app_clap_score.py` folds both the expected labels and the app's decisions.

### What the scoreboard does not do

Both scripts were checked for this. **The scoreboard does not roll kick up into drums.**
Folding uses only `MERGED_DJ_LABELS`. The catalog's `source` field is not read by either script, so a test clip labelled
only "kick" is not added to the drums positives. The kick-to-drums roll-up (6a) is an app behaviour only.

### Names and hidden tags

- `DISPLAY_NAMES` changes only what people read: *plucked* shows as "one shot", *falling* as "downlifter", *reverberant* as "wet", *horn* as "brass".
- `DJ_HIDDEN_LABELS` lists tags that still run but are not listed in the picker unless searched for.
  The scoreboard's headline "pickable" count leaves out hidden and merged names.

## 7. Worked example

**Illustrative example - made-up numbers, not real results.**

Test set 1 has 10 clips for the tag "snare". Five really are snares and five are not. The cutoff is 0.50.

| Clip | Really a snare? | Score | Tagged at 0.50? |
|---|---|---|---|
| 1 | yes | 0.90 | yes (right) |
| 2 | yes | 0.80 | yes (right) |
| 3 | yes | 0.70 | yes (right) |
| 4 | yes | 0.40 | no (missed) |
| 5 | yes | 0.30 | no (missed) |
| 6 | no | 0.60 | yes (**false alarm**) |
| 7 | no | 0.20 | no |
| 8 | no | 0.10 | no |
| 9 | no | 0.10 | no |
| 10 | no | 0.05 | no |

- Tagged: 4 clips (1, 2, 3, 6). Right: 3. **Precision = 3 / 4 = 0.75.**
- Real snares: 5. Caught: 3. **Recall = 3 / 5 = 0.60.**
- Check against 60/30: 0.75 is at least 0.60, and 0.60 is at least 0.30. This set **passes**.
- The set has 5 positives, so it counts. It has negatives, so rule 3 is met.

Moving the cutoff: at **0.25**, six clips are tagged and five are right (precision 5 / 6 = 0.83, recall 5 / 5 = 1.00).
At **0.65**, three clips are tagged and all are right (precision 1.00, recall 3 / 5 = 0.60).

Now add a second set with only 3 real snares (too few to count) and 200 clips that are not snares.
The cap allows at most 1% of 200 = 2 false alarms. If the tag fires on 4 of those 200 clips (2%), the cap is broken
and the tag **fails**, even though set 1 was fine.

**Roll-up example.** Say the app's trained head says "kick" with score 0.82. Kick is shown as a **Trained head** tag.
Because kick's catalog source is drums, the app also shows **drums** with score 0.82 and the same Trained head label.
Separately, on the scoreboard, a test clip labelled "closed hi-hat" counts as a positive for "hi-hat",
because closed hi-hat is a merged name for hi-hat.

## 8. Where this lives

In this repo:

- `src/audio/djTags.ts`: CLAP cutoffs and margins, trained-head and reviewed-example rules, evidence ranking,
  `deriveTestedSources`, `MERGED_DJ_LABELS`, `DISPLAY_NAMES`, `DJ_HIDDEN_LABELS`.
- `src/audio/djCatalog.json`: the tag list, each tag's group and its `source` umbrella.
- `src/audio/djClassification.ts`: calls `deriveTestedSources` and the evidence ranking when it assembles a clip's tags.
- `src/audio/taggerPolicy.json`: the shipped cutoffs the scoreboard reads for tagger-decided tags.
- Background reading: `docs/dj-sound-tags.md`, `docs/tag-decision-map.md`, `docs/hf-sound-tag-training.md`,
  and the evaluation notes in `docs/evaluations/` (`clean-retrain-2026-10-11`, `code-fixes-2026-10-11`, `data-gaps-2026-10-31`).

**Not in this repo:** the scoreboard scripts under `reports/scoreboard/scripts/`. They live in Chris's private project folder,
along with the live scoreboard file. The repo's own docs say the scoreboard is kept there
(for example `docs/evaluations/data-gaps-2026-10-31/README.md`). They are:

- `build_scoreboard.py`: scores each tag on the test sets and reports the 50/50, 60/60 and 70/70 bars.
- `precision_first.py`: the A/B split, the precision-first cutoffs, the 60/30 ship line and `shipLine`.
- `app_path.py`: shows which part of the app shows each tag, and counts the 60/30 passes as users actually see them.
- `app_clap_score.py`: scores the app's own CLAP-side decisions (text-prompt and learned-head, including "maybe" heads) on the test sets. The decisions are fixed beforehand, so no cutoff is fitted on those clips.
- `score_model.py`: runs the tagger on every test clip and saves each clip's best score.
- `fetch_job_scores.py` and `publish_board.sh`: copy in scores from the cloud scoring jobs and publish the board file.

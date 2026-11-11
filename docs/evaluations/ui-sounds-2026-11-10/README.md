# UI-sound tags: door ships, alarm and "ui sound" do not (2026-11-10, $0, run in the container)

Recipe is the same as the sound-effect batches (docs/evaluations/sfx-tags-2026-11-06): one logistic head per tag on the app's
q8 CLAP window fingerprints, trained on FSD50K dev "train" clips after the private exclude list (every positive, every
look-alike class, 3,000 random others), cutoff = lowest in 0.05..0.99 with FSD50K dev-val precision >= 0.65 (at least 3 true
positives), then judged once. Rules were fixed before any judge clip was scored.

FSD50K has no "beep" or "click" class, so the three words tested were:
- door = FSD50K Door (includes slam, sliding door, doorbell, knock)
- alarm = FSD50K Alarm
- ui sound = Alarm, Doorbell, Ringtone or Tick

Judge: FSD50K eval (every clip of the five positive classes plus 2,500 random other clips; the other clips are weighted
9,193 / 2,500 so precision matches the full 10,231-clip set) and 2,048 random NSynth-valid notes as music false alarms
(<= 1%). FSD50K eval had never been graded for these classes. Drum machine was not tested: its only free labels are AudioSet,
which would be a new, noisy judge set.

| tag | cutoff | eval P | eval R | NSynth-valid false alarms | verdict |
|---|---|---|---|---|---|
| door | 0.80 | 0.702 | 0.725 | 1 / 2,048 | passes 60/60 |
| alarm | 0.92 | 0.869 | 0.557 | 216 / 2,048 (10.5%) | fails: sustained synth notes trigger it |
| ui sound | 0.92 | 0.879 | 0.504 | 208 / 2,048 (10.2%) | fails for the same reason |

Door ships as a normal tag (oneShot, so short clips are tagged too). App-path check (scripts/eval-tag.ts) on a 568-clip
dev-val subsample, which is not the judge set: P 0.839 R 0.765, passes 60/30. Analysis revision 163/164. Existing prompt
vectors are unchanged; only the new dj-door prompts were appended.

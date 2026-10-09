# Whole-song judge set (frozen 2026-10-09)

417 real, complete songs whose every instrument is known, because each was recorded as separate stems. **Judge only:
never train, tune, calibrate or pick thresholds on these songs, or read per-song results.**

| Source | Songs | Genres | Licence |
|---|---|---|---|
| MedleyDB 1 and 2 (Bittner et al. 2014, 2016) | 178 (23 are excerpts) | classical, jazz, rock, singer/songwriter, world/folk, electronic/fusion, pop | CC BY-NC-SA 4.0 |
| MoisesDB (Pereira et al. 2023) | 239 | rock, singer/songwriter, pop, rap, electronic, ... | CC BY-NC-SA 4.0 |

Audio: the full mixes in `hf://datasets/seungheondoh/cmd-{medleydb,moisesdb}-metadata` (`*.tar.gz`), fetched at run
time and never committed. Instrument lists: that repo's metadata parquet for MoisesDB, and the official MedleyDB
metadata (github.com/marl/medleydb) for MedleyDB, which also names singers and says whether a song is instrumental.

**Why this set.** The Jamendo sets only have uploader tags, so a tag missing from a song proves nothing and precision
there is only a floor. Here a tag the stems rule out is really absent, so precision and recall are both real.

**Labels** (`manifest.json`, built by `scripts/whole-songs/build-manifest.py`). For each song, each scored catalog tag
is 1 (an instrument of that kind has its own stem), 0 (no stem is or might be that) or left out (unknown). Unknown is
used wherever stems can't settle it: a horn section leaves trumpet, trombone, horn and tuba unknown; a drum kit recorded
without its own hi-hat track leaves hi-hat unknown (the overheads pick it up); "fx/processed sound" stems leave every
effect tag and synthesizer unknown. MoisesDB's lists leave voices out, so voice is only judged on the 177 MedleyDB songs.
Tags no song has (sitar, kalimba, riser, ...) still count false alarms. Character tags and sample types (loops, one-shot
hits) are not scored.

Positives per tag (songs with the tag / songs where it is known): drums 363/415, guitar 314/410, bass guitar 294/417,
electric guitar 254/415, kick 249/308, snare 241/302, piano 156/383, acoustic guitar 155/403, percussion 137/178,
hi-hat 130/218, synthesizer 113/389, cymbal 107/171, voice 72/177, strings 61/322, atmospheric pad 51/382,
double bass 47/371, organ 47/403, electric piano 45/399, violin 45/360, synth lead 41/382, synth bass 39/382,
mallet instrument 37/406, flute 29/393, cello 28/372, viola 23/366, clarinet 21/401, saxophone 21/380, trumpet 21/393,
tambourine 17/312, vibraphone 15/398, bassoon 13/401, shaker 11/312, tabla 11/413, horn 10/388, trombone 10/388,
mandolin 9/394, oboe 7/401; fewer than 6 for accordion, clap, harp, glockenspiel, steel guitar, banjo, gong,
harmonica, tuba, bongo, cowbell.

**Kept out of training.** The tagger's Mixing Secrets training data (`scripts/audio-model/prepare-rawstems.py`) skips
every MedleyDB artist and MUSDB18 (which reuses MedleyDB songs).

**Running it.** `.github/workflows/whole-songs-eval.yml` analyses every song whole in the built app (12 shards, 6 at a time) and
scores it with `scripts/whole-songs/score.mjs`: per-tag precision and recall with artist-bootstrap 95% intervals, plus
the 12 classes of the round 3 held-out scorer for comparison. Aggregate reports go to `results/<app ref>-<commit>/` on
the branch that ran it, never on main.

A 4-song local timing run (2026-10-09, main @ 18a3f34) used songs from this set; only its run time (about 5 minutes per
song) was used, nothing was tuned on it.

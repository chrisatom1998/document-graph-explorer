# Automatic audio relationships

Audio analysis, saved corrections, imports, and session restoration refresh the same derived relationships. Existing document connections and authored relationships are preserved.

- **Sounds alike:** each analysed track keeps a CLAP sound fingerprint (`embedding`: the unit-length mean of its 10-second window embeddings). Each track's 3 closest-sounding tracks are always considered, and a pair links when the fingerprints are at least 70% similar (`SOUND_LINK_POLICY` in `src/audio/musicLinks.ts`). The reason shows the similarity and the tags both tracks share in the Sounds panel's tested-tag ranking (`confidentSoundSummary`, likely tier) or that you confirmed.
- **Tempo:** estimates with confidence at least 0.5, within 3 BPM or 4%. Half/double-time pulse rates use the same tolerance at the faster rate, are explicitly labeled, and receive 25% less weight. Missing/invalid BPM and confidence do not match.
- **Key:** strength at least 0.6; same, relative major/minor, and adjacent circle-of-fifths keys. A detected single pitch is not a key.
- **Instruments:** current reviewed source evidence takes precedence, including empty corrections and latest Reject/Unsure decisions. Otherwise the existing reliable-instrument policy applies. Filename/folder clues are fallback hints only, labeled as unverified and limited to 0.45 weight. They cannot replace reliable audio instrumentation.
- **Sound properties:** shared reviewed production/effect or character labels. Raw model rankings, uncalibrated scores, and AI suggestions do not qualify. The shared review projection handles aliases and latest-decision precedence.
- **Generic tags:** a pair that shares only broad tags (synthesizer, drums, percussion, sound effect, noise, environmental sound, airy, metallic, warm, bright, dry, reverberant, sustained, plucked), all below 0.7, gets no instrument or sound-property link unless a tempo or sound-alike link backs it up. Instrument-link reasons name each shared tag's source on each track (confirmed by you, model estimate, untested guess, uncalibrated catalog similarity, or file name).

Tempo/key filename tags retain their existing precedence over estimates but use strength 0.65 and disclose their origin. Tempo, key, instrument, tag and filename links are made whether or not the tracks sound alike. Original measurements are never overwritten. Edge weights represent match strength, not probabilities. Similarity does not establish shared samples, influence, or mix quality.

## Graph size and performance

Each audio node has at most **8 distinct automatic audio neighbors** and **4 edges per relationship type**. Limits apply to both endpoints. Existing document/title/authored relationships are outside these limits.

Each track's closest-sounding tracks are always candidates. Fingerprints are normalized to unit length before comparison; invalid or all-zero fingerprints are ignored. Fingerprints are compared all-pairs up to 800 tracks; larger libraries compare within fixed-seed random-hyperplane buckets. Feature buckets propose at most 128 further candidates per node, using local deterministic neighborhoods in large buckets. Candidate pairs are ranked by strongest evidence, scaled up when the shared tags are rare in the library, plus a small multiple-feature bonus. Selection is deliberately approximate for large packs, not an exhaustive nearest-neighbor search. Unknown values never create buckets. Evidence is projected once per node per rebuild.

Run `./node_modules/.bin/vite-node scripts/bench-music-links.mjs` for a reproducible 100/1,000/5,000-node benchmark. The October 4 implementation run on Chris's Mac measured 12/113/544 ms, with 787/7,966/39,861 typed edges and a maximum of 8 neighbors. Timing varies with evidence and hardware.

The existing connection panel exposes reasons, provenance, and strength; Filters includes **sound properties**. Imported graphs remain temporary: export corrections to retain them. Local collections retain their existing session persistence.

## Measured accuracy (2026-10-05)

`.github/workflows/sound-links-eval.yml` (benchmark: `scripts/sound-links/`) uploads opaque-named clips into the built app and checks whether linked clips belong together: 10 s OpenMIC full-mix songs by FMA genre, and NSynth single notes by instrument family. Held-out test sets, 150 clips each; random pairs share a genre 9% and a family 13% of the time.

| Sound-alike rule | Songs: links, clips linked, same genre | Notes: links, clips linked, same family |
|---|---|---|
| 3 closest, similarity ≥ 0.7 (current) | 82, 49%, **63%** | 269, 100%, 83% |
| Mutual top-3, similarity ≥ 0.5 (tried, not adopted) | 130, 89%, 45% | 152, 94%, **94%** |

Mutual matching links more songs but less accurately, and fewer notes more accurately; the overall graph scored lower on both sets (songs 17% vs 19%, notes 54% vs 73% of all links), so the current rule stays. Tempo and key links join same-genre songs only 11-14% of the time, close to random; they are kept because they describe the music, not because they predict genre. File-name and title links are not exercised by this benchmark.

## Versions: duplicates and remixes

A **versions** link (lime, its own filter) joins two tracks that are the same recording or another version of the same song. It is separate from sounds-alike links, and a pair of copies gets only the versions link: no extra tempo, key, tag or sound links between two copies of one file. The track card lists the group under **Versions**: copies of this recording first (chained through copies of copies), then other versions of the song and their copies. The group follows at most one other-version link, so one wrong title match cannot pull in a whole second song.

- **Same recording** (`src/audio/versionPrint.ts`): analysis stores a small version print (`versionPrint`, about 20 bytes per second, up to 8 minutes): pitch-class strength, the balance of 7 frequency bands, and loudness, twice a second. Two prints are aligned frame by frame across pitch shifts (any of 12 semitones) and speed changes from 0.86x to 1.18x, including trims and edits. A pair is the same recording when a 20 s stretch lines up at least 0.85, at least 60% of the shorter file lines up, and the band balance matches at least 0.7 (`VERSION_RULES` in `src/audio/versionLinks.ts`). The reason says what changed: pitched up or down, sped up or slowed down, trimmed or edited. Clips under 4 s get no print. Saved analyses from before prints existed get one the next time the track is analysed (decoding only, no models).
- **Another version** (remix, edit, cover): the file names must name the same song once the artist, the bracketed version note, key, BPM, year and track number are removed. When neither name is marked as a version and the artists differ, the pair also needs some material that lines up (0.55) or a CLAP similarity of at least 0.6. Audio alone is not used: on the test set, remixes of one song lined up no better than unrelated songs, and CLAP fingerprints of re-encoded copies of one file ranged from 0.65 to 0.99.
- **Speed**: each track's 8 closest harmonic fingerprints (which pitch classes sound together, at any transposition) and every title match are aligned, title matches first. Each graph rebuild aligns for at most 150 ms; the app schedules follow-up rebuilds until every candidate pair is done, and results are cached per pair.

### Measured accuracy (2026-10-06)

`scripts/versions/` builds the test set and scores it. 333 files: 45 ccMixter remixes of 9 a cappellas (other versions of one song, under Creative Commons), 16 melodic loops, and 8 copies of 34 of them made with ffmpeg: 128 kbps MP3, quieter AAC, trimmed, edited (a section cut out), pitched +2 semitones, sped up 5%, varispeed (really 14% slower and 2.5 semitones down on 48 kHz sources) and a DJ-style pitch 1 / tempo 3% change. Thresholds were chosen on half A of the songs; half B is held out. A pair counts as found when the track card's Versions group shows it with the right relation.

| Files named as uploaded | Duplicates P / R | Other versions P / R |
|---|---|---|
| Half A (tuning) | 1.00 / 0.91 | 1.00 / 0.58 |
| Half B (held out) | 1.00 / 0.84 | 1.00 / 0.20 |
| All | 1.00 / 0.88 | 1.00 / 0.41 |

With names hidden, duplicates are unchanged and no other versions are found. Without prints (older analyses) only title matches remain: 2% of other versions. Copies found by transform, songs then loops: MP3 18/18 and 14/16, AAC 18/18 and 13/16, trim 18/18 and 13/16, edit 18/18 and 13/16, pitch +2 16/18 and 14/16, tempo +5% 18/18 and 13/16, varispeed 14/18 and 14/16, DJ pitch/tempo 17/18 and 14/16. Most missed loops are under 4 s. Other-version recall depends on how files are named: half B's remixers often renamed the song.

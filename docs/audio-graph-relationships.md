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

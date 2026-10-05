# Automatic audio relationships

Audio analysis, saved corrections, imports, and session restoration refresh the same derived relationships. Existing document connections and authored relationships are preserved.

- **Sounds alike:** each analysed track keeps a CLAP sound fingerprint (`soundEmbedding`: the mean of its 10-second window embeddings, stored as 512 signed bytes). Two tracks are linked when each is among the other's 3 closest-sounding tracks and their fingerprints are at least 50% similar (`SOUND_LINK_POLICY` in `src/audio/musicLinks.ts`). The reason shows the similarity and the tags both tracks share in the Sounds panel's tested-tag ranking (`confidentSoundSummary`, likely tier) or that you confirmed. Fingerprints from different model weights are never compared.
- **Tempo:** estimates with confidence at least 0.5, within 3 BPM or 4%. Half/double-time pulse rates use the same tolerance at the faster rate, are explicitly labeled, and receive 25% less weight. Missing/invalid BPM and confidence do not match.
- **Key:** strength at least 0.6; same, relative major/minor, and adjacent circle-of-fifths keys. A detected single pitch is not a key.
- **Instruments:** current reviewed source evidence takes precedence, including empty corrections and latest Reject/Unsure decisions. Otherwise the existing reliable-instrument policy applies. Filename/folder clues are fallback hints only, labeled as unverified and limited to 0.45 weight. They cannot replace reliable audio instrumentation.
- **Sound properties:** shared reviewed production/effect or character labels. Raw model rankings, uncalibrated scores, and AI suggestions do not qualify. The shared review projection handles aliases and latest-decision precedence.

Tempo/key filename tags retain their existing precedence over estimates but use strength 0.65 and disclose their origin. Tempo, key, instrument, tag and filename links are made whether or not the tracks sound alike. Original measurements are never overwritten. Edge weights represent match strength, not probabilities. Similarity does not establish shared samples, influence, or mix quality.

## Graph size and performance

Each audio node has at most **8 distinct automatic audio neighbors** and **4 edges per relationship type**. Limits apply to both endpoints. Existing document/title/authored relationships are outside these limits.

Each track's closest-sounding tracks are always candidates. Fingerprints are compared all-pairs up to 800 tracks per model; larger libraries compare within fixed-seed random-hyperplane buckets. Feature buckets propose at most 128 further candidates per node, using local deterministic neighborhoods in large buckets. Candidate pairs are ranked by strongest evidence plus a small multiple-feature bonus. Selection is deliberately approximate for large packs, not an exhaustive nearest-neighbor search. Unknown values never create buckets. Evidence is projected once per node per rebuild.

Run `./node_modules/.bin/vite-node scripts/bench-music-links.mjs` for a reproducible 100/1,000/5,000-node benchmark. The October 4 implementation run on Chris's Mac measured 12/113/544 ms, with 787/7,966/39,861 typed edges and a maximum of 8 neighbors. Timing varies with evidence and hardware.

The existing connection panel exposes reasons, provenance, and strength; Filters includes **sound properties**. Imported graphs remain temporary: export corrections to retain them. Local collections retain their existing session persistence.

## Measured accuracy (2026-10-05)

`.github/workflows/sound-links-eval.yml` (benchmark: `scripts/sound-links/select.py`) uploads opaque-named clips into the built app and checks whether linked clips belong together: 10 s OpenMIC full-mix songs by FMA genre, and NSynth single notes by instrument family. The link policy was chosen on separate tuning clips (OpenMIC train partition; NSynth instruments not in the test set) and fixed before the test clips were scored.

| Test set (150 clips each) | Links before → after | Right genre / family before → after | Random pair |
|---|---|---|---|
| Songs | 494 → 306 | 9% → 38% (sound-alike links alone 44%) | 9% |
| Instrument notes | 14 → 152 | 21% → 94% (same instrument 89%) | 13% |

Before, song links were tempo and key coincidences (no better than random); notes were barely linked. Fingerprint-only scoring of all test clips gives 50% (songs, 298 clips) and 97% (notes, 270 clips).

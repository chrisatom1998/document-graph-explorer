# Automatic audio relationships

Audio analysis, saved corrections, imports, and session restoration refresh the same derived relationships. Existing document connections and authored relationships are preserved.

- **Tempo:** estimates with confidence at least 0.5, within 3 BPM or 4%. Half/double-time pulse rates use the same tolerance at the faster rate, are explicitly labeled, and receive 25% less weight. Missing/invalid BPM and confidence do not match.
- **Key:** strength at least 0.6; same, relative major/minor, and adjacent circle-of-fifths keys. A detected single pitch is not a key.
- **Instruments:** current reviewed source evidence takes precedence, including empty corrections and latest Reject/Unsure decisions. Otherwise the existing reliable-instrument policy applies. Filename/folder clues are fallback hints only, labeled as unverified and limited to 0.45 weight. They cannot replace reliable audio instrumentation.
- **Sound properties:** shared reviewed production/effect or character labels. Raw model rankings, uncalibrated scores, and AI suggestions do not qualify. The shared review projection handles aliases and latest-decision precedence.

Tempo/key filename tags retain their existing precedence over estimates but use strength 0.65 and disclose their origin. Original measurements are never overwritten. Edge weights represent match strength, not probabilities. Similarity does not establish shared samples, influence, or mix quality.

## Graph size and performance

Each audio node has at most **8 distinct automatic audio neighbors** and **4 edges per relationship type**. Limits apply to both endpoints. Existing document/title/authored relationships are outside these limits.

Feature buckets propose at most 128 candidates per node, using local deterministic neighborhoods in large buckets. Candidate pairs are ranked by strongest evidence plus a small multiple-feature bonus. Selection is deliberately approximate for large packs, not an exhaustive nearest-neighbor search. Unknown values never create buckets. Evidence is projected once per node per rebuild.

Run `./node_modules/.bin/vite-node scripts/bench-music-links.mjs` for a reproducible 100/1,000/5,000-node benchmark. The October 4 implementation run on Chris's Mac measured 12/113/544 ms, with 787/7,966/39,861 typed edges and a maximum of 8 neighbors. Timing varies with evidence and hardware.

The existing connection panel exposes reasons, provenance, and strength; Filters includes **sound properties**. Imported graphs remain temporary: export corrections to retain them. Local collections retain their existing session persistence.

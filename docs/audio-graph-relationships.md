# Automatic audio relationships

Audio analysis, saved corrections, imports, and session restoration refresh the same derived relationships. Existing document connections and authored relationships are preserved.

- **Tempo:** at least two seconds of recorded and analyzed audio, confidence at least 0.5, within 3 BPM or 4%. Half/double-time pulse rates use the same tolerance at the faster rate, are explicitly labeled, and receive 25% less weight. Related pulse rates do not establish the same rhythm. Missing/invalid BPM and confidence do not match.
- **Key:** at least three seconds of recorded and analyzed audio, strength at least 0.6; same, relative major/minor, and adjacent circle-of-fifths keys. The explanation identifies a harmonic relation, which does not establish similar sound or mix quality. A detected single pitch is not a key.
- **Instruments:** current reviewed source evidence takes precedence, including empty corrections and latest Reject/Unsure decisions. Otherwise the existing reliable-instrument policy applies, followed by the sources displayed in Sounds / Other model guesses. Every shared label discloses both origins. Filename/folder clues are fallback hints only, labeled as unverified and limited to 0.45 weight. They cannot replace reliable audio instrumentation.
- **Sound properties:** shared production/effect or character labels from the same reviewed display projection. Confirmed labels count most strongly (0.85); tested likely estimates use 0.7; maybe/possible estimates 0.55; filename clues 0.45; untested guesses and uncalibrated catalog similarity 0.4. Weights describe provenance, not detector probabilities. AI suggestions alone do not qualify. Aliases and latest review decisions remain authoritative.
- **Audio fingerprints:** finite, nonzero 512-dimensional CLAP vectors are normalized on a temporary copy. A cosine floor of 0.7 proposes candidates. A retained fingerprint edge must be within 0.03 of each endpoint's best candidate and in at least one endpoint's closest three. Label buckets cannot bypass this selection. The reason explicitly distinguishes model similarity from a listening judgment and exact duplicate proof.

Tempo/key filename tags retain their existing precedence over estimates when duration supports those features, use strength 0.65, and disclose their origin. One-shots of at most 2.25 seconds cannot inherit BPM tags; clips under three seconds cannot inherit a major/minor key. Supported measured short rhythms remain eligible. Original measurements are never overwritten.

A weak generic overlap (for example, synthesizer, warm, or bright) alone does not produce an instrument/property edge. It requires a stronger or more specific shared label, a supported tempo relation, or a retained fingerprint neighbor. If fingerprint selection excludes the pair, its generic clues are reconsidered. Unknown evidence is never treated as negative, and similarity does not establish shared samples or influence.

## Graph size and performance

Each audio node has at most **8 distinct automatic audio neighbors** and **4 edges per relationship type**. Limits apply to both endpoints. Existing document/title/authored relationships are outside these limits.

Feature buckets propose at most 128 candidates per node, using local deterministic neighborhoods in large buckets, plus up to three nearest fingerprint candidates. Exhaustive fingerprint search runs only with at most 1,000 valid fingerprints; above that limit fingerprint ranks are approximate within the bounded feature candidates. Candidate pairs are ranked by strength, shared-label specificity within the collection, and small bonuses for additional labels/independent relationship types. Harmonic key compatibility does not receive the similarity corroboration bonus. These selection scores do not change the edge's reported provenance strength. Unknown values never create buckets. Evidence is projected once per node per rebuild.

Run `./node_modules/.bin/vite-node scripts/bench-music-links.mjs` for a reproducible 100/1,000/5,000-node benchmark. The October 4 implementation run on Chris's Mac measured 12/113/544 ms, with 787/7,966/39,861 typed edges and a maximum of 8 neighbors. Timing varies with evidence and hardware.

The existing connection panel exposes reasons, provenance, and strength; Filters includes **sound properties**. Imported graphs remain temporary: export corrections to retain them. Local collections retain their existing session persistence.

## Evaluating real fixtures

`vite-node scripts/evaluate-music-links.mjs <features-with-annotations.json> <output-directory> [baseline-musicLinks.ts]` evaluates existing licensed cached CLAP features and the current shipped short-clip detector heads. Each feature row needs `id`, `seconds`, the model input blocks, and an `annotation` record with rights, original/family groups, split, and reviews. It generates before/after density, timing and degree counts, annotated same-category/confusing-category examples, and a small isolated browser fixture. It performs no inference, training, downloads, or writes to the source dataset.

Source/role annotations are not pair-similarity judgments, and unknown labels are not negatives. Without reviewed pair labels, precision and recall remain unavailable. Same-category examples, reduced density, and synthetic policy tests do not prove listening accuracy. Available calibration data must be reported as development evidence, with correlation and provenance limits stated.

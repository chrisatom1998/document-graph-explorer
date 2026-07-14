# Bundled OCR runtime

These files keep scanned-PDF recognition local and available in normal,
offline, and air-gapped builds. Runtime code uses only these same-origin paths:

- `worker.min.js` — Tesseract.js 7.0.0 browser worker
- `core/` — the LSTM WebAssembly wrappers selected by Tesseract.js feature detection
- `lang/eng.traineddata.gz` — English LSTM language data

The worker and core files come from the matching `tesseract.js` and
`tesseract.js-core` npm packages. The English data is from
`@tesseract.js-data/eng`'s `4.0.0_best_int` model. Keep all three versions in
sync when upgrading; `scripts/verify-runtime-assets.mjs` rejects incomplete
release output.

Tesseract.js, its core runtime, and the language data are Apache-2.0 licensed.
The copied worker license notice and core license are retained alongside the
assets.

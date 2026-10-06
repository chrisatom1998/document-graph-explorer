# Sound Label Studio

Run `npm run review:sounds` from the project root and open http://127.0.0.1:8766/.
The existing DGE pack finder also links to this reviewer.

1. Add clips or a folder. Supported audio files are processed sequentially, locally; a failed file does not discard the rest of the folder.
2. Play the displayed excerpt. Browse every category in the live DJ catalog, search aliases, or filter by family. Selected labels remain visible.
3. Check labels that are present. Use Absent for a checked negative example and Unsure for an unresolved label. Untouched labels are unknown. Set aside an entire clip when it needs another listen.
4. Verify the clip to save the review and run the existing DGE learning pipeline. Model estimates remain drafts until explicit human confirmation.
5. Export the training dataset, or export the existing DGE collection format.

## Label scope and training

The full catalog is offered, including custom categories; no five-category shortlist is imposed. Availability does not establish detector accuracy. The existing per-category training gates still require independent positives and negatives before enabling a classifier.

New reviews include `knownLabels` containing only present labels and explicitly absent labels. Unsure and unreviewed labels are excluded from that assessment mask. Existing saved review masks are preserved on import. Reconfirming a clip records the newly explicit review scope. API requests without a mask now default to selected positive labels, rather than silently treating every unselected category as absent.

`dge-sound-training.json` uses schema `dge-sound-training-v1`: full catalog, explicitly confirmed examples, present labels, assessed-label mask, absent/uncertain label lists, excerpt start/duration, model embeddings, recording group, pack provenance, and review timestamp. Drafts, assistant reviews, and set-aside clips are excluded. Keep excerpts from one recording and related sample-pack families together when assigning training/test splits. The export does not assign or claim a validated split.

New uploads measure duration, RMS dBFS, peak dBFS, and zero-crossing rate on the decoded mono excerpt supplied to the classifier. These are signal measurements, not proof of instrument identity. Older entries may only have duration; missing measurements are displayed as unavailable. Sample mode reviews the first ten seconds, and song mode reviews up to twelve excerpts, rather than claiming exhaustive coverage.

## Verification

`node scripts/test-dj-review-ui.mjs` covers full-catalog browsing, filters, explicit negatives/unknowns, export eligibility, review queues, folder error recovery, save/apply failures, and external review refresh.

`python3 scripts/test-dj-review-server.py` uses isolated temporary data and real synthetic audio inference to check API validation, scoped review persistence, measured properties, and upload handling. It needs permission to bind a localhost port.

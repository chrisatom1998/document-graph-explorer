# DJ sound tags

The classifier combines the existing AudioSet, MTG-Jamendo and music/speech CLAP models. Source, production type and character are separate tags. The main Sound field stays compact; Explanations shows the groups. Model comparisons contains model guesses rather than additional confirmed sounds.

Supported production types: vocal chops, vocal phrase, vocal breath, synth pluck, atmospheric pad, synth stab, synth lead, synth bass, vocal-like synth, riser, downlifter, impact, whoosh, drum loop, percussion hit and texture. This is a vocabulary of estimates, not guaranteed identification of every DJ sound. Breath descriptions compete with synthetic noise, hi-hats, flute, breathy synth and whisper alternatives. A breath requires at least 0.45 similarity and a lead over alternatives; other production types require 0.35. Similarities are not probabilities.

Full mode runs CLAP over overlapping ten-second windows at five-second intervals, including the tail. Fast retains its one centered CLAP section. Full therefore takes longer on long recordings. Accepted local tags keep up to three window ranges so short occurrences are not erased by the whole-track average. These ranges indicate analyzed windows, not precise event boundaries. Description aggregation uses bounded memory. Silence and weak or tied matches remain unclassified.

The quantized text encoder encodes new descriptions individually to avoid batch-dependent changes. The original source and character descriptions retain their previous encoding. No audio is sent to a service, and no new large model is downloaded.

## Review and evaluation

Open Track actions → Correct DJ tags to save source, production and character labels. These stay separate from predictions and survive reanalysis. A completely empty review means no supported labels, rather than an unreviewed track. Existing instrument corrections still control instrument relationships; DJ reviews are available for evaluation and do not silently become audio detections or new graph edges.

Export the collection as JSON. Run `node scripts/evaluate-dj-tags.mjs collection.json` to compare its reviewed tags against automatic tags, reporting extra/missed labels and per-group precision/recall. Use separate development and held-out collections; start with 10–20 reviewed examples per category, including confusing negatives and actual mixtures. Missing predictions count as missed labels. This workflow prepares a labeled evaluation set; the app does not automatically train a new classifier from corrections. Training a small classifier on CLAP embeddings is a later step that needs sufficient reviewed data.

## Initial validation

The three supplied `Vocal_BreathFemale`, `Vocal_BreathFemale2` and `Vocal_Breath` recordings were tested under anonymous names through the browser decoder and all models. Their accepted breath similarities were approximately 0.478, 0.554 and 0.568; a synthetic white-noise control retained noise and received no breath tag. Existing chop recognition was retained. These are a small same-pack regression set, not a general accuracy benchmark for all 16 production categories. Unit tests additionally cover confusing negatives, weak/tied matches, short-event retention, saved corrections, model attribution and Full versus Fast scan behavior.

## Expanded catalog

See [DJ sound category catalog](dj-sound-catalog.md) for the 192-category vocabulary, per-category descriptions, recognition limitations and evaluation workflow. Categories are defined once in `src/audio/djCatalog.json`; the correction UI, validators and prompt generation share it. The earlier same-pack breath validation above applies to the original breath prompts, not the full expanded vocabulary.

## Learn from your reviewed sounds

Verified examples now also train one balanced logistic classifier per category on frozen CLAP features. Only explicit reviews are used; filename hints never become training targets. Each category needs at least six independent positive and six independent negative sound families. Two families from each class are held out before fitting; at least four per class must remain for training. Related filenames and near-duplicate vectors stay together. These automatic groups reduce leakage but cannot guarantee independence between sample packs.

The head uses a fixed 0.70 score threshold and is enabled only with at least 80% precision and 50% recall on this provisional test. Test clips are never used to fit that head. This small test is a readiness check, not evidence that the head improves over the base classifier; repeated review cycles can also adapt to the test set. A larger external test set is still needed for an accuracy claim. Nearest-example matching separately keeps all reviewed examples and wins when it has direct evidence. Heads add positive classifications only. All learned results currently use the **Reviewed examples** attribution.

Each publication saves `classifier-report.json` beside the update log, includes the report in `result.json`, and displays readiness and per-category test results in the review tool. Categories with insufficient data or failed checks retain the existing recognition. Add further varied reviewed examples and verify again to retrain automatically.

Run `npm run review:sounds` and open `http://127.0.0.1:8766/`.

1. Add WAV, MP3, OGG, FLAC, AIFF or M4A files (up to 100 MB each). The service decodes and analyzes the first ten seconds locally.
2. Create a category with a group, name and audible description. New categories remain drafts until applied.
3. Listen and click **Verify and teach Document Graph Explorer**. Each verification saves the labels and automatically publishes the recognition update. Only explicit confirmations are used for learning; filename hints are excluded. Editing a review removes its confirmation; verify again to publish the correction.
4. Wait for **Verification applied to the recognition model**. The **Apply to Document Graph Explorer** button remains available for retries and publishing categories separately. New category descriptions are encoded with the matching CLAP text encoder. Reviewed audio features form a conservative exemplar classifier. The app's source assets and local web build are updated, with backups and rollback on build failure.
5. Reload the local app and reanalyze audio. Separately packaged desktop copies require their normal rebuild.

This learns an additional recognition layer rather than fine-tuning CLAP's base weights. A matching positive example needs cosine similarity at least 0.88 and a 0.04 lead over reviewed negatives. A negative can suppress a category at 0.94 similarity with the same margin. Contradictory or distant examples abstain. These are provisional gates, not measured general accuracy. Category snapshots prevent older reviews from implicitly rejecting categories added later. Model results are attributed to **Reviewed examples** and persist in collection exports.

The local service accepts writes only from its own origin with a session token. It uses server-owned audio embeddings rather than trusting client-supplied training vectors. The public `sound-model/learned.json` asset contains reviewed embeddings and labels; include it only in app builds where those derived data are appropriate to distribute. Raw audio is not bundled by Apply.

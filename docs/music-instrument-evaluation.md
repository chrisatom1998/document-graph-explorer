# Instrument detection: targeted validation, 2026-10-02

This is a chronological development record. The current implementation is described in **Three-model sound identification, revision 6** below; earlier sections document superseded behavior and earlier checks.

The improved pipeline retains the bundled quantized AudioSet AST model. It changes how audio reaches the model, how much of each recording is heard, how instrument labels are retained, and what evidence can create a graph relationship.

## Changes

- Instrument analysis covers the recording in overlapping 10-second windows. Tempo/key still use bounded excerpts. Decode batches hold at most 65 seconds of mono PCM, and FFmpeg resamples to 16 kHz for the instrument model.
- Specific AudioSet instrument labels replace pooled families. The display no longer limits results to eight instruments. Strong specific detections supersede redundant parent families.
- A single score at least 0.85 or at least two scores at least 0.60 from windows beginning five seconds apart qualifies as likely. Weaker supported detections remain possible. These are heuristic thresholds; overlapping observations are correlated and scores are not calibrated probabilities.
- Only specific likely instruments create automatic instrument edges. Possible instruments and broad families do not. Old version 1 scans require reanalysis to participate in the new instrument matching rule.
- Results retain up to five strongest timestamped passages per instrument. The player provides a Listen at button, and reports complete versus partial scan coverage.

## Same-recording browser comparison

Both pipelines ran locally in Chrome using the same model weights. A 50-second test recording contained trumpet in seconds 0–10 and 40–50, and piano in seconds 10–40. This deliberately tests instrumentation outside the original center excerpt.

| Recording | Previous result | Improved result |
| --- | --- | --- |
| Solo trumpet, about 5.33 seconds | Broad brass family, score 0.805 | Specific trumpet, likely, score 0.852 |
| Piano and trumpet sequence, 50 seconds | Piano only, score 0.472 | Trumpet likely, score 0.922; piano possible, score 0.642 |

The new sequence scan covered all 50 seconds in nine windows, taking 78.9 seconds on the test machine. The original excerpt scan took 9.2 seconds. The new solo scan took 10.8 seconds versus 8.8 seconds previously. These are single-run observations, not portable performance guarantees.

This confirms recovery of an instrument missed by excerpt selection and more specific labeling on these examples. It does **not** establish a dataset-wide precision/recall improvement. In particular, the known piano remains possible under the stricter rule; exhaustive identification is not achieved.

## Sources and limitations

The evaluation clips come from [librosa's published examples](https://raw.githubusercontent.com/librosa/librosa/main/librosa/util/example_data/index.json):

- [Solo trumpet 06](https://freesound.org/s/77711/), Mihai Sorohan, CC BY 4.0.
- [Pistachio Ice Cream Ragtime](https://freesound.org/people/lena_orsa/sounds/442789/), Lena Orsa, CC BY-NC 4.0.

Recordings are local evaluation inputs, not bundled with the product. Attribution and raw comparison results are retained in the ignored local `artifacts/music-evaluation` directory.

The [AST model](https://huggingface.co/MIT/ast-finetuned-audioset-10-10-0.4593) is trained on AudioSet classes. It cannot name instruments outside that vocabulary or guarantee separation of instruments hidden in a mix. Alternatives such as [Essentia's music instrument models](https://essentia.upf.edu/models.html) need a separate representative evaluation before any claim that a replacement improves this product. A useful next evaluation would measure per-instrument precision and recall on independently labeled polyphonic recordings, including quiet and short entrances.

## Validation completed

- 184 test files passed: 1,225 tests passed and one skipped. Regression coverage includes full-track window coverage, intermittent instruments, conservative linking, instrument specificity, timestamp persistence, and more than eight instrument results.
- Type checking, lint, production build, air-gapped build, runtime checksums, and bundle budgets passed.
- A real Chrome interface check passed import, timestamp playback, saved/reopened version 2 estimates, cancellation, and successful analysis after cancellation. No page errors were recorded.

## Dominant weak candidates in short synth loops

The user-supplied `SHADOW_UK1_Melodic_Loop_Action_Dm_140.wav` is a 6.857-second, stereo, 24-bit PCM recording. The unchanged AST model ranks synthesizer first (0.1152), followed by sampler (0.0207); its Music score is 0.6086. Previously every instrument was hidden because none met the 0.35 evidence intake threshold.

Instrument scan revision 2 retains the existing likely/possible thresholds, and adds one fallback only when those rules produce no displayed instruments: the Music score must be at least 0.5, the leading instrument score at least 0.1, and that score at least three times the runner-up (including broad families). A broad family cannot itself become this suggestion. The strongest qualifying passage is shown as a **low-confidence suggestion**, with a playback timestamp. Repetition cannot promote it to likely, and it never creates automatic instrument relationships. The interface displays suggestions directly when there are no likely instruments.

This changes candidate visibility, not the model weights or the accuracy of its predictions. The scores and thresholds are heuristic, not calibrated probabilities. The single supplied example does not establish recall or precision across other synths, instruments, or recordings. Old complete scans are eligible for reanalysis on a new import because their scan revision predates this rule.

## Short-clip tempo analysis

Tempo revision 1 removes the eight-second exclusion: clips from two to eight seconds first require at least three detected onsets, then use Essentia's loop estimator (Percival estimate with a 0.95 loop-fit threshold). A fragment that does not fit a loop can fall back to the existing beat tracker with at least four ticks and its existing confidence requirement. Short-clip confidence is capped at 0.75; this is a heuristic score, not a calibrated probability. The longer-recording path retains its existing thresholds.

The three user-supplied Action, Action2, and Ah loops are each about 6.857 seconds long. The loop estimator reads their pulse at 70 BPM, corresponding to half time relative to the 140 BPM filenames. Short-clip results explicitly show valid half/double-time alternatives; only the primary estimate determines automatic tempo links. No filename BPM or repeated copies of the input are used. Previously completed analyses become eligible for reanalysis after this tempo revision.

## Audio-only fallback for sparse tonal loops

Key revision 2 leaves the existing full-key confidence gate intact and adds a separate detected-pitch result when a full key is unavailable. YIN measures fundamentals in up to 96 bounded 4096-sample frames; frames must have audible energy, pitch confidence of at least 0.85, and tuning within 35 cents of a note. At least eight frames, 35% frame coverage, and 80% agreement among voiced frames are required. Pitch hints across excerpts require majority agreement. These thresholds are heuristics, not calibrated probabilities.

For Action2, the original spectrum guard found too little pitch diversity. Direct fundamental tracking finds repeated D notes across octaves. This supports displaying "D — full key undetermined", not asserting D major or D minor. Profiles disagree on its mode, and a repeated note can belong to many keys. Pitch-only results do not create confirmed-key relationships.

No filename parsing participates in the analysis. The briefly explored filename-tag fallback was removed before delivery; previously persisted filename-derived keys are discarded by the import sanitizer. File names remain necessary only for container decoding and display. The saved key-analysis revision ensures older results are eligible for reanalysis.

A pure A-tone control exposed a false A-minor result in the earlier spectral-profile path. Short clips now check fundamentals before accepting a full key: strong agreement (at least 0.9) on a repeated pitch suppresses an unsupported mode estimate. This deliberately favors a pitch-only result for short monophonic loops.

Final browser validation imported identical Action2 audio as `anonymous.wav` and `wrong_F#major.wav`. Both produced D pitch confidence 0.921584, a 70 BPM estimate with 140 BPM alternative, and no full key. The interface displayed the pitch-only result; it survived save/reload, and neither track created a key relationship. Silence and seeded noise produced no pitch or key; a pure 440 Hz tone produced A pitch without a major/minor key. No browser page errors were recorded. The current suite passes 1,251 tests across 186 files (one skipped); lint, type checking, production build, runtime asset verification, and bundle budgets pass. These checks used an isolated browser because inspection of the user's existing preview tab timed out.

## Synth fallback and explicit corrections

Instrument revision 3 adds a local CLAP audio encoder only when the existing detector returns no instruments. It compares up to three 10-second excerpts at 48 kHz with fixed description vectors. The audio encoder adds approximately 34 MB; the text encoder is used only by `scripts/generate-sound-prompts.mjs` to generate the checked-in vectors. Model weights, configuration, and vectors have checksum verification. The fixed description set includes synth melody, bass, lead, and pad variants, acoustic instruments, and non-instrument controls. Neither path uses filename tags.

Candidates require cosine similarity of at least 0.30 and a distance from the best description of no more than 0.12; at most two distinct instruments are retained per excerpt. A leading non-instrument control suppresses suggestions. These are exploratory thresholds, not calibrated probabilities, and multiple synth descriptions can bias retrieval toward that family. Fallback results always remain possible and never create instrument links without confirmation. This is not a general guarantee of synth recognition.

All three supplied real WAVs were imported with anonymous filenames in Chrome:

| Clip | Browser result |
| --- | --- |
| Action | Existing AST synthesizer suggestion, score 0.1152 |
| Action2 | CLAP synthesizer suggestion, cosine 0.3378 |
| Ah | CLAP trumpet 0.4398 and synthesizer 0.3416, both possible |

Ah remains acoustically ambiguous. Repeating these clips to fill the original AST model's listening window did not reliably resolve their labels and was not shipped. The separate CLAP evaluation on known trumpet, piano, and drum reference recordings did not retain synthesizer under the fallback thresholds, but this small targeted evaluation does not measure broad precision or recall.

The user's assertion that all three are synthesizers can now be saved explicitly using **Correct the instrument**. Corrections are stored separately from automatic estimates, supersede them for display and relationships, survive reanalysis, and can be removed with **Use automatic estimates**. Browser verification confirmed bulk correction creates three instrument links, survives reload, and resetting one track leaves only the relationship between the two confirmed tracks. No browser errors occurred. Validation: 1,256 tests pass across 187 files (one skipped), plus lint, type checking, production build, model asset checks, and bundle budgets.

## Automatic instrument classification, revision 4

Revision 4 runs the description classifier whenever AST supplies no likely instrument, including when AST supplies only a weak suggestion. Source-specific descriptions distinguish acoustic trumpet notes from synthesized horn sounds, rather than using a generic trumpet description that matches both. Synth descriptions cover melodic, bass, lead, pad, brass, horn, and wobbling sounds. No filenames or per-file corrections participate in this classification, and no model weights were fine-tuned. A music-trained alternative checkpoint was evaluated but not shipped because it degraded other examples.

The app saves an automatic primary prediction when more than half the sampled passages agree. The UI labels it **Estimated instrument** and shows uncertainty when its cosine margin over a different class is below 0.025. Similarity and margin are not calibrated probabilities. Other candidates remain in a disclosure, and this primary prediction alone does not qualify as strong evidence for an instrument edge.

In the local source-description evaluation, Action, Action2, and Ah all rank synthesizer first; Ah has only a 0.0147 cosine margin over acoustic trumpet. The known acoustic trumpet reference still ranks trumpet first. An additional 13 loops from the sample folder were checked: five ranked synthesizer first above the minimum score, while the others remained below threshold or matched other sounds. This documents limits of generalization rather than a claim that every future synth will be recognized. These additional loops do not have independently verified instrument annotations.


## 2026-10-02: MTG-Jamendo and the complete 16-file batch

The 16 supplied Shadow melodic WAVs were imported with anonymous names: all completed AST/CLAP analysis. The previous automatic label identified synthesizer on 8/16. Raw MTG-Jamendo/Discogs-EffNet ranked synth first on 13/16 and second behind the role tag bass on two more. With the explicit specific-instrument filter and fixed 0.30 threshold, 15/16 yield a synth candidate. Floot remains unresolved. These are same-pack, user-labeled synth clips, not a general accuracy benchmark.

Native and browser inference agree to 0.0001 across these files and three controls. Production-style bounded excerpts preserve the 15/16 outcome. Jamendo alone fails the acoustic trumpet control; retain strong AST detections and use Jamendo as a second detector. Full import checks on Closer, Dop and trumpet exercise this routing. No filename reaches a sound model. The new automatic label records MTG-Jamendo provenance and remains separate from confirmed instrumentation.

Separate filename/folder parsing reads 16/16 key tags and 13/13 available BPM tags; the UI and edges explicitly distinguish name clues from audio inference. The original sound-only key audit found six matches, five disagreements, five undetermined; BPM found four direct matches, six half/double-time equivalents, three disagreements. A name match must not be counted as independent acoustic accuracy.

Reproduce native evaluation: `node scripts/evaluate-jamendo.cjs <folder>` with FFmpeg installed; `FFMPEG_PATH` can specify the executable. Results go to ignored `artifacts/music-evaluation/jamendo/results.json`. Official models, source notices, pinned checksums and licensing are under `public/jamendo-model`.

## Three-model sound identification, revision 6

This section supersedes the earlier CLAP fallback routing. The app now combines AudioSet AST, MTG-Jamendo/Discogs-EffNet, and LAION's **larger_clap_music_and_speech** (the Xenova ONNX export, revision `e9fd5ac1dbf3280936a7fc3ec8a020453ff184db`). The quantized CLAP audio encoder is 78,155,433 bytes. Its matching text encoder generates 53 fixed vectors offline; no text encoder is loaded in the app. A separate browser cache namespace prevents old small-CLAP weights/configuration being paired with the new vectors.

AST still scans the whole track. Jamendo and CLAP each analyze up to three bounded excerpts regardless of whether AST found a likely instrument. The fusion rule prefers a specific likely AST result, then a substantial AST candidate (at least 0.55) when CLAP clearly agrees (at least 0.35, lead of at least 0.025), then a qualifying Jamendo instrument. This additional agreement changes the primary estimate, not AST's likely/possible status or graph-link eligibility. Disagreement remains visible. Raw scores from these differently trained models are never averaged together as confidence.

CLAP now describes separate axes: source resemblance, articulation, tonal character, space, and production role. A synth can be displayed as the source while the resemblance is trumpet and the suggested role is pad. A CLAP instrument resemblance alone cannot establish the physical instrument. Non-instrument source estimates require a higher, clear lead. Unresolved axes are displayed as undetermined. Explicit user corrections and name/folder clues retain their existing precedence and attribution.

This implements an ensemble of pretrained models, not a newly trained checkpoint. The description thresholds are exploratory heuristics. Role depends on arrangement context, so labels for isolated loops are suggestions. The system cannot identify an exact synthesizer or preset, distinguish every synthesized imitation from an acoustic instrument, or guarantee exhaustive instrumentation.

The companion chat also recommended Qwen2-Audio-7B-Instruct. Its published weights are about 16.8 GB, and the current client has no compatible inference service. It is not bundled or silently called remotely. All shipped inference stays on the user's device. This work does not change the tempo/key algorithms.

### Evaluation protocol

The reference set is the 16 user-supplied Shadow melodic loops plus the existing trumpet, piano and drums controls. User-provided synth labels supply the reference for the 16 loops; they are not independent annotations. Model requests contain only decoded audio, and the end-to-end uploads use anonymous names. These same-pack samples informed development, so results are a targeted regression check rather than a held-out accuracy estimate.

The music CLAP encoder was evaluated in both native ONNX and Chrome/WASM using the same first ten seconds, matching preprocessing and fixed vectors. Maximum cosine difference across 779 scores was 0.008022. Character selections matched on all 19 clips; the role decision changed for Bleacher near its decision margin. These engines are not numerically identical, and browser outputs are authoritative for this app. Native AST also put the trumpet control at 0.84980; the browser component run yielded 0.84688 and the full upload path yielded 0.85171, straddling the old likely threshold. The component harness uses native FFmpeg PCM while the full upload uses the app decoder. The agreement rule avoids relying solely on that boundary when CLAP supports the same substantial AST candidate.

Local raw scores, model manifests, browser outputs and end-to-end results are retained under the ignored `artifacts/music-evaluation/ensemble/` directory. The previous small CLAP model is retained there for comparison. No supplied recordings or evaluation controls are distributed with the application.

### Completed revision 6 checks

The 19-file browser component comparison retained synthesizer on 15/16 supplied synth loops and left Floot's source undetermined. Trumpet, piano and drum-kit controls retained the correct source labels. The component comparison combines full-track browser AST, previously browser-verified bounded Jamendo scores, and first-ten-second browser CLAP descriptions. It is not an all-file end-to-end upload test. The synth-source count is unchanged from Jamendo alone; music CLAP adds descriptions and corroboration rather than a demonstrated improvement in this batch's instrument recall. Role suggestions remain fallible: the drum reference receives an unhelpful bass-role suggestion despite its correct drum-kit source.

Four anonymous end-to-end uploads (Action, Doomed, Floot and trumpet) additionally exercised the full three-excerpt CLAP path, complete model status, the combined details panel, and saving/reopening the sound profiles. All passed, with no page errors. An intentionally invalid prior-generation CLAP cache did not prevent the new model loading. These checks ran in an isolated Chrome context, not the user's open collection.

Validation passed: 1,289 tests across 191 files (one skipped), lint, type checking, production build, model/runtime checksum verification and bundle limits (88.1 kB eager entry). The shared web/desktop client code is updated; no packaged desktop installer was rebuilt or installed in this run.

## Early estimates and Fast/Full analysis

Full remains the default and retains the same instrument windows, tempo/key algorithms, model weights and fusion thresholds. The first Jamendo excerpt runs before the expensive instrument scan and publishes a `stage: preview` result. That excerpt's scores are cached for reuse in the final fusion; previews do not add a model inference. Final results have no preview stage. Completed older results remain displayed during reanalysis. Previews that survive cancellation/reopening remain explicitly unfinished and eligible for retry; they cannot supply strong instrument links.

Fast is an explicit, persisted preference in Settings and the track panel. It uses all three models. AST checks at most three non-overlapping ten-second sections (one centered section below 20 seconds, two endpoints below 30 seconds, three sections for longer tracks). Jamendo and CLAP each check one centered excerpt. Tempo/key estimation is unchanged. Without reliable container duration, Full is used to discover the recording's end. Fast can miss transient instrumentation; a completed Fast scan records its actual sampled seconds, not full-track coverage. `instrumentScan.complete` means the selected plan completed; `instrumentScan.mode` distinguishes Fast from Full, with missing mode interpreted as legacy Full. Existing Full results remain valid; choosing Full makes stored Fast results eligible for upgrade on import or reanalysis.

Automated coverage checks early publication, reuse of the first inference, bounded Fast windows, retained Full coverage, cancellation, failed models, stored preview/mode validation, retained completed results, and Fast-to-Full upgrades.

The bundled WASM ffprobe writes valid duration JSON while returning -1 for the tested WAV. Duration detection now validates that JSON independently of the status code. Missing or invalid metadata still uses discovery mode, and the 24-hour limit still applies. This enables bounded Fast sampling and restores the intended distributed tempo/key excerpts for recordings longer than 60 seconds; previously unknown duration selected the first excerpt only.

### Browser speed validation

On the supplied 12-second Doomed loop uploaded as `sample.wav`, the initial estimate appeared after 1.75 seconds and Full completed after 25.42 seconds. A separate sequential run with loaded models measured Full at 19.90 seconds and Fast at 9.55 seconds (about 52% less time); both previews appeared after 0.49 seconds. These are single-device, single-clip observations, not a general speed guarantee. Fast checked one ten-second section; Full checked both overlapping sections covering all twelve seconds. Both retained synthesizer, sustained character, and the pad-role suggestion. Full's tempo, key, instrument scores and sound profile exactly matched the previous ensemble upload result. This preserves the existing estimates, not proof that all are musically correct.

The isolated browser test also passed saving/reloading the Fast result and preference, early estimate display, explicit sampled coverage, cancellation, and zero page errors. Validation: 1,306 tests passed across 194 files (one skipped), lint, typecheck, production build, runtime/model checksums and bundle budget (88.3 kB entry). Shared client code is updated; no desktop package was rebuilt or installed. Local raw timing and browser results are under ignored `artifacts/music-evaluation/speed/`.


## Voice recognition (revision 7)

The bundled MTG-Jamendo model already includes voice, but the prior instrument whitelist discarded it. Voice now survives with a conservative 0.50 score threshold (other specific instruments retain 0.30). AudioSet Speech, Singing, Choir, Rapping and Humming map to a single voice label using the maximum score, never a sum of correlated classes. Speech synthesizer is deliberately excluded. Existing strong/repeated AST evidence rules apply to voice relationships.

Voice is also retained as a co-occurring source when another instrument wins the primary ranking. Filename instrument clues can coexist with detected voice; explicit user corrections still take precedence. Six new offline CLAP prompts compare vocal chops, singing, speech and choir against synthetic-voice and instrumental alternatives. A style is shown when voice has been identified and the style clears the existing descriptive score/margin thresholds. A strong CLAP vocal-style match (at least 0.35 similarity and 0.10 lead over every vocal and non-vocal alternative) can separately suggest processed voice alongside the primary instrument. This alone never creates voice graph links. These are exploratory estimates, not a trained vocal-chop classifier or proof of human origin. No additional model weights or remote audio uploads are required. Existing analyses must be reanalyzed to receive revision 7 results.

Six anonymous browser/WASM evaluations used the app decoder and all three model paths. `Vocal_Badboysound` was identified as voice by AST (0.927). `CHOP 1` was missed by AST/Jamendo but received a CLAP vocal-chop similarity of 0.371 with a 0.167 lead over the synthetic-voice alternative; final fusion therefore shows a separate, uncorroborated voice estimate alongside Jamendo's synthesizer estimate. `Vocal_AY_D_140` remains unresolved as voice (best vocal similarity 0.209). User-labeled synth controls Ah, Doomed and Floot received no voice tag. These six same-pack examples are a limited regression check, not a general voice-accuracy benchmark. No filenames or folders were passed to the models. Raw inference results and final fusion results are under ignored `artifacts/music-evaluation/voice/`.

The browser also verified sanitized/save-compatible voice profiles, the existing Instrument field displaying `synthesizer, voice`, the collapsed explanations/model comparisons, and a narrow panel without horizontal overflow. Tests cover voice aggregation across AST classes, Jamendo voice filtering, ambiguous CLAP abstention, user-correction precedence and strong-voice graph relationships.


## Vocal-chop primary label (revision 8)

CHOP 5 exposed a second issue: the original long vocal prompt scored only 0.253 in the browser, below the voice threshold, while Jamendo supplied a weak synthesizer guess (0.396). A separate sample-comparison axis now contrasts “A vocal chop loop.” with synthesizer, drum-machine, chopped guitar, chopped piano and synthetic-vowel alternatives. It requires similarity at least 0.35 and a lead of at least 0.05 within that axis. This is a targeted CLAP prompt/decision update, not weight training. No sample names, identifiers or audio fingerprints are used by the rule.

A clear vocal-chop result replaces the primary synthesizer guess only when it is uncorroborated, below 0.60, and no reliable/independently supported AST instrument won. Conflicting model candidates remain in Model comparisons. The main Instrument field renders the voice subtype as “vocal chops”; reliable co-occurring instruments remain visible. Voice graph evidence is unchanged, so CLAP resemblance alone cannot create automatic instrument links.

Browser comparisons used anonymous audio from CHOP 5, CHOP 1, CHOP 2, Ah, Doomed, Floot, Action2, piano and drums. With stable per-prompt text encoding, CHOP 5 scored 0.456 versus 0.301 for its nearest non-vocal sample alternative; CHOP 1 scored 0.463 versus 0.299. CHOP 2 also clears the gate at 0.361 versus 0.298. None of the six instrumental controls qualifies as a vocal chop. These are targeted regression checks, not a general accuracy benchmark. The native prompt exploration also checked the original 16 synth loops and three acoustic controls.

The quantized text encoder produced different vectors when new prompts changed the batch/padding shape. The original 47 descriptions retain their legacy batching; the six new sample comparisons are encoded individually so unrelated additions cannot change their vectors. Final validation uses the shipped vectors, not the exploratory prompt batch.

## Avoiding false multi-instrument mixtures (revision 9)

The vocal-chop arbitration now applies to every competing instrument, rather than only synthesizer. When a clear vocal-chop match exists, an extra instrument needs either strong AST evidence or independent model agreement. A high Jamendo score alone is not enough to infer a second sound source. Substantial AST evidence (at least 0.55) plus a matching Jamendo result (at least 0.50) can retain a genuine accompanying instrument, including a supported runner-up. Standalone instrument recognition is unchanged when no confident vocal chop is present. Raw model candidates remain available under Model comparisons, explicitly described as individual guesses rather than extra sounds in the track.

Regression tests cover solo chops with both weak and high-scoring false drum tags, supported drums with chops, independent agreement on a runner-up instrument, standalone drums and ambiguous chop matches. This makes the decision policy more conservative; it is not retraining or automatic learning from user corrections.

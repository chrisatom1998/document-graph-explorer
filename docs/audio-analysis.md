# Audio analysis in depth

This page holds the detailed notes on how Resonance analyzes audio: which local
models run, how tempo, key, instruments and sound tags are decided, what the
thresholds mean, and where the limits are. The [README](../README.md) gives the
short version; [audio-graph-relationships.md](audio-graph-relationships.md)
covers how analysis results become graph links, and
[dj-sound-tags.md](dj-sound-tags.md) covers the DJ tag vocabulary.

Everything below runs on your device in the browser or desktop app. No audio is
uploaded for analysis.

## Adding and playing audio

Add audio with **Add files**, **Import a folder**, or drag and drop. Select a
track to play it; use **Prepare playback** for codecs your browser cannot play
directly. The bundled FFmpeg decoder runs locally in both web and desktop builds.
Supported extensions include MP3, WAV, FLAC, AIFF, Ogg, Opus, M4A, AAC, WMA,
APE, CAF, AMR and other audio containers; browser-reported `audio/*` MIME types
are also accepted. Decoder support varies: encrypted or protected, corrupt, and
some specialist codecs cannot be played. The usual limits apply: 64 MB per file
and the batch size limit.

## Relationships between tracks

Automatic links connect tracks that sound alike (sound fingerprints at least 70%
similar, checked against each track's closest-sounding tracks), naming the
tested tags they share. They also use explicit musical tags in file and folder
names when available, then audio estimates: similar tempo, the same or related
keys, and likely shared instruments. See
[audio-graph-relationships.md](audio-graph-relationships.md).

You can also link two tracks by hand from the track panel (**Connect to another
track**) with a free-text relationship such as "shared sample" or "similar
bassline". Named links appear in the graph, survive later imports, and are
included in graph exports. Graph exports contain the relationships but not the
original audio; add the originals again on another device.

Titles also create **shared title** relationships from adjacent descriptive
phrases such as "melodic loop" or "bass loop", before any audio analysis. This
works for ordinary document titles too. Case, separators and simple plurals are
normalized; generic words, key tags and numbers do not create title phrases.
Groups of up to seven are fully connected; larger groups use bounded links that
keep every member connected. Title links refresh on import, reopening and title
changes. Use the **Shared title** similarity filter or the connection details to
inspect them. Audio filenames remain excluded from content-based lexical and
semantic linking.

BPM matches allow 3 BPM or 4%, whichever is larger; key matches include
identical keys, relative major/minor, and neighbouring keys on the circle of
fifths. The strongest six neighbours per track and type are kept to limit graph
density. These connections do not establish sampling or influence.

## When analysis runs

New audio is analyzed during import, with a background status card
("Analyzing N audio files in the background") that can be minimized or stopped.
For a single track, open **Full details → Track actions** and choose **Analyze
track** or **Reanalyze**. For a whole library, **Settings → Data** offers
**Update N older tracks** and **Re-analyze all tracks**. Re-reading a folder
skips files whose name, size and date have not changed.

### Analysis mode

**Settings → Music analysis mode** has two options:

- **Full — whole track** (the stored default): scans the entire track.
- **Quick → Full in background (recommended)**: shows quick estimates first,
  then verifies the whole track in the background. The early estimate is
  labelled as unfinished and can change during verification. Quick checks at
  most three non-overlapping 10-second instrument sections and one
  music/description excerpt, so brief appearances can be missed until the full
  pass completes.

Completed results stay visible during reanalysis. Tempo and key analysis is the
same in both modes. Files with unknown duration use Full so the end can be
discovered safely.

## Model weights

The decoder runtime is staged during dev startup and builds, but the roughly
632 MB audio-model pack is optional. A clean `npm run dev` or `npm run build`
uses only the checked-in core/document pack. `npm run models:audio` downloads
and checksum-verifies the audio weights (including the 347 MB full-precision
AudioSet AST used on the graphics card and the 91.4 MB trained tagger, licensed
CC BY-NC-SA 4.0 for non-commercial use); `DGE_MODELS=full npm run build` and
`npm run models:full` prepare all capabilities. `npm run build:airgap` always
does the same before sealing and verifying its artifact. `setup:music` remains
an alias for `models:audio`.

A complete build serves every inference file from its own origin. On the first
audio import, the app reads the verified pack marker, displays its exact byte
count, and asks before the browser fetches the weights. A core-only build
instead explains that its distributor must run `npm run models:audio` and
rebuild. Model binaries and private audio samples are not stored in Git. Build
checks verify weights, configuration and local description-vector checksums.

## Tempo, key and pitch

Music analysis uses Essentia for tempo and key on up to 60 seconds (three
excerpts for longer tracks), alongside a bundled tempo CNN and key CNN
(`public/tempo-model`, `public/key-model`). If a sparse loop does not establish
a full key, an audio-only fundamental tracker can report its repeated pitch
separately; the audio detector never treats a single pitch as a confirmed key.
Short clips can show tempo alternatives (half and double time).

Explicit file and folder tags such as `Dm`, `D# minor`, `140bpm`, `Dm_140`,
`C#3` or `Synths` supply labelled name clues. For each feature, file tags take
precedence over the nearest enclosing folder tags, then audio estimates.
User-confirmed labels keep first priority. The UI and relationship evidence
distinguish name clues from audio detections and keep the original audio
results for comparison. Generic folders such as `Melodic` or `Bass` do not
establish a specific instrument. Folder clues require a supplied relative path
(use folder import); browsers generally omit parent paths for individual files.

The track panel shows tempo with its Camelot code for the key, marks values
that came "from name", shows the audio estimate when it differs, and lists
**Mix with** candidates that share a compatible tempo and key.

## Instruments

Instrument detection uses the bundled AudioSet AST model on overlapping
10-second windows across the whole track, decoded in bounded batches at the
model's native 16 kHz. It keeps specific model labels (for example cello and
violin separately), removes redundant parent families, and does not cap the
number of instruments shown. The track panel shows full or partial scan
coverage and a **Listen at** button for each detection's strongest passage.
Cancellation stops decoding and inference; a model failure preserves partial
results with an explicit warning.

Strong single detections (score ≥ 0.85) or repeated detections (≥ 0.60 in
windows at least five seconds apart) are shown as **likely**. Weaker supported
detections are shown separately as **possible** and never create instrument
links. Overlapping windows are correlated observations, not independent
confirmations. These thresholds are conservative heuristics, not calibrated
probabilities or a measured accuracy guarantee. Instrument links require the
same specific likely label in both tracks; broad families alone do not link a
violin to a cello or a trumpet to a trombone.

Instrument detection is limited to the trained model's vocabulary: it cannot
identify every instrument, reliably separate layered mixes, or name sounds
absent from its classes. Full-track scans take longer than excerpt scans.

## The sound-identification ensemble

Sound identification combines several local models:

- the ~91 MB **AudioSet AST** instrument detector, on overlapping 10-second
  windows across the whole track;
- the ~21 MB **MTG-Jamendo** music instrument model (official Discogs-EffNet
  encoder and 40-class classifier) at 16 kHz, using Essentia's MusiCNN
  preprocessing and complete 128-frame patches;
- the ~78 MB music-trained **CLAP** audio encoder
  ([larger_clap_music_and_speech](https://huggingface.co/Xenova/larger_clap_music_and_speech)),
  which compares audio against fixed text descriptions for source resemblance,
  articulation, tone, space and role;

  In **Full** mode Jamendo and CLAP run over the same overlapping whole-track
  windows as AST. In **Quick** mode they check one representative 10-second
  excerpt at the first drop until the background full pass completes;
- the **trained sound tagger** (`public/tagger-model`) and small learned heads
  on frozen CLAP features (`public/sound-model`), which decide a growing set of
  DJ sound tags; [tag-decision-map.md](tag-decision-map.md) lists which model
  decides each tag;
- a **fusion** step (`public/fusion-model`) that combines the evidence.

The display separates **sound source**, **sounds like**, **sound character**
and **suggested role**. For example, a synthesizer may resemble a trumpet while
functioning as a sustained pad. Resemblance is not treated as another instrument
in the recording.

The ensemble keeps strong, specific AST detections. A substantial AST candidate
can also take priority when CLAP independently gives it a clear match;
otherwise a qualifying Jamendo instrument (average score at least 0.30) supplies
the estimate. Broad roles such as bass, beat, pad and computer are not converted
to instruments. This agreement does not promote weak detections into graph
evidence. Weak or closely tied descriptions remain undetermined. CLAP's
instrument resemblances do not independently establish a physical sound source
or create instrument links. The model comparison shows attribution,
disagreement and incomplete analyses; incompatible model scores are not averaged
into a confidence percentage. These are heuristic decisions, not calibrated
accuracy guarantees. Models receive audio only; explicit filename and folder
hints are handled separately.

The trained sound tagger applies its thresholds to full-precision model scores.
Missing or invalid scores leave that sound to the other detectors; they are
never treated as evidence that a sound is absent. Invalid model probabilities
make the tagger unavailable for that run, preserving the other detectors'
results.

Qwen2-Audio is not included: its published weights are about 16.8 GB and need a
separate inference runtime. Identification cannot recover an exact synthesizer
preset or establish every instrument hidden in a mix.

## Correcting tags

Open the **Sample assistant**, find the sound, and choose **More → Correct
tags** (the same picker appears on Copilot review cards). Pick source,
production-type and character labels from the catalog, then **Save DJ tags**;
**Use automatic DJ tags** removes the correction. Confirmed labels replace the
displayed model labels, take priority in sample search and relationship
evidence, and persist through saving, export and reanalysis. These are explicit
user labels, not model training or a guarantee about future uploads. The full
vocabulary is in [dj-sound-catalog.md](dj-sound-catalog.md).

## Licences

Audio dependencies keep their own terms: Essentia.js is AGPL-3.0, the FFmpeg
core is GPL-2.0-or-later, AudioSet AST is BSD-3-Clause, LAION CLAP is Apache-2.0,
and the MTG-Jamendo/Discogs models and the trained tagger carry non-commercial terms.
The app licence does not override these model restrictions. Keep the bundled
notices and licence texts when distributing builds; commercial use of the MTG
models requires separate permission. See `public/jamendo-model/NOTICE`,
`public/music-model/NOTICE.md` and `public/sound-model/NOTICE` for model
provenance, and the generated `audio-runtime/NOTICE.txt` for decoder source and
build references.

Sources: [Essentia.js](https://github.com/MTG/essentia.js),
[AudioSet AST](https://huggingface.co/Xenova/ast-finetuned-audioset-10-10-0.4593),
[LAION music-and-speech CLAP](https://huggingface.co/laion/larger_clap_music_and_speech).

# Music features integrated from “Explore OpenAI API app ideas”

This workspace includes the Document Graph Explorer features from the referenced chat. The unrelated Bolo, career, portfolio, and general business ideas are separate products.

## Where to find the features

| Feature | Entry point | Behavior |
| --- | --- | --- |
| Folder previews and background verification | Add files / Add a folder; Quick → Full analysis mode | Prioritizes short previews across the folder, permits two decoders, and serializes model inference. Sampled results appear within the initial window when available; Full scans continue afterward. |
| Music chat and graph navigation | Music copilot | Finds, compares, and highlights supported matches; works locally without a cloud key. |
| Voice requests | Speak your request in chat or Sample assistant | Records up to 20 seconds after a click, transcribes with GPT-Transcribe, and leaves editable text for the user to send. This is push-to-talk, not a continuous GPT-Live session. |
| Advanced sample search | Sample assistant → My library | Astra Ultrafast interprets a query into validated filters. Search, similarity, auditioning, and confirmed-label filtering happen locally. |
| Fast and deep review | Sample assistant → Copilot review | Astra Ultrafast via Responses for fast explanations; optional Sol hosted agent for deeper review. Reviews up to five selected sounds. |
| Audio listening review (default review mode) | Sample assistant → Copilot review → GPT-Audio-1.5 | After **Review selected sounds**, uploads the first up to 10 seconds of each selected sound (one to five). Returns excerpt-based source/effect/character suggestions, separately from local measurements and confirmed labels. |
| Track explanations | Track details → Explain with music copilot | Opens review with the selected track and a question about uncertain/conflicting evidence. |
| Interactive crates | My library → Build a crate with AI | Plans up to five sound roles, retrieves real local matches, supports refinements and replacement of the least certain match, and requires an Add action before saving the proposed sounds. |
| Summaries, groups, review priorities | Sample assistant → Upload overview | Immediate local summaries and graph group filters. Optional automatic Astra summaries in batches of five, updated as evidence changes; API errors pause automatic requests. |
| Vocal transcription | Copilot review → Transcribe vocal | Explicitly uploads only a prepared excerpt of up to 30 seconds. Keeps unverified words separate from labels. |
| Suggested properties and corrections | Copilot review / Track details | User-confirmed labels remain authoritative. Accepted AI properties are labeled as suggestions and persist separately. |
| Free sample packs | Sample assistant → Find free packs | Local source catalog, cited web search, and controlled archive import into the local reviewer. No automatic download or training from a search. |

## Runtime

Run `npm run dev`. The OpenAI key is read only by the local Vite server from the ignored `.env.local`, never from a `VITE_` variable or browser bundle. Static production/desktop builds retain local tools, but cloud operations and microphone recording are disabled until a separately authenticated backend is supplied. Only the local development server permits same-origin microphone access.

Search and fast review use `gpt-6-astra` with `service_tier: "ultrafast"`, consistent with the [official Ultrafast guide](https://developers.openai.com/api/docs/guides/ultrafast-mode). [GPT-Transcribe](https://developers.openai.com/api/docs/models/gpt-transcribe) handles speech transcription. Astra interprets supplied evidence; it does not measure music or listen to the original songs.

The expanded sound-description catalog is included. The other checkout's private reviewed examples and trained classifier weights are not copied or activated. Corrections made in this graph remain distinct from model training.

### GPT-Audio-1.5 listening

Select one to five analyzed sounds, leave **GPT-Audio-1.5 — listen to excerpts** selected, and click **Review selected sounds**. This explicit action prepares mono 16 kHz PCM WAV excerpts locally, then sends them through `/api/dj-copilot/review-audio` to the Chat Completions API using `gpt-audio-1.5`. It reuses the same server-side `OPENAI_API_KEY` as the existing copilot; no new key or browser credential is needed. The handler is available only in local development, with the same loopback/same-origin checks, cancellation, concurrency limit, and safe error handling as the existing copilot. Static Vercel and packaged builds do not acquire a new backend.

The provider receives sample aliases, the question, confirmed labels and audio, but not filenames, paths, filename hints, or other detectors' scores. Audio inside the excerpts is itself disclosed, including any voices. Requests use `store: false` and request text output only; no speech is generated. This flag disables storing the completion for retrieval and does not assert zero data retention by the provider. At most 50 seconds of audio is sent per review. The app verifies WAV format, duration, count, ordering and request size before an API call. All originals must be available before the upload; a missing original fails without sending a partial batch.

GPT-Audio does not support Structured Outputs, so returned JSON, canonical tags and sample aliases are validated before use. Truncated or invalid output is rejected. Confirmed labels, including explicitly empty corrections, remain authoritative. **Apply suggested properties** saves tags as unverified AI suggestions with the model and excerpt duration, makes them searchable through the existing suggestion path, and leaves measured tempo/key untouched. The review and export state exactly which excerpts were heard. They never claim full-track coverage, exact synth-preset identification, or calibrated confidence. Ordinary import and Full/Fast local analysis remain local and unchanged.

Validate music accuracy separately on held-out labeled DJ clips before treating this mode as an improvement over the local detectors. Track per-category precision/recall, latency, and API cost. Passing request/UI tests does not establish detection accuracy or account access to this model.

The optional reviewer starts with `npm run review:sounds` and uses the bundled audio models. It requires FFmpeg for decoding. Applying a new custom category downloads the pinned public CLAP text encoder once into the ignored local cache; existing category reviews use the bundled audio features. This setup does not upload reviewed audio or labels.

## Validation boundaries

Unit tests exercise query validation, evidence boundaries, crate selection, cancellation, saving, and the preview-to-Full transition. Browser checks exercise the integrated local UI. Microphone capture on a physical device and cloud account access are separate from mocked tests; an API key's presence alone does not verify quota or model access.

This checkout passed real OpenAI calls for sample search, fast review, and crate planning using synthetic evidence. Local reviewer checks also passed real generated-audio upload, multi-section song analysis, and preserving saved reviews. Continuous voice conversations and physical-microphone capture have not been validated.

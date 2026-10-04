# DJ sample assistant

Run `npm run dev` from this repository, open the local address, and choose **Sample assistant** in the workspace sidebar. The panel is also available before importing audio so you can find sample packs first.

## Search your library

Import audio through **Add files** or **Add a folder**. Ask for something like “vocal chops under 5 seconds”, then refine with “only confirmed ones”. GPT-6 Astra produces validated search filters through the OpenAI Responses API. Both library search and free-pack web search request `service_tier: 'ultrafast'` with low reasoning effort. [Ultrafast](https://developers.openai.com/api/docs/guides/ultrafast-mode) has higher API pricing than standard processing; external web searches can still add latency. Retrieval happens in the browser across the current graph, not an uploaded copy of the library. The UI displays the applied filters and the evidence behind each result.

The assistant sends the text you type, previous search filters, and whether a reference is selected to OpenAI. It does not send audio, file paths, library filenames, or the library's labels. Text the user includes in a query is sent as entered. Requests use `store: false`; this is not a promise of Zero Data Retention.

**Local filters** work without OpenAI. They support label/filename phrases, measured BPM ranges, a maximum duration, and confirmed labels. Missing or low-confidence measurements do not match numerical/key filters. Confirmed DJ tags supersede automatic tags, including explicit negative corrections. Filename hints are identified separately from audio estimates.

**Find similar sounds** compares labels, reliable measured tempo, and estimated key. It is not audio-vector or waveform matching. Use **Audition** to listen, **Correct tags** for the existing correction workflow, and **Open in graph** for the full audio panel and conversion options.

Crates are saved locally per saved corpus. Temporary/imported views require exporting before closing the panel. **Export crate** downloads an importable graph subset containing selected nodes and their relationships, not the original audio files.

## Copilot review

Choose **Sample assistant → Copilot review**, select up to five analyzed sounds, and click **Review selected sounds**. Local evidence appears immediately, including explicit empty corrections, low-confidence measurements, and separately identified filename/folder hints. Fast review uses `gpt-6-astra` with the Ultrafast tier through the Responses API. The optional deeper review uses `gpt-6.1-sol` at the standard service tier through the hosted Agents API. Both explain uncertainty and suggest groupings from this evidence. It does not listen to the audio, modify tags, or claim acoustic similarity. Existing search keeps its current model/settings.

Only selected measurements, canonical sound labels, musical filename hints, and the review question are sent to OpenAI. Samples use numbered aliases; filenames, paths, free-text analysis notes, originals, and the rest of the library are excluded. For deeper reviews, a small OpenAI-hosted sandbox has network disabled and no API key. The client checks for a completed root turn, reconciles saved final messages after an interrupted stream, and deletes the temporary session. Stopping/closing the panel cancels the request and initiates cancellation and cleanup on the server. Cleanup failures are reported with the session ID, including in server logs after a browser disconnect. This is not a zero-data-retention guarantee.

**Transcribe vocal** is a separate, explicit upload action. The existing local decoder prepares only the first 30 seconds as mono 16 kHz WAV, verified again on the server before sending to `gpt-transcribe`. The original filename is replaced with `vocal-excerpt.wav`. Transcripts are unverified and may be inaccurate for music or chopped vocals. They are not automatically included in review prompts or used as confirmed labels. Missing original files produce an actionable error.

Audition, correct tags, or add samples to the existing crate directly from the evidence cards. After a review, **Apply suggested properties** adds the listed source, production, and character tags to the reviewed sounds in one click. They remain visibly AI-suggested (not human-confirmed), appear in track details and sample search, and survive reanalysis and local session restore. Confirmed labels, including explicit empty corrections, take priority. The action never edits measured tempo/key, trains a classifier, or converts advice into acoustic evidence. No button action makes another OpenAI call. A changed selection, question, or analysis marks an earlier review as historical and disables applying it; changes to the library are also checked before saving. If local storage fails, keep the tab open and retry the action.

**Export review** saves the advice, sample mapping, and transcripts for the current selection as text; audio is not included. Reviews/transcripts stay in memory across tabs and are discarded when the panel closes. Applied properties are saved separately with the local graph; imported/shared graphs must be exported to retain edits. Save a review before closing it.

Like the existing AI search, online review/transcription runs only under `npm run dev` on loopback. Static production/desktop builds keep the evidence view and corrections but need a separate authenticated backend to enable OpenAI calls. The server bounds requests, accepts only same-origin loopback calls, and permits one copilot request at a time. Model usage and hosted sandbox time are billable. API access, credits, and permissions are checked by the real request, not inferred from key presence.

## Voice, upload summaries, and interactive crates

See [the integration guide](music-copilot-integration.md) for push-to-talk requests, automatic upload summaries, graph group filters, and the interactive crate builder.

## Find free packs

The **Find free packs** view includes four publisher-checked CC0 starting sources (checked October 2, 2026):

- [FreePats Synthesizer Percussion](https://freepats.zenvoid.org/Percussion/electric-percussion.html)
- [FreePats World and Rare Percussion](https://freepats.zenvoid.org/Percussion/world-and-rare-percussion.html)
- [Versilian Community Sample Library](https://github.com/sgossner/VCSL)
- [Kenney Impact Sounds](https://kenney.nl/assets/impact-sounds)

Type to filter these sources locally. **Search web with AI** uses OpenAI web search and requires cited source URLs; it does not pretend cached sources are newly researched results. Choose classification or generative training so the research checks the appropriate conditions. Web results are leads to review, not automatic training approval. Searching alone does not download files or start training.

### Import packs into the reviewer

**Download to reviewer** on either FreePats card downloads that publisher's fixed archive and adds its audio to the reviewer at `http://127.0.0.1:8766/`. The local app starts the reviewer if necessary. An older running reviewer must be restarted once with `npm run review:sounds` to enable imports.

For other sources, open the publisher's download page, download the archive, and choose **Import a pack from this source** or **Import downloaded archive**. Enter the publisher and license-evidence links, select the downloaded file, and click **Import archive to reviewer**. User-entered links are retained as evidence, not treated as verified licensing. Arbitrary URLs are not downloaded by the local server.

Imports accept up to 100 MB compressed, 500 MB of extracted audio, and 300 sounds. ZIP, 7z and tar support depends on the local `tar` program (macOS ships libarchive/bsdtar). FFmpeg and the existing local CLAP model are required for analysis. The original archive, including license files, and a `source.json` record are retained under `artifacts/music-evaluation/review-start/packs/` (or the configured `DJ_REVIEW_DATA` directory). Audio is stored by SHA-256 to skip duplicates. Existing reviews are preserved. Analysis runs locally in a background job, and the app resumes progress polling if the panel is reopened. Silent or undecodable clips are reported instead of silently marked reviewed.

Open the reviewer after import (or click **Refresh sound list** in an already open reviewer tab). Every new sound enters unreviewed with empty proposed labels and separate model estimates. Listen and confirm labels there to use the existing training workflow. Importing does not train or activate a model and uses no OpenAI credits.

Save sources and export the source list to retain publisher, license-evidence URL, and check date. This list records selected sources, not verified provenance for subsequently imported files. Retain each downloaded archive's license with its extracted audio, then review the actual sounds before using labels as training truth. A free or royalty-free music-production license alone does not establish model-training rights. See [CC0](https://creativecommons.org/publicdomain/zero/1.0/) and [Freesound's training guidance](https://freesound.org/help/faq/) for license and uploader-preference details.

## Runtime and credentials

`OPENAI_API_KEY` belongs in the ignored repository-root `.env.local`. It is read by the local Vite server only, never a `VITE_` browser variable. Restart `npm run dev` after changing it. The endpoint only accepts same-origin loopback requests, allows one active request, bounds input/output, and never forwards raw provider errors or secrets.

AI endpoints are development-only in this version. Static production builds retain local browsing/filtering, playback, crates and the checked source catalog, but disable AI search. A deployed version would need its own authenticated server endpoint and server-side secret. No deployment or server secret upload is part of this change.

HTTP 429 from OpenAI means online search is unavailable; the UI preserves prior results and offers local filters. Check API usage/billing rather than adding a browser-side key or treating a local fallback as an AI result.

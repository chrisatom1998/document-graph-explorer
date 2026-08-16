# Document Graph Explorer — User Guide

Document Graph Explorer (the app installs as **Knowledge Nebula**) turns a folder of documents into an explorable **3D knowledge graph**. Drop your files onto the window and it parses them, works out what they're about and how they relate, and renders the whole corpus as a force-directed constellation: documents become nodes, semantic and structural relationships become edges, and related documents cluster into named topic groups.

This guide covers why the tool exists, what it can do, and how to use every feature.

---

## Why it's valuable

**You can see a corpus, not just search it.** Most document tools answer the question "where is X?" This one answers "what do I have, and how does it fit together?" — the shape of a project, a research archive, or a knowledge base becomes visible at a glance: which themes dominate, which documents bridge topics, what's isolated and probably orphaned.

**It's private by architecture, not by promise.** Everything — parsing, embeddings, similarity, clustering, layout — runs inside your browser, in web workers, using a self-hosted embedding model. There is no server, no account, no telemetry. Your documents never leave the tab. If the app is hosted on Vercel or another static host, files you add are still read in the page and stored only in that browser's local storage for that site origin; the host serves the app shell, not your corpus. The only network call the app can make is the optional AI enrichment via OpenRouter, which is **off by default**, requires your own API key, and can be physically removed entirely with the air-gapped build (choosing the local Ollama provider instead keeps even AI features on your machine). That makes the tool usable on corpora you could never upload to a cloud service: contracts, medical notes, unpublished research, internal docs. See [SECURITY.md](../SECURITY.md) for the enforced guarantee.

**It's zero-friction.** No indexing service to stand up, no database, no configuration. Open the app, drag a folder in, and the graph builds itself. The computed graph persists locally (IndexedDB), so the next session restores instantly without re-parsing. On a hosted deployment, that persistence is still per-browser and per-site-origin, so a corpus saved in one browser or domain does not automatically appear in another.

**It understands documents, not just filenames.** Ingestion runs a real pipeline — format-aware parsing, boilerplate stripping, chunking, TF-IDF, neural embeddings, similarity linking, Louvain community detection, topic synthesis — so the connections it draws reflect meaning, not folder structure.

## What it can do

- **Ingest real-world formats**: plain text, Markdown, HTML, PDF (including link annotations), Office files (Word, PowerPoint, Excel), CSV/JSON/YAML with dedicated viewers, and source code / repositories (imports become reference edges).
- **Build the graph automatically**: semantic similarity links, explicit cross-document links (e.g. Markdown/PDF links between files), entity co-mention links, and named topic clusters.
- **Let you explore in 3D**: orbit/zoom/pan a force-directed layout, hover for details, click to read, pin nodes by dragging, with an adaptive quality system (and a 2D mode) that keeps the scene smooth.
- **Answer questions from your documents**: a built-in chat panel retrieves the most relevant passages and answers extractively — fully offline — or streams richer answers via an opt-in AI provider (OpenRouter or a local Ollama server), always with clickable source citations.
- **Search semantically**: find documents by meaning, not just keyword match (`Ctrl+K` / `⌘K`).
- **Surface insights**: orphaned documents, near-duplicates, bridge documents, and stale files; plus shortest-path finding between any two documents ("How are these connected?").
- **Compare two documents side by side**: from the reader, a duplicate chip, a connection, or Insights — with a local similarity and shared-topic summary, no network required.
- **Persist your work**: sessions restore automatically in under a few seconds; named snapshots capture graph states you can reload at any time.
- **Run anywhere, including sealed environments**: a normal local build, an offline-mode toggle, and a verified **air-gapped build** whose Content-Security-Policy removes the external network at the browser level.

---

## Getting started

### Run from source (dev)

```bash
npm install
npm run dev
```

Open the printed local URL. Click **Load demo corpus** on the welcome screen to explore instantly, or drag your own files or folders onto the window.

### Run without dev tools

Build once, then use the double-click launchers — they start a tiny localhost-only static server (Node built-ins, no dependencies) and open your browser:

1. `npm run build`
2. Double-click `run.cmd` (Windows) or `run.command` (macOS), or `./run.sh` (Linux).

On Windows, `npm run install:desktop` puts a **Document Graph Explorer** icon on your desktop that launches the same way. On macOS, drag `run.command` to your Dock.

### Install as a macOS app

On a Mac:

```bash
npm run build:desktop
```

This builds `Knowledge Nebula.app` and installs it to `/Applications` (Launchpad and Spotlight will find it).

### Distribute to other Macs

```bash
npm run dist:mac
```

Produces `Knowledge Nebula-<version>-arm64.dmg` and `.zip` under `release/`. Recipients on another Mac must right-click → **Open** the first time unless the build is Developer-ID signed and notarized — see [README → Distributing the app](../README.md#distributing-the-app-dmg).

---

## Privacy modes at a glance

| Mode | What it means | How to get it |
| --- | --- | --- |
| **Default** | No document content leaves the browser. AI enrichment exists but is off until you configure a provider. | `npm run build` (or any launcher) |
| **Offline mode** | A Settings toggle that blocks all external requests in JavaScript and answers chat locally. Behavioral — can be toggled back off. | Settings → **Offline mode** |
| **Air-gapped build** | External network **physically removed** via CSP, AI UI stripped entirely, enforced by a post-build verification gate. For distribution where the guarantee must be enforced, not configured. | `npm run build:airgap`, launchers with `--airgap` |

---

# Feature guide

## Adding documents

There are five ways to get documents in:

1. **Drag & drop** files *or entire folders* anywhere on the window (folders are walked recursively; the overlay reads "Drop to add to your nebula").
2. The **Add files** button on the welcome screen (multi-select file picker for individual files).
3. The **Add a folder** button on the welcome screen — pick one folder and every relevant file inside it is pulled in automatically, subfolders included, with no need to drill into them (like adding a folder in Google Drive). Browsers with the File System Access API get the native directory picker; everywhere else a standard folder-upload picker is used, still recursive.
4. The **＋ Add files** and **Add folder** buttons on the toolbar — the same two pickers, available once a graph is loaded.
5. **Load demo corpus** on the welcome screen, for an instant tour with sample documents.

**Supported formats:** `txt`, `log`, `md`/`mdx`/`rmd`, `pdf`, `html`/`htm`, `docx`/`docm`, `pptx`/`pptm`, `xlsx`/`xlsm`, `json`/`ipynb`, `yaml`/`yml`, `csv`, and source code (`ts`/`tsx`/`js`/`jsx`/`py`/`go`/`rs`/`java`/`kt`/`c`/`cpp`, plus Elixir, Haskell, Julia, PowerShell, Prisma, Astro, Dockerfiles, Makefiles, and many other text-based languages). Selected code documents show the language (`ts`, `py`, `js`, …) on the name and reader card. Anything else lands in the collapsible **ignored tray** with a reason rather than failing silently. Dotfiles, lockfiles, minified bundles, and development directories (`node_modules`, `.git`, `dist`, `build`, `vendor`, `target`, `.venv`, …) are skipped automatically when dropping folders — and the same filters apply when adding a folder through **Add a folder**. If the folder contains a `.gitignore`, those patterns are applied too — so dropping (or picking) a git checkout indexes the project, not its build output.

**What happens next:** ingestion runs entirely off the main thread — parse → boilerplate strip → chunk → TF-IDF → embeddings (self-hosted BGE model) → similarity links + Louvain clustering → topic synthesis. A **progress strip** shows the current phase (`Parsing…`, `Finding connections…`, `Embedding meaning…`, `Clustering…`, `Ready`), a percentage bar, and per-file status chips. The first run also shows a one-time banner while the embedding model loads.

**Limits:**

| Limit | Value | What happens beyond it |
| --- | --- | --- |
| Per file | 64 MB | File goes to the ignored tray ("too large") |
| Per drop | 512 MB total | Remainder skipped with a warning toast |
| Corpus | 4,096 nodes | Further files ignored ("node limit reached") |
| Very large docs | first ~200 KB indexed | Doc gets a "partial" warning badge; search covers the indexed part |

Re-dropping a file you've already added is detected by content hash and is an instant cached no-op. Encrypted or unreadable PDFs appear as ghosted nodes with a warning instead of vanishing.

## Navigating the 3D scene

| Input | Action |
| --- | --- |
| Drag on empty space | Orbit the camera |
| Scroll / pinch | Zoom |
| `←` `→` `↑` `↓` | Pan (keyboard only — mouse panning is intentionally disabled) |
| `Home` | Frame the whole graph |
| Click a node | Select it and open the detail panel |
| Click empty space | Deselect |
| Drag a node | Pin it in place in the layout |
| Double-click a node | Release the pin |
| `Ctrl+K` / `⌘K` | Open search |
| `Esc` | Close the topmost open panel; with nothing open, clears selection, then frames the graph |

**What you're looking at:** documents are glossy spheres in cluster colors, sized by connection count. Edges are curved filaments colored by relationship kind. Hovering or selecting a node sends **pulses of light** flowing along its edges, and a tooltip shows the title, type, word count, and topics. Labels appear on the nearest ~40 nodes and fade with distance. A teal **AI core** at the center of the nebula flares while chat answers stream. After 10 seconds idle, the nebula slowly auto-rotates (this and other motion effects respect your OS "reduced motion" setting).

**2D mode & topic nodes:** **View options ▾** holds **2D view** (flattens the layout; same clustering, lighter on the GPU), **Topic nodes** (octahedron hubs for shared topics; off by default), cluster collapse, saved camera views, and the graph legend.

**Auto-quality:** by default the app watches frame rate and steps effects down (and back up) to stay smooth — depth-of-field first, then bloom resolution, then label count and pulses. If it still struggles, a toast offers **"Switch to 2D"**. Pin maximum quality by unchecking Settings → **Auto-adjust quality for smooth performance**.

## The toolbar

Appears once the graph has nodes, and can be dragged anywhere by its grip handle (position is remembered). The bar is the core loop only; studio tools sit one click down. Left to right:

| Control | What it does |
| --- | --- |
| **Corpus switcher** | Named workspaces and optional live folder sync |
| **Search (⌘K)** | Opens search; **Show all in graph** frames every match |
| **Fit view** | Frames the whole graph |
| **View ▾** | 2D, topic nodes, collapse clusters, saved views, help/legend |
| **Analyze ▾** | Path finding, corpus insights, snapshots |
| **Data ▾** | JSON import/export, PNG, share URL, OpenUSD |
| **Settings** | AI, storage, performance; OCR and export embeddings under **Advanced** |
| **Add ▾** | Add files or add a folder |

The product-surface map is in [docs/product-surface.md](./product-surface.md).

## Search (`Ctrl+K` / `⌘K`)

One search box, two engines. As you type (results update after a brief pause), you get instant **lexical** matches — title substrings and keyword/topic/entity hits — followed by **semantic** matches: the query is embedded with the same local model as your documents and compared by meaning, so "how do we deploy" finds the release runbook even if it never says "deploy". Each result shows a match-kind badge (`title` / `keyword` / `semantic`), a relevance bar, and a snippet for semantic hits. Matching nodes highlight live in the scene while you type.

**Show all in graph** (when there is more than one hit) frames the whole match set and lights those nodes with the same golden pulse the old “Show me a topic” panel used. That is the one-move answer to "where is everything about X?" — not a second search UI.

Navigate with `↓`/`↑`, open with `Enter` (selects the node and flies the camera to it), close with `Esc`. An active graph filter also hides non-matching hits in this list and in the scene.

## How are these connected? (path finder)

**Analyze ▾ → How are these connected?** Click one node, then another: the app finds the **fewest-hop route** between them through the graph, highlights it, frames it, and lists it hop-by-hop in a panel (each hop is clickable). Useful for questions like "what chain of documents links this contract to that email thread?" If no route exists you'll get "No connection found between these documents." Clicking a third node starts a new path from there; topic hubs can't be path endpoints.

## Corpus insights

**Analyze ▾ → Corpus insights**. Automatic health checks over the whole corpus, each with a **Highlight** toggle that dims everything else in the scene:

- **Orphaned documents** — connected to nothing; likely stale or out-of-scope.
- **Possible duplicates** — pairs at ≥93% semantic similarity, with the match percentage shown. **Compare** opens both documents side by side.
- **Bridge documents** — the docs the most shortest-paths run through: either your most important documents or your most confused ones.
- **Stale documents** — not modified in over 6 months, oldest first.

Every row is clickable to fly to that document.

## Document details (side panel)

Click any node. The right-hand panel opens on the document itself:

- **Header actions**: **Open** (opens the original file — see below) and close stay on the title row. **More like this**, **Compare** (pick a second document in the graph, or jump straight in from a duplicate chip / connection / Insights pair), and **Remove** (two-step confirm; removes the doc and its cached data from the graph and rebuilds links — the file on disk is untouched) sit on a second action row.
- **Identity**: file type, cluster (with color), warnings (e.g. partially indexed), clickable **≈ duplicate of …** chips when a near-duplicate exists (opens a side-by-side compare), plus word count, connection count, and last-modified time.
- **A real document reader** (the first expanded section): PDFs render their actual pages (lazily as you scroll); Markdown renders with headings, tables, code, and working cross-document links — a `[[wikilink]]` or relative link to another ingested doc jumps to it *inside the graph*; HTML renders sanitized; CSV becomes a real table; JSON/YAML are syntax-highlighted; everything else gets a clean text reader. Opening from search or chat jumps here with a matching-passage banner.
- **About** (collapsed until you open it): **Summary** (AI-enriched if enrichment ran, otherwise the document's opening lines), **Topics** (topics shared with other docs are clickable hubs), **Entities**, **Notes & Tags**, and **Ask AI** (when enrichment is enabled — see below). Notes are saved per corpus, keyed by the document's path — an edited file keeps its notes — and pinned documents appear as a jump list in Corpus insights. Imported or shared graphs explain that notes cannot be saved there.
- **Connections** (collapsed until you open it): every edge sorted by strength, with the relationship kind, a weight bar, evidence for the link, a click-to-jump neighbor title, and **Compare** to read that neighbor beside this document.

**Compare two documents:** the overlay shows both readers, a local relationship strip (embedding similarity, shared topics / entities / keywords, and any direct edge with its evidence), and **Change** / swap controls. Click a shared term to highlight it in both readers. Esc closes compare before other panels. No network call — the summary is computed from the graph you already have.

**Topic hubs** skip the empty reader. The panel lists the documents that share the topic, without Open / Remove / notes / Ask AI.

**Open the original:** if the app retained the exact bytes you dropped (it does, per file), **Open** hands the original file to your OS so it opens in the default app for that type. Otherwise it opens a styled reader tab with the formatted text and a numbered list of every link found in the document.

## Filters

The funnel button (top-left) opens the filter bar on **file-type** and **cluster** chips. **More filters** reveals connection-count, link-strength, connection-kind, and recency controls. Filtered-out nodes dim in the scene; search results are intersected with the active filter. **Clear** resets everything.

## Minimap

At 20+ documents, a top-down minimap appears in the bottom-right corner: cluster-colored dots, a live "you are here" camera indicator, and the selected node ringed in the accent color. **Click anywhere on it to fly** to the nearest document. It slides aside when the detail panel is open.

## Chat with your documents

The floating **chat bubble** (lower-left, "AI" badge) opens **"Chat with your docs"**. Ask a question in plain language; `Enter` sends, `Shift+Enter` adds a newline, and the send button becomes a **Stop** button while an answer is streaming.

Two modes, selected automatically:

- **Local (default / offline / air-gapped):** the app retrieves the best-matching passages from your corpus and quotes them verbatim, grouped by source — no network, no LLM, marked with the hint *"Offline mode — answers are exact passages from your documents."*
- **AI provider (opt-in):** with a chat provider selected in Settings — OpenRouter (with your API key) or a local Ollama server — the same retrieval feeds the model, which streams a synthesized answer token-by-token, with multi-turn memory over the recent conversation. Chat has its own **Chat model** picker, separate from enrichment: because chat is one request per question rather than one per 15 documents, the list leads with flagship models (Claude Sonnet 5, GPT-5.4, Gemini 3.1 Pro) and keeps the fast tier as the cheap option.

Either way, every answer carries **source chips**: hover for the match strength and snippet, click to fly to that document in the graph, or use the ↗ icon to open it.

Chat history is saved per workspace in browser-local IndexedDB — the most recent 100 messages are restored when you return to that workspace. Like everything else the app stores, it never leaves your device. The transcript is cleared when the corpus is reset, and deleting a workspace deletes its transcript with it.

## Ask AI about one document

With enrichment enabled, the detail panel gains an **Ask AI** section with three streaming actions: **Summarize** (4–7 sentences), **Outline topics** (hierarchical outline of the whole document), and a free-form **Ask** box answered only from that document. Note the disclosure shown in the panel: these actions send the full document text to your selected AI provider (OpenRouter, or your local Ollama server).

## AI enrichment (optional, off by default)

Settings → **AI Enrichment**. Enrichment adds three things the local pipeline can't: fluent per-document **summaries and topics**, corpus-wide **topic canonicalization** (merging "auth" / "authentication" / "authn" into one topic), and human-quality **cluster names** ("Deployment & Infra" instead of a keyword list). To use it:

1. Pick an **Enrichment & document AI provider**: **OpenRouter** (cloud) or **Ollama** (a local server on your machine).
2. For OpenRouter, paste your **API key** (stored only in this browser; by default kept for this tab only — check **Remember OpenRouter key on this device** to persist it locally), then pick an **Enrichment & document AI model**. For Ollama, pick one of the models installed on your local server (**Recheck installed models** re-reads the server after you pull one). This is separate from the **Chat model** — the two are chosen independently.
3. Turn on **Enable AI enrichment**.
4. Click **Enrich now**.

The enrichment list is deliberately short. Enrichment sends one request per 15 documents across the whole corpus (fewer when documents are large), so every option is a fast-tier model (Gemini Flash Lite, Claude Haiku, GPT-5 mini and similar) where a large reasoning model would turn minutes into hours. Chat's list is separate and leads with flagship models, since it only sends one request per question. The list is checked against OpenRouter's live catalog, and a model you had selected before this list existed stays available. With enrichment on, each document's full stored text is sent to the selected provider for the batch pass (capped at 240,000 characters only if a file exceeds typical model context), and "Ask AI" / chat send the relevant documents' text; with it off (the default), nothing ever leaves the browser — and with the Ollama provider nothing leaves your machine at all. The OpenRouter key travels only as a request header, is never written into exports or the graph cache, and enrichment failures degrade gracefully (you keep the local summaries and names).

## Snapshots

Toolbar → **Analyze ▾ → Snapshots**. Type a name (a sensible default is pre-filled) and press **Save** to capture the current graph — documents, layout positions, and state. **Load** any saved snapshot to restore it (target: under 3 seconds), **Compare** paints added (green) and updated (amber) documents on the live graph and lists titles that exist only in the snapshot, **✕** deletes just the snapshot record. Snapshots reference cached documents rather than duplicating them, so they're cheap to keep.

## Sessions & your data

Everything persists automatically to your browser's IndexedDB: the session saves itself shortly after the graph is ready, and again once the layout settles, so the next launch restores your corpus — same shape, same positions — in a few seconds, fully offline. Re-parsing only happens for new or changed files.

Settings → **About** shows how much of this origin's browser storage the app is using. Settings → **Data** can drop **cached embeddings** (reload then re-embeds from saved text) or **original files** (Open falls back to the text viewer) without wiping the graph. Uncheck **Cache embeddings for instant reload** to stop writing vectors and free space on large corpora.

Settings → **Advanced** picks scanned-PDF OCR language and page cap, whether semantic search uses BGE's English instruction prefix or a language-neutral query, and whether JSON exports include document embeddings.

Settings → **Data** → **Clear all data** (two-step confirm) wipes the graph and every cached document, embedding, and snapshot; your settings and API key are kept.

Toolbar → **Data ▾** opens local export/import tools. **Export graph JSON** downloads the current graph; **Export image PNG** saves the visible scene; **Import graph JSON** loads a previous export and asks for confirmation before replacing a live graph.

Generated PDF copies of this guide should be produced from this Markdown source (render + print-to-PDF) rather than edited directly.

## Offline mode & the air-gapped build

- **Offline mode** (Settings checkbox) blocks all external requests in JavaScript — a per-call refusal plus a global fetch guard — and forces chat to local extractive answers. It's a behavioral setting: you can flip it back off.
- **The air-gapped build** (`npm run build:airgap`) is the enforced version: the AI UI is removed entirely, AI functions refuse before any network call, and the shipped Content-Security-Policy contains no external hosts, so the *browser itself* blocks every off-origin request — even from a buggy dependency. A post-build verification gate fails the build if the CSP ever admits an external host.

Rule of thumb: use offline mode for yourself; distribute the air-gapped build when the guarantee has to be enforced rather than trusted. Details in [SECURITY.md](../SECURITY.md).

---

## Quick reference

| Shortcut | Action |
| --- | --- |
| `Ctrl+K` / `⌘K` | Search |
| `Esc` | Close topmost panel → clear selection → frame graph |
| `Home` | Frame the whole graph |
| Arrow keys | Pan camera |
| `Enter` (chat) | Send message (`Shift+Enter` for newline) |
| Click node | Select and open details |
| Drag node | Pin in layout (double-click to release) |

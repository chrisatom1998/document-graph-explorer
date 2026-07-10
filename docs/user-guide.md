# Document Graph Explorer — User Guide

Document Graph Explorer (the app installs as **Knowledge Nebula**) turns a folder of documents into an explorable **3D knowledge graph**. Drop your files onto the window and it parses them, works out what they're about and how they relate, and renders the whole corpus as a force-directed constellation: documents become nodes, semantic and structural relationships become edges, and related documents cluster into named topic groups.

This guide covers why the tool exists, what it can do, and how to use every feature.

---

## Why it's valuable

**You can see a corpus, not just search it.** Most document tools answer the question "where is X?" This one answers "what do I have, and how does it fit together?" — the shape of a project, a research archive, or a knowledge base becomes visible at a glance: which themes dominate, which documents bridge topics, what's isolated and probably orphaned.

**It's private by architecture, not by promise.** Everything — parsing, embeddings, similarity, clustering, layout — runs inside your browser, in web workers, using a self-hosted embedding model. There is no server, no account, no telemetry. Your documents never leave the tab. The only network call the app can make is the optional Gemini enrichment, which is **off by default**, requires your own API key, and can be physically removed entirely with the air-gapped build. That makes the tool usable on corpora you could never upload to a cloud service: contracts, medical notes, unpublished research, internal docs. See [SECURITY.md](../SECURITY.md) for the enforced guarantee.

**It's zero-friction.** No indexing service to stand up, no database, no configuration. Open the app, drag a folder in, and the graph builds itself. The computed graph persists locally (IndexedDB), so the next session restores instantly without re-parsing.

**It understands documents, not just filenames.** Ingestion runs a real pipeline — format-aware parsing, boilerplate stripping, chunking, TF-IDF, neural embeddings, similarity linking, Louvain community detection, topic synthesis — so the connections it draws reflect meaning, not folder structure.

## What it can do

- **Ingest real-world formats**: plain text, Markdown, HTML, PDF (including link annotations), and Office files (Word, PowerPoint, Excel), plus CSV/JSON/YAML with dedicated viewers.
- **Build the graph automatically**: semantic similarity links, explicit cross-document links (e.g. Markdown/PDF links between files), entity co-mention links, and named topic clusters.
- **Let you explore in 3D**: orbit/zoom/pan a force-directed layout, hover for details, click to read, pin nodes by dragging, with an adaptive quality system (and a 2D mode) that keeps the scene smooth.
- **Answer questions from your documents**: a built-in chat panel retrieves the most relevant passages and answers extractively — fully offline — or streams richer answers via opt-in Gemini enrichment, always with clickable source citations.
- **Search semantically**: find documents by meaning, not just keyword match (`Ctrl+K` / `⌘K`).
- **Surface insights**: orphaned documents, near-duplicates, bridge documents, and stale files; plus shortest-path finding between any two documents ("How are these connected?").
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
| **Default** | No document content leaves the browser. Gemini enrichment exists but is off until you supply a key. | `npm run build` (or any launcher) |
| **Offline mode** | A Settings toggle that blocks all external requests in JavaScript and answers chat locally. Behavioral — can be toggled back off. | Settings → **Offline mode** |
| **Air-gapped build** | External network **physically removed** via CSP, AI UI stripped entirely, enforced by a post-build verification gate. For distribution where the guarantee must be enforced, not configured. | `npm run build:airgap`, launchers with `--airgap` |

---

# Feature guide

## Adding documents

There are four ways to get documents in:

1. **Drag & drop** files *or entire folders* anywhere on the window (folders are walked recursively; the overlay reads "Drop to add to your nebula").
2. The **Add files** button on the welcome screen.
3. The **＋ Add files** button on the toolbar (multi-select file picker — note the picker selects files; use drag & drop for folders).
4. **Load demo corpus** on the welcome screen, for an instant tour with sample documents.

**Supported formats:** `txt`, `log`, `md`, `mdx`, `pdf`, `html`/`htm`, `docx`/`docm`, `pptx`/`pptm`, `xlsx`/`xlsm`, `json`, `yaml`/`yml`, `csv`. Anything else lands in the collapsible **ignored tray** with a reason rather than failing silently. Dotfiles and development directories (`node_modules`, `.git`, `dist`, `build`, `.venv`, …) are skipped automatically when dropping folders.

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

**2D mode & topic nodes:** the toolbar's **View options ▾** menu has two toggles — **2D view** (flattens the layout to a plane; same clustering and interactions, much lighter on the GPU) and **Topic nodes** (adds octahedron hubs for topics shared by two or more documents; off by default).

**Auto-quality:** by default the app watches frame rate and steps effects down (and back up) to stay smooth — depth-of-field first, then bloom resolution, then label count and pulses. If it still struggles, a toast offers **"Switch to 2D"**. Pin maximum quality by unchecking Settings → **Auto-adjust quality for smooth performance**.

## The toolbar

Appears once the graph has nodes, and can be dragged anywhere by its grip handle (position is remembered). Left to right:

| Button | What it does |
| --- | --- |
| **Search (⌘K)** | Opens the search overlay |
| **Show me a topic** | Highlights every document matching a topic phrase |
| **Fit view** | Frames the whole graph |
| **View options ▾** | 2D view and Topic nodes toggles |
| **How are these connected?** | Path mode — pick two nodes, see the route |
| **Corpus insights** | Orphans, duplicates, bridges, stale docs |
| **Saved snapshots** | Save and reload graph states |
| **Settings** | AI enrichment, offline mode, performance, data |
| **＋ Add files** | File picker |

## Search (`Ctrl+K` / `⌘K`)

One search box, two engines. As you type (results update after a brief pause), you get instant **lexical** matches — title substrings and keyword/topic/entity hits — followed by **semantic** matches: the query is embedded with the same local model as your documents and compared by meaning, so "how do we deploy" finds the release runbook even if it never says "deploy". Each of the up-to-12 results shows a match-kind badge (`title` / `keyword` / `semantic`), a relevance bar, and a snippet for semantic hits. Matching nodes highlight live in the scene while you type.

Navigate with `↓`/`↑`, open with `Enter` (selects the node and flies the camera to it), close with `Esc`.

## Show me a topic

Toolbar → **Show me a topic**. Type a phrase ("machine learning", "invoices", "Q3 planning") and press **Show me**: up to 40 matching documents light up with a pulsing golden glow and the camera frames the whole set — a one-move answer to "where is everything about X?" The panel lists the top matches as clickable buttons.

## How are these connected? (path finder)

Toolbar → the path icon. Click one node, then another: the app finds the **fewest-hop route** between them through the graph, highlights it, frames it, and lists it hop-by-hop in a panel (each hop is clickable). Useful for questions like "what chain of documents links this contract to that email thread?" If no route exists you'll get "No connection found between these documents." Clicking a third node starts a new path from there; topic hubs can't be path endpoints.

## Corpus insights

Toolbar → **Corpus insights**. Four automatic health checks over the whole corpus, each with a **Highlight** toggle that dims everything else in the scene:

- **Orphaned documents** — connected to nothing; likely stale or out-of-scope.
- **Possible duplicates** — pairs at ≥93% semantic similarity, with the match percentage shown.
- **Bridge documents** — the docs the most shortest-paths run through: either your most important documents or your most confused ones.
- **Stale documents** — not modified in over 6 months, oldest first.

Every row is clickable to fly to that document.

## Document details (side panel)

Click any node. The right-hand panel shows:

- **Header actions**: **Open** (opens the original file — see below), **Remove** (two-step confirm; removes the doc and its cached data from the graph and rebuilds links — the file on disk is untouched), and close.
- **Badges**: file type, cluster (with color), warnings (e.g. partially indexed), and clickable **≈ duplicate of …** chips when a near-duplicate exists.
- **Stats**: word count, connection count, last-modified time.
- **Summary** (AI-enriched if enrichment ran, otherwise the document's opening lines), **Topics** (topics shared with other docs are clickable hubs), and **Entities**.
- **Ask AI** (when enrichment is enabled — see below).
- **Connections**: every edge sorted by strength, with the relationship kind, a weight bar, evidence for the link, and a click-to-jump neighbor title.
- **A real document reader**: PDFs render their actual pages (lazily as you scroll); Markdown renders with headings, tables, code, and working cross-document links — a `[[wikilink]]` or relative link to another ingested doc jumps to it *inside the graph*; HTML renders sanitized; CSV becomes a real table; JSON/YAML are syntax-highlighted; everything else gets a clean text reader.

**Open the original:** if the app retained the exact bytes you dropped (it does, per file), **Open** hands the original file to your OS so it opens in the default app for that type. Otherwise it opens a styled reader tab with the formatted text and a numbered list of every link found in the document.

## Filters

The funnel button (top-left) opens the filter bar: toggle **file-type chips** and **cluster chips** (each shows its count), require a minimum number of **connections** (slider 0–10), or hide weak edges with the **Link Strength** slider. Filtered-out nodes dim in the scene; **Clear** resets everything.

## Minimap

At 20+ documents, a top-down minimap appears in the bottom-right corner: cluster-colored dots, a live "you are here" camera indicator, and the selected node ringed in the accent color. **Click anywhere on it to fly** to the nearest document. It slides aside when the detail panel is open.

## Chat with your documents

The floating **chat bubble** (lower-left, "AI" badge) opens **"Chat with your docs"**. Ask a question in plain language; `Enter` sends, `Shift+Enter` adds a newline, and the send button becomes a **Stop** button while an answer is streaming.

Two modes, selected automatically:

- **Local (default / offline / air-gapped):** the app retrieves the best-matching passages from your corpus and quotes them verbatim, grouped by source — no network, no LLM, marked with the hint *"Offline mode — answers are exact passages from your documents."*
- **Gemini (opt-in):** with enrichment enabled and your API key set, the same retrieval feeds Google's Gemini, which streams a synthesized answer token-by-token, with multi-turn memory over the recent conversation.

Either way, every answer carries **source chips**: hover for the match strength and snippet, click to fly to that document in the graph, or use the ↗ icon to open it.

Chat history is intentionally ephemeral — it lives in memory only and clears when the corpus is reset.

## Ask AI about one document

With enrichment enabled, the detail panel gains an **Ask AI** section with three streaming actions: **Summarize** (4–7 sentences), **Outline topics** (hierarchical outline of the whole document), and a free-form **Ask** box answered only from that document. Note the disclosure shown in the panel: these actions send the full document text to Gemini via your API key.

## AI enrichment (optional, off by default)

Settings → **AI Enrichment**. Enrichment adds three things the local pipeline can't: fluent per-document **summaries and topics**, corpus-wide **topic canonicalization** (merging "auth" / "authentication" / "authn" into one topic), and human-quality **cluster names** ("Deployment & Infra" instead of a keyword list). To use it:

1. Paste a **Gemini API key** (yours; stored only in this browser). By default the key is kept for this tab only — check **Remember key on this device** to persist it locally.
2. Turn on **Enable enrichment**.
3. Click **Enrich now**.

Automatic model routing uses `gemini-3.1-flash-lite` for high-volume structured enrichment and `gemini-3.5-flash` for document AI and chat. Settings → **Model override** can pin one custom Gemini model for every task. With enrichment on, document excerpts are sent to Google's Gemini API for the batch pass, and "Ask AI" / chat send the relevant documents' text; with it off (the default), nothing ever leaves the browser. The key travels only as a request header, is never written into exports or the graph cache, and enrichment failures degrade gracefully (you keep the local summaries and names).

## Snapshots

Toolbar → **Saved snapshots**. Type a name (a sensible default is pre-filled) and press **Save** to capture the current graph — documents, layout positions, and state. **Load** any saved snapshot to restore it (target: under 3 seconds), **✕** deletes just the snapshot record. Snapshots reference cached documents rather than duplicating them, so they're cheap to keep.

## Sessions & your data

Everything persists automatically to your browser's IndexedDB: the session saves itself shortly after the graph is ready, and again once the layout settles, so the next launch restores your corpus — same shape, same positions — in a few seconds, fully offline. Re-parsing only happens for new or changed files.

Settings → **Data** → **Clear all data** (two-step confirm) wipes the graph and every cached document, embedding, and snapshot; your settings and API key are kept.

Toolbar -> **Data** opens local export/import tools. **Export graph JSON** downloads the current graph; **Export image PNG** saves the visible scene; **Import graph JSON** loads a previous export and asks for confirmation before replacing a live graph. Settings -> **Export** still controls whether JSON exports include document embeddings for semantic search after re-import.

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

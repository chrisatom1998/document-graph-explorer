# Product surface

Document Graph Explorer should feel like **one tool**, not a dashboard of
tools. This is the architecture for that: a short core loop, studio features
one click down, and packaging kept off the canvas.

## The loop

```
Drop or pick a folder
        ↓
Parse → embed → cluster  (workers, local model)
        ↓
Explore the 3D graph     (2D if the GPU asks)
        ↓
Click to read  ·  ⌘K to search  ·  chat to ask
```

If a feature does not make that loop faster, clearer, or more trustworthy, it
does not get a toolbar button.

The original spec (`knowledge-nebula-spec.md` §1.1) already named this:
zero-friction ingest, meaningful structure, a graph people want open, and
click-to-read. OCR, collaboration, in-app editing, and a second product around
scene interchange were non-goals.

## Layers

| Layer | What belongs here | Default chrome |
|---|---|---|
| **Core** | Ingest, graph, read, search, persist, type/cluster filters, local chat | Always on, or one obvious overlay |
| **Studio** | Path finding, insights, snapshots, saved views, topic hubs, cluster collapse, OCR, enrichment | One **Analyze** / **View** / **Settings** click |
| **Interop** | JSON, PNG, share URL, OpenUSD | **Data** menu only |
| **Packaging** | Air-gap build, desktop wrappers, `usd-agent`, PWA, retrieval eval | Scripts and docs — never first-class UI |

The machine-readable checklist lives in [`src/product/surface.ts`](../src/product/surface.ts).
Add a capability there before adding chrome.

## What was bloating the shell

The toolbar had grown to ~14 first-class actions. Several were the same job
twice:

| Duplicate | Resolution |
|---|---|
| **Show me a topic** vs **Search** | Same retriever. Search already highlights matches; **Show all in graph** frames them and keeps the golden set-pulse. |
| **Saved views** vs **Snapshots** | Views bookmark camera + filters; snapshots freeze the graph. Both stay, both in menus — not two toolbar icons. |
| **Offline toggle** vs **air-gap build** | Behavioral vs sealed. Keep both; do not invent a third privacy mode. |
| **Add files** + **Add folder** | One **Add** menu. Welcome screen still offers both as explicit CTAs. |
| **Path / Insights / Snapshots** | One **Analyze** menu. |
| Filter bar (type, cluster, degree, strength, kinds, recency) | Type + cluster first; the rest behind **More filters**. |
| Settings (AI, OCR, embeddings, export, quota, diagnostics) | Everyday controls stay visible; recognition / export embeddings fold under **Advanced**. |

Satellites that stay in the repo but are **not** the product:

- OpenUSD export + Python pipeline + `usd-agent` — a digital-twin sidecar.
- Four desktop distribution paths (macOS Electron, Windows pkg, Linux AppImage, `run.*` launchers) wrapping one SPA.
- Source-repo ingest, folder watch, multi-corpus — power ingest, not new apps.

Do not delete those in this pass. Hide them from the default story so the
canvas is a map of documents, not a control panel.

## Default chrome

Once a graph is ready:

```
[corpus]  Search  Fit  View ▾  Analyze ▾  Data ▾  Settings  Add ▾
```

- **View** — 2D, topic nodes, collapse clusters, saved views, help/legend
- **Analyze** — path, insights, snapshots
- **Data** — JSON, PNG, share URL, OpenUSD
- **Add** — files, folder

Chat stays a single bubble. Filters stay a single funnel. Help is in View, not
a fifteenth icon.

First-run tour matches that: explore → toolbar → filters → chat. Folder sync
and snapshots are mentioned, not given their own spotlight.

## Later cuts (not this change)

If the tool still feels heavy after this chrome pass, cut in this order:

1. **Promote OpenUSD out of the Data menu** into docs / a hidden gesture — it
   is a specialist export, not daily interchange.
2. **One desktop path.** Keep `npm run build` + `run.sh` / `run.cmd`; treat
   Electron/AppImage as optional packaging, not peer products.
3. **Drop `usd-agent` from the README hero** so the web app is not sold as a
   USD toolchain.
4. **OCR stays advanced** unless scanned-PDF ingest becomes a real user
   story; the spec originally flagged unreadable scans instead.

Do not add: Notion/Confluence export, a plugin API, or a second graph view
until the core loop is the only thing on screen at first run.

# Knowledge Nebula — Technical Specification
### A drag-and-drop 3D mind map for internal documentation

**Version:** 1.0 · **Status:** Draft · **Owner:** Chris

---

## 1. Overview

Knowledge Nebula is a browser-based tool that ingests a user's internal documentation (text files, Markdown, PDFs, and similar), extracts the concepts and relationships inside them, and renders the entire corpus as an explorable, force-directed 3D graph. Documents become nodes; semantic and structural relationships become edges. The experience should feel like flying through a galaxy of your own knowledge, not staring at a org chart someone left in the microwave.

### 1.1 Goals
- **Zero-friction ingestion:** drag files onto the window; parsing and graph construction happen automatically with visible progress.
- **Meaningful structure:** connections must reflect real relationships (shared topics, cross-references, semantic similarity), not random spaghetti.
- **Visually spectacular:** 3D rendering with depth, glow, motion, and cinematic camera work — a tool people *want* to leave open on a second monitor.
- **Actually useful:** click a node → read the source content. Search, filter, and trace connections. Pretty but hollow is a screensaver, not a tool.

### 1.2 Non-goals (v1)
- Multi-user collaboration / real-time sync
- Server-side storage of documents (v1 is fully client-side; privacy by architecture)
- Editing documents inside the tool
- OCR of scanned/image-only PDFs (flag them as "unreadable" instead — see §9 Risks)

---

## 2. User Stories

1. As a user, I drag 40 mixed files (`.txt`, `.md`, `.pdf`) onto the app and within ~30 seconds see a 3D graph of my documentation with progress feedback along the way.
2. As a user, I click any node to open a side panel showing the document's content, extracted topics, and its strongest connections.
3. As a user, I search "authentication" and the graph dims everything except matching nodes and their neighbors, with the camera gliding to frame them.
4. As a user, I hover a node and see its edges light up with animated pulses showing what it connects to and why (shared topic labels on edges).
5. As a user, I toggle clustering to see documents grouped into color-coded thematic constellations.
6. As a user, I export/import the computed graph as JSON so I don't re-parse 200 PDFs every session.

---

## 3. System Architecture

Fully client-side single-page app. No backend required for v1; an optional LLM enrichment call is the only network dependency (and it's toggleable).

```
┌────────────────────────────────────────────────────────┐
│                     Browser (SPA)                      │
│                                                        │
│  ┌──────────┐   ┌───────────┐   ┌──────────────────┐  │
│  │ Ingestion │ → │ Extraction│ → │ Graph Builder    │  │
│  │ Layer     │   │ Pipeline  │   │ (nodes + edges)  │  │
│  └──────────┘   └───────────┘   └────────┬─────────┘  │
│       │               │                   │            │
│  Drag & drop     Web Workers         Graph Store       │
│  File System     (parse + embed)     (state mgmt)      │
│  Access API           │                   │            │
│                       ▼                   ▼            │
│              ┌────────────────┐   ┌──────────────────┐ │
│              │ Optional: LLM  │   │ 3D Render Layer  │ │
│              │ enrichment API │   │ (Three.js/R3F)   │ │
│              └────────────────┘   └──────────────────┘ │
│                                          │             │
│                                   IndexedDB cache      │
└────────────────────────────────────────────────────────┘
```

### 3.1 Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Framework | React 18 + TypeScript + Vite | Fast dev loop, typed graph model |
| 3D | Three.js via **react-three-fiber** + **drei** | Declarative 3D, huge ecosystem |
| Graph layout | **d3-force-3d** (or `three-forcegraph` / `react-force-graph-3d` as a head start) | Battle-tested force simulation in 3 dimensions |
| Post-processing | `@react-three/postprocessing` (Bloom, DoF, Vignette) | The "spectacular" budget lives here |
| PDF parsing | **pdf.js** (Mozilla) | De facto standard, runs in a worker |
| Markdown/text | `unified`/`remark` for structure-aware MD parsing | Headings become sub-topics for free |
| Embeddings (local) | **transformers.js** with `all-MiniLM-L6-v2` (~25 MB, quantized) | Real semantic similarity, no API key, runs in a Web Worker via WASM/WebGPU |
| Enrichment (optional) | Anthropic API (`claude-sonnet-4-6`) | Topic naming, summaries, entity extraction |
| State | Zustand | Simple, plays nicely with R3F render loop |
| Persistence | IndexedDB (via `idb`) | Cache parsed text, embeddings, and graph JSON |

---

## 4. Ingestion Layer

### 4.1 Input methods
- Full-window drag-and-drop overlay (drop anywhere; overlay appears on `dragenter`).
- "Add files" button → file picker (multi-select).
- Folder drop via `webkitGetAsEntry` / File System Access API (recursively walk directories, respect an ignore list: `node_modules`, `.git`, binaries).

### 4.2 Supported types (v1)

| Type | Extensions | Parser |
|---|---|---|
| Plain text | `.txt`, `.log` | direct read |
| Markdown | `.md`, `.mdx` | remark (extract heading tree + links) |
| PDF | `.pdf` | pdf.js text extraction per page |
| HTML | `.html` | DOMParser → visible text |
| Code/config (stretch) | `.json`, `.yaml`, `.csv` | treated as text with type badge |

Unsupported files are listed in an "ignored" tray, not silently dropped.

### 4.3 Pipeline behavior
- All parsing runs in a **Web Worker pool** (n = `navigator.hardwareConcurrency - 1`) so the UI and the 3D scene never jank.
- Progress UI: per-file status (queued → parsing → embedding → placed), overall progress bar, and — because we can — new nodes should *materialize into the graph live* as they finish, flying in from the drop point. Ingestion is the first "wow" moment; don't hide it behind a spinner.
- Per-file limits: cap extracted text at ~200 KB per document for embedding purposes (embed chunks, average or max-pool — see §5.2). Full text still stored for the reader panel.
- Errors (encrypted PDFs, zero-text scans) surface as warning badges on a ghosted node, with the reason on hover.

---

## 5. Extraction Pipeline (the actual hard part)

This is where the tool lives or dies. "Visually spectacular" is a solved problem; "meaningfully connected" is not. The spec defines a layered approach: cheap deterministic signals first, semantic embeddings second, optional LLM enrichment third.

### 5.1 Layer 1 — Structural & lexical signals (free, deterministic)
For each document, extract:
- **Title:** filename (cleaned) or first `# heading` / PDF metadata title.
- **Explicit links:** Markdown links, URLs, and *mentions of other documents' titles/filenames in the text* → these become **hard edges** (highest confidence, rendered brightest).
- **Keywords:** TF-IDF top-N terms across the corpus (compute corpus-wide IDF after all docs parse). Shared rare keywords → **keyword edges**.
- **Named entities (lightweight):** regex/heuristic pass for capitalized multi-word phrases, acronyms, and code identifiers (`CamelCase`, `snake_case`) — these are gold in internal docs.
- **Folder/path structure:** if a folder was dropped, sibling files get a weak "same directory" affinity used as a layout hint, not a visible edge.

### 5.2 Layer 2 — Semantic embeddings (local, private)
- Chunk each document (~512 tokens, 15% overlap), embed each chunk with MiniLM in a worker.
- Document vector = mean of chunk vectors (store chunk vectors too, for search).
- Compute cosine similarity between all doc pairs. **Do not connect everything to everything.** Edge rule: connect doc pairs where similarity ≥ 0.62 **and** the pair is within each doc's top-k (k=5) neighbors. The top-k constraint is what keeps a 300-doc corpus from becoming a hairball.
- Edge weight = normalized similarity; drives edge thickness, glow intensity, and force-layout spring strength.
- Complexity note: pairwise similarity is O(n²) but with 384-dim vectors and n ≤ ~2,000 docs it's milliseconds in a worker. Don't over-engineer with ANN indexes in v1.

### 5.3 Layer 3 — LLM enrichment (optional, network)
Toggleable "Enrich with AI" step. Batched calls (10–20 docs per request) asking for strict JSON:
- 1-sentence summary per doc (for the hover card)
- 3–5 canonical topic labels per doc (merged corpus-wide so "auth", "authentication", and "AuthN" collapse into one topic)
- Cluster names ("Deployment & Infra", "Onboarding") after clustering runs

Failures degrade gracefully: the graph works fully without this layer; enrichment only improves labels and summaries.

### 5.4 Clustering
- Run community detection (Louvain, via `graphology-communities-louvain`) on the final edge set.
- Each community gets a hue; node color = community, node size = degree (log-scaled), so hubs are visibly hubs.
- Optional "topic nodes" mode: materialize shared topics as their own (smaller, octahedral) nodes that documents orbit — turns the doc graph into a doc+concept bipartite constellation. Ship behind a toggle; it's stunning when it works and noisy when topic extraction is weak.

---

## 6. Graph Data Model

```typescript
interface DocNode {
  id: string;              // hash of path + content
  kind: 'document' | 'topic';
  title: string;
  fileType: 'md' | 'txt' | 'pdf' | 'html' | 'other';
  path?: string;
  summary?: string;        // LLM or first ~200 chars
  topics: string[];
  entities: string[];
  wordCount: number;
  cluster: number;         // community id
  degree: number;
  embedding?: Float32Array;    // not serialized to export JSON by default
  chunks?: { text: string; vector: Float32Array }[];
  status: 'ok' | 'partial' | 'unreadable';
}

interface Edge {
  source: string;
  target: string;
  kind: 'reference' | 'semantic' | 'keyword' | 'topic';
  weight: number;          // 0..1
  evidence: string[];      // e.g. ["links to deploy.md", "shared: 'rate limiting'"]
}

interface GraphExport {
  version: 1;
  createdAt: string;
  nodes: DocNode[];        // embeddings stripped unless user opts in
  edges: Edge[];
}
```

`evidence` is non-negotiable: every edge must be able to answer "*why* are these connected?" in the UI. Unexplainable edges destroy trust in the whole graph.

---

## 7. 3D Visualization Layer

### 7.1 Aesthetic direction — "Deep-space observatory"
The corpus is a nebula. Near-black space (#050510 with subtle blue-violet gradient), documents as glowing cores with soft halos, clusters as tinted gas regions, edges as luminous filaments. One disciplined signature effect: **edge pulses** — small packets of light that travel along edges from hovered/selected nodes, showing information "flowing" through the corpus. Everything else stays restrained so the pulses land.

- **Nodes:** instanced sphere meshes (one `InstancedMesh` per cluster for per-cluster color) with emissive material feeding the bloom pass. Size = f(degree). Topic nodes (if enabled) are octahedra.
- **Edges:** single `LineSegments` buffer (or fat lines via `Line2` under ~2k edges). Opacity/brightness = weight. `reference` edges get a distinct warmer tint.
- **Labels:** SDF text sprites (`troika-three-text`), distance-culled — only the nearest ~40 labels render, fading with camera distance. Full labels on hover always.
- **Background:** sparse instanced starfield + very subtle fog for depth cueing.
- **Post-processing:** Bloom (the money shot), gentle vignette, optional depth-of-field when a node is focused. **Cap it there.** Chromatic aberration and film grain are how a data tool becomes a Winamp visualizer.

### 7.2 Layout
- `d3-force-3d`: link force (strength ∝ edge weight), charge repulsion, weak centering, plus per-cluster centroid attraction so communities separate spatially.
- Run simulation hot during ingestion (nodes fly to their homes live), then cool to near-zero alpha. Idle scene keeps a barely-perceptible drift + slow camera orbit so it feels alive without eating GPU.
- Pin/unpin: dragging a node fixes it (`fx/fy/fz`); double-click releases.

### 7.3 Interactions
| Action | Result |
|---|---|
| Hover node | Halo brightens, edges pulse outward, tooltip (title, type, top topics), non-neighbors dim to 15% |
| Click node | Camera glides to frame node (eased, ~800 ms); side panel opens: summary, full text (virtualized), topics, connection list with evidence |
| Click edge | Popover: edge kind, weight, evidence strings |
| Search (⌘K) | Semantic search over chunk vectors + title match; results highlighted, camera frames the result set |
| Filter bar | By file type, cluster, date, min-degree; filtered-out nodes collapse inward and fade |
| Scroll / drag / right-drag | Zoom / orbit / pan (OrbitControls with damping) |
| "Overview" key (Esc/Home) | Camera returns to fit-all framing |
| 2D toggle | Same graph flattened to 2D for the "I actually need to read this" crowd |

### 7.4 Performance budget
- Target: **60 fps at 500 nodes / 3,000 edges** on an M-series laptop or midrange discrete GPU; graceful degradation to 30 fps at 2,000 nodes.
- Techniques: instancing everywhere, layout simulation in a worker (positions transferred via `SharedArrayBuffer` or transferable `Float32Array`), label culling, bloom resolution scaling, pause simulation when tab hidden.
- Auto-quality: if frame time > 22 ms for 2 s, step down (disable DoF → halve bloom res → cap labels → suggest 2D mode). Never let the pretty kill the useful.

---

## 8. UX Flow

1. **Empty state:** dark space, faint starfield, centered prompt: "Drop your docs. Watch them become a universe." (Plus an "Add files" button and a "Load demo corpus" link so the first impression isn't an empty void.)
2. **Ingestion:** files stream in as nodes materializing with a brief flare; progress strip at bottom; connections fade in as similarity computes.
3. **Explore:** free camera, hover/click per §7.3.
4. **Persist:** graph auto-caches to IndexedDB keyed by content hashes (re-dropping the same folder is instant). Export/import `GraphExport` JSON. "Export PNG" button for the inevitable Slack flex.

---

## 9. Risks & Honest Caveats

| Risk | Reality check | Mitigation |
|---|---|---|
| **PDF text extraction is a swamp** | pdf.js gives you text, not *structure*. Multi-column layouts, tables, and headers/footers come out scrambled. Scanned PDFs give you nothing. | Heuristic cleanup (drop repeated header/footer lines, join hyphenated breaks); mark zero-text PDFs `unreadable` with a visible badge. OCR (Tesseract.js) is a v2 stretch, not a v1 promise. |
| **Garbage-in similarity** | Boilerplate-heavy docs (legal footers, templates) will all look "similar" to each other. | Strip near-duplicate boilerplate lines corpus-wide before embedding; TF-IDF weighting already discounts ubiquitous terms. |
| **Hairball graphs** | With loose thresholds, 200 docs → 20,000 edges → unreadable glowing yarn. | Top-k + threshold edge rule (§5.2), edge-count slider in UI, cluster-collapse mode ("show communities as super-nodes"). |
| **Model download weight** | ~25 MB embedding model on first load. | Lazy-load after first drop, cache in browser, show download progress honestly. |
| **3D perf cliff** | Beyond ~2k nodes, even instancing + bloom struggles on integrated GPUs. | Auto-quality ladder (§7.4) + first-class 2D fallback. |
| **"Spectacular" vs. usable** | Every post-processing pass costs legibility. | Bloom + pulses are the entire effects budget. Ruthlessly cut anything that makes labels harder to read. |

---

## 10. Build Plan (phased)

**Phase 1 — Skeleton (the boring miracle):** drag-drop → parse txt/md → TF-IDF keyword edges → basic 3D force graph with orbit controls, hover, click-to-read panel. *Fully useful, zero glamour.*

**Phase 2 — Brains:** pdf.js in workers, transformers.js embeddings, similarity edges with top-k rule, semantic search, Louvain clustering + cluster colors, IndexedDB cache + JSON export.

**Phase 3 — Spectacle:** bloom + halos, edge pulses, live materialize-on-ingest animation, camera choreography, label culling, starfield, auto-quality ladder.

**Phase 4 — Polish & stretch:** LLM enrichment (summaries, canonical topics, cluster names), topic-node mode, 2D toggle, folder watching via File System Access API, OCR investigation.

Build in this order and you have something useful after Phase 1 and something demo-able after Phase 3. Build Phase 3 first and you have a very pretty way to look at nothing.

---

## 11. Acceptance Criteria (v1)

- [ ] Drop 50 mixed files → complete graph in < 45 s on a mid-tier laptop, with live progress
- [ ] Every rendered edge shows human-readable evidence on inspection
- [ ] Click any node → full source text readable in panel
- [ ] Semantic search returns relevant docs for a query term that appears in *zero* titles
- [ ] 60 fps sustained at 500 nodes on target hardware; auto-degrades gracefully
- [ ] Encrypted/scanned PDFs produce visible warnings, never silent gaps
- [ ] Full session restores from cache in < 3 s on revisit
- [ ] Works with zero network access (enrichment off)

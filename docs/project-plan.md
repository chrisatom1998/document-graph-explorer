# Document Graph Explorer — Project Plan

**Owner:** Chris Johnson  
**Status:** Active Development (v1)  
**Last Updated:** July 2, 2026

---

## Executive Summary

Document Graph Explorer is a browser-based tool that transforms internal documentation into an interactive, explorable 3D knowledge graph. Users drag files onto the window and instantly see their documentation visualized as a living constellation — with meaningful connections based on shared topics, cross-references, and semantic similarity.

The tool runs **entirely client-side** (zero server cost, zero data exposure), making it uniquely suited for teams working with sensitive internal documentation.

### The Problem It Solves

| Pain Point | Impact |
|---|---|
| **Documentation sprawl** | Teams produce 100s of docs across Markdown, PDFs, text files — no one knows what connects to what |
| **Knowledge silos** | Critical cross-references between docs are invisible; teams duplicate work or miss dependencies |
| **Onboarding friction** | New team members can't "see the shape" of a project's knowledge — they read docs linearly when the relationships are a graph |
| **Search isn't enough** | Keyword search finds individual docs but doesn't reveal *relationships* between them |

### The Business Value

1. **Reduced onboarding time** — New team members can explore the full knowledge landscape visually in minutes instead of reading docs serially over days.
2. **Surfaced hidden connections** — Semantic similarity and keyword analysis reveal relationships that no one documented explicitly.
3. **Zero infrastructure cost** — Runs entirely in-browser. No server, no database, no cloud storage, no ongoing costs.
4. **Privacy by architecture** — Documents never leave the user's browser (unless optional AI enrichment is enabled). Suitable for sensitive/internal documentation.
5. **Session persistence** — Named snapshots let users save and restore graph states, enabling version-tracked exploration of evolving documentation.

---

## Target Users

| Persona | Use Case |
|---|---|
| **Engineering leads** | Visualize how architecture docs, runbooks, and design proposals relate; identify gaps |
| **Product managers** | Map PRDs, specs, and research docs to see feature interdependencies |
| **New hires / onboarding** | Get a spatial mental model of the team's knowledge base on day one |
| **Technical writers** | Audit doc coverage — which topics are over-documented vs. orphaned |
| **Security / compliance** | Quickly map policy documents and find undocumented dependencies |

---

## Key Capabilities (v1)

### Ingestion
- Drag-and-drop files or folders (`.md`, `.txt`, `.pdf`, `.html`, `.docx`, `.pptx`, `.xlsx`, and `.json`/`.yaml`/`.csv` as text)
- Real-time progress with nodes materializing live into the 3D scene
- Web Worker pool ensures zero UI jank during processing

### Intelligence
- **Structural analysis**: extracts titles, headings, cross-references, entities
- **TF-IDF keyword edges**: shared rare terms create connections
- **Semantic embeddings**: local BGE small model (no API needed) computes document similarity
- **Community detection**: Louvain clustering groups related documents into color-coded constellations
- **Optional AI enrichment**: Gemini API for summaries, canonical topics, cluster names

### Visualization
- 3D force-directed graph with cinematic bloom, edge pulses, and camera choreography
- Click-to-read side panel with full document text
- Semantic search (⌘K) that finds relevant docs even without keyword matches
- Filter by file type, cluster, or connectivity

### Distribution & Security
- **Air-gapped build** (`npm run build:airgap`): zero external network, enforced by a host-free CSP, runtime refusal, and a post-build verify gate. See [SECURITY.md](../SECURITY.md).

### Persistence & Snapshots
- Auto-caches sessions to IndexedDB — revisiting is instant (<3s for 200 docs)
- **Named snapshots**: save the current graph state with a name, restore any past snapshot
- Export/import JSON for sharing graphs across machines
- PNG export for presentations

---

## Success Metrics

| Metric | Target | How Measured |
|---|---|---|
| Time to first useful graph | < 30s for 50 files | Stopwatch from first file drop to fully rendered graph |
| Session restore speed | < 3s for 200 docs | IndexedDB read + layout hydration time |
| Rendering performance | 60 fps at 500 nodes | Auto-quality system + Chrome DevTools profiling |
| User retention signal | Users create ≥2 snapshots per corpus | IndexedDB snapshot count |

---

## Technical Architecture

```
┌──────────────────────────────────────────────────┐
│                  Browser (SPA)                    │
│                                                   │
│  ┌──────────┐  ┌───────────┐  ┌───────────────┐  │
│  │ Ingestion│→ │ Extraction│→ │ Graph Builder │  │
│  │ (D&D)    │  │ Pipeline  │  │ (nodes+edges) │  │
│  └──────────┘  └───────────┘  └───────┬───────┘  │
│       │              │                 │          │
│  File System    Web Workers      Zustand Store    │
│  Access API     (parse+embed)         │          │
│                      │                ▼          │
│              ┌──────────────┐  ┌──────────────┐  │
│              │ Optional:    │  │ Three.js/R3F │  │
│              │ Gemini API   │  │ 3D Renderer  │  │
│              └──────────────┘  └──────────────┘  │
│                                       │          │
│                    IndexedDB (cache + snapshots)  │
└──────────────────────────────────────────────────┘
```

**Stack:** React 19, TypeScript, Vite, Three.js (react-three-fiber), d3-force-3d, transformers.js, Zustand, IndexedDB (idb)

---

## Roadmap

### Phase 1 ✅ — Skeleton
Drag-drop → parse → keyword edges → basic 3D force graph → click-to-read panel

### Phase 2 ✅ — Intelligence
PDF parsing, semantic embeddings, similarity edges, search, clustering, IndexedDB cache

### Phase 3 ✅ — Spectacle
Bloom, edge pulses, live materialization, camera choreography, starfield, auto-quality

### Phase 4 (Current) — Polish & Persistence
- ✅ AI enrichment (Gemini summaries, topics, cluster names)
- ✅ Named snapshots (save/load/delete)
- ✅ Document removal & re-indexing
- ☐ Folder watching via File System Access API
- ✅ 2D toggle mode

### Phase 5 (Future) — Collaboration & Scale
- ☐ Shareable snapshot URLs (via exported JSON hosting)
- ☐ Comparative diff view between two snapshots
- ☐ OCR for scanned PDFs (Tesseract.js)
- ☐ Multi-corpus workspaces

---

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| PDF text extraction quality varies | Heuristic cleanup + visible "unreadable" badges on failed extracts |
| Boilerplate docs all look "similar" | TF-IDF weighting discounts ubiquitous terms; top-k neighbor constraint prevents hairball graphs |
| 3D performance degrades at scale | Auto-quality ladder (bloom → label culling → 2D fallback) |
| 25MB embedding model download | Lazy-load after first drop, cache in browser, honest progress indicator |
| IndexedDB quota limits on large corpora | Graceful degradation — app works without persistence |

---

## Related Documents

- [Technical Specification](../knowledge-nebula-spec.md) — Full engineering spec (data model, pipeline, visualization details)
- [Feature Playbook: Snapshots](./feature-playbook-snapshots.md) — Detailed playbook for the snapshot/save feature
- [Product Roadmap](./product-roadmap.md) — Quarter-level roadmap with milestones

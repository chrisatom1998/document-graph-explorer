# Document Graph Explorer — Product Roadmap

**Owner:** Chris Johnson  
**Last Updated:** July 2, 2026

---

## Vision

Make internal documentation **explorable, connected, and alive** — transforming static file collections into interactive knowledge landscapes that teams can navigate, search, and share.

---

## Q3 2026 — Foundation & Intelligence ✅

> *Goal: Ship a fully functional client-side tool that turns file drops into meaningful 3D knowledge graphs.*

### Milestones

| Milestone | Status | Date |
|---|---|---|
| Drag-and-drop ingestion with live progress | ✅ Shipped | June 2026 |
| Multi-format parsing (MD, TXT, PDF, HTML, DOCX, PPTX, XLSX) | ✅ Shipped | June 2026 |
| TF-IDF keyword extraction + lexical edges | ✅ Shipped | June 2026 |
| Local semantic embeddings (MiniLM, WebGPU) | ✅ Shipped | June 2026 |
| Semantic similarity edges with top-k constraint | ✅ Shipped | June 2026 |
| Louvain community detection + cluster coloring | ✅ Shipped | June 2026 |
| 3D force-directed layout (d3-force-3d in worker) | ✅ Shipped | June 2026 |
| Cinematic post-processing (bloom, edge pulses, starfield) | ✅ Shipped | June 2026 |
| Click-to-read side panel with full document text | ✅ Shipped | June 2026 |
| Semantic search (⌘K) | ✅ Shipped | June 2026 |
| IndexedDB session caching (<3s restore) | ✅ Shipped | June 2026 |
| JSON export/import | ✅ Shipped | June 2026 |
| Auto-quality ladder (60fps target) | ✅ Shipped | June 2026 |
| AI enrichment via Gemini (summaries, topics, cluster names) | ✅ Shipped | July 2026 |
| Named snapshots (save/load/delete) | ✅ Shipped | July 2026 |
| Corpus insights panel | ✅ Shipped | July 2026 |
| Document removal | ✅ Shipped | July 2026 |
| Air-gapped build (`build:airgap`) with enforced zero-egress CSP | ✅ Shipped | July 2026 |

### Key Results
- **50 files → useful graph in <30s** on mid-tier hardware
- **Session restore <3s** for 200-doc corpora
- **60fps sustained** at 500 nodes on Apple Silicon / discrete GPU
- **Zero server infrastructure** — fully client-side, privacy by architecture

---

## Q4 2026 — Collaboration & Polish

> *Goal: Make graphs shareable and the tool usable by non-technical users.*

### Planned Features

| Feature | Priority | Business Value |
|---|---|---|
| **Snapshot diff view** | High | Compare two snapshots visually — see what docs/connections changed over time. Enables documentation health tracking. |
| **Shareable snapshot URLs** | High | Export a snapshot to a hosted JSON file and generate a shareable link. Enables team-wide access without re-ingesting. |
| **2D toggle mode** | Medium | Some users prefer 2D for readability. Flat layout with the same clustering and interactions. |
| **Folder watching** | Medium | File System Access API monitors a folder for changes and auto-re-indexes. Living graph that stays current. |
| **Guided onboarding tour** | Medium | Interactive walkthrough for first-time users — drag, search, explore. Reduces support burden. |
| **Keyboard navigation** | Low | Full keyboard support for navigating nodes, edges, and panels. Accessibility compliance. |

---

## H1 2027 — Scale & Enterprise Readiness

> *Goal: Handle large corpora (2000+ docs) and support team workflows.*

### Planned Features

| Feature | Priority | Business Value |
|---|---|---|
| **Multi-corpus workspaces** | High | Manage multiple documentation sets (per-project, per-team) without cross-contamination |
| **OCR for scanned PDFs** | High | Tesseract.js integration unlocks scanned documents — common in legal, compliance, and legacy orgs |
| **Annotation layer** | Medium | Users can add notes, tags, and bookmarks to nodes — personal knowledge overlaid on team docs |
| **Comparative analytics** | Medium | Quantitative comparison between snapshots: "12 new docs, 3 removed, 47 new connections since last month" |
| **Export to Notion/Confluence** | Low | Push graph structure and summaries into existing wiki platforms |
| **Plugin API** | Low | Allow custom parsers, enrichment providers, and visualization modes |

---

## Strategic Themes

### 1. Privacy-First Architecture
Document Graph Explorer's client-side architecture is a **competitive differentiator**. Enterprises with sensitive documentation (legal, financial, healthcare) need tools that don't require uploading documents to third-party servers. Every feature is designed to work fully offline.

### 2. Intelligence Without API Keys
Local semantic embeddings (transformers.js) provide real AI-powered connections without requiring users to configure API keys or incur per-request costs. The optional Gemini enrichment adds value but is never required.

### 3. Visual-First Knowledge Management
Traditional documentation tools are text-first. Document Graph Explorer inverts this — the primary interface is spatial and visual. Users build a mental model of their documentation landscape through exploration, not reading.

### 4. Zero-Friction Adoption
No accounts, no installations, no configuration. Drop files → see your knowledge. This removes the biggest barrier to adoption for internal tools.

---

## Dependencies & Risks

| Dependency | Risk Level | Mitigation |
|---|---|---|
| WebGPU browser support (for fast embeddings) | Low | Falls back to WASM backend; performance degrades gracefully |
| IndexedDB quota limits | Medium | Large corpora (1000+ docs with embeddings) may hit ~500MB limits on some browsers. Future: offer selective caching. |
| pdf.js text extraction quality | Medium | Some PDFs produce poor text. Clear user feedback via "unreadable" badges. OCR planned for H1 2027. |
| Gemini API pricing changes | Low | Enrichment is optional. Core tool works without any API. |

---

## Related Documents

- [Project Plan](./project-plan.md) — Business context, users, capabilities, success metrics
- [Feature Playbook: Snapshots](./feature-playbook-snapshots.md) — Detailed playbook for save/load snapshots
- [Technical Specification](../knowledge-nebula-spec.md) — Full engineering spec

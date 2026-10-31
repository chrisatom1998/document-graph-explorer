# Project: Document Graph Explorer Full-Spectrum Technical Audit

## Architecture & Audit Scope
A full-spectrum, line-level technical audit of the Document Graph Explorer client-side web application across four core pillars:
1. **R1: Architecture, Code Quality & State Management**
   - Zustand stores partitioning vs raw runtime caches (`runtimeStores.ts`)
   - State synchronization mechanics and race conditions
   - Serialized execution queuing (`runQueue.ts`)
   - React error boundaries and resilience
   - Multi-tab synchronization and IndexedDB/localStorage persistence lifecycle safety
2. **R2: Ingestion Pipeline, Web Workers & Performance**
   - Document parsing: PDF (`pdfjs`), DOCX (`mammoth`/`fast-xml-parser`), Markdown, OCR (`tesseract.js`)
   - Embedding worker pools (`bge-small-en-v1.5`), ONNX/Wasm runtime configuration & model caching
   - 3D force layout simulation throughput (`d3-force-3d` in worker)
   - Transferable buffer allocations vs structured clone overhead
   - Search indexing / vector similarity retrieval efficiency
3. **R3: 3D Scene Graph, Rendering & UI/UX**
   - Three.js / React Three Fiber rendering loops & frame budgeting
   - Draw-call batching, instanced meshes (`InstancedMesh`), line segments
   - GPU memory cleanup/lifecycle (geometry/material/texture disposal)
   - Camera transition responsiveness, raycasting overhead
   - Keyboard navigation, canvas focus management, and UI accessibility (a11y/WCAG)
4. **R4: Test Coverage, CI/CD & Airgap Verification**
   - Vitest test suite analysis and blind spots (worker bridges, 3D scene components)
   - Typecheck and ESLint rigor
   - Airgap security compliance, CSP headers, external network call prevention
   - Execution and validation of baseline checks: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`

## Feature Inventory
| # | Feature / Subsystem | Description | Milestone / Area | Source | Status |
|---|---------------------|-------------|------------------|--------|--------|
| 1 | Zustand Stores & Runtime Stores | State partitioning, reactivity, memory lifecycle | R1 | ORIGINAL_REQUEST §R1 | DONE |
| 2 | runQueue.ts & Concurrency | Ingest serialization, cancellation, queue safety | R1 | ORIGINAL_REQUEST §R1 | DONE |
| 3 | Persistence & Multi-tab | IndexedDB persistence, schema migrations, cross-tab safety | R1 | ORIGINAL_REQUEST §R1 | DONE |
| 4 | Parser Pipeline (PDF/DOCX/MD/OCR) | Parser robustness, memory spikes, fallbacks | R2 | ORIGINAL_REQUEST §R2 | DONE |
| 5 | Embedding Worker Pool & ONNX | ONNX Wasm init, batching, transferable buffers | R2 | ORIGINAL_REQUEST §R2 | DONE |
| 6 | 3D Force Simulation | Force-directed layout compute, worker coordination | R2 | ORIGINAL_REQUEST §R2 | DONE |
| 7 | Search & Vector Retrieval | Client-side vector search, cosine similarity perf | R2 | ORIGINAL_REQUEST §R2 | DONE |
| 8 | Three.js / R3F Render Loop | Frame rate, instancing, draw call reduction | R3 | ORIGINAL_REQUEST §R3 | DONE |
| 9 | GPU Resource Disposal | Memory leaks, geometry/material disposal | R3 | ORIGINAL_REQUEST §R3 | DONE |
| 10 | Interaction & Accessibility | Camera controls, raycasting, keyboard & screen reader a11y | R3 | ORIGINAL_REQUEST §R3 | DONE |
| 11 | Vitest Suite & Gaps | Unit/integration test coverage, mock realism | R4 | ORIGINAL_REQUEST §R4 | DONE |
| 12 | CI/CD, Airgap & Security | CSP, external fetch leak audit, build verification | R4 | ORIGINAL_REQUEST §R4 | DONE |
| 13 | Baseline Verification | Executing lint, typecheck, test, build | R4 / Baseline | Acceptance Criteria | DONE |
| 14 | Master Audit Report Synthesis | Producing comprehensive AUDIT_REPORT.md | Synthesis | Acceptance Criteria | DONE |

## Milestones
| # | Name | Scope | Dependencies | Status | Output Artifact |
|---|------|-------|-------------|--------|-----------------|
| M1 | R1 Investigation | Deep dive into architecture, state management, concurrency | none | DONE | `.agents/explorer_r1/handoff.md` |
| M2 | R2 Investigation | Deep dive into ingestion pipeline, workers, ONNX, force layout | none | DONE | `.agents/explorer_r2/handoff.md` |
| M3 | R3 Investigation | Deep dive into 3D scene graph, Three.js/R3F, a11y | none | DONE | `.agents/explorer_r3/handoff.md` |
| M4 | R4 & Baseline Checks | Deep dive into test coverage, airgap security + run baseline commands | none | DONE | `.agents/explorer_r4/handoff.md`, `.agents/worker_baseline/handoff.md` |
| M5 | Master Audit Report Synthesis | Synthesize findings into AUDIT_REPORT.md with scorecard, line-level diffs, roadmap | M1, M2, M3, M4 | DONE | `AUDIT_REPORT.md` |
| M6 | Final Verification & Delivery | Review AUDIT_REPORT.md against all criteria and deliver to parent | M5 | DONE | Master Audit Handoff |

## Code Layout
- `src/`
  - `components/`: UI components, modals, overlays, panels
  - `graph/`: 3D scene, Three.js/R3F components, graph rendering, camera controls
  - `pipeline/`: Ingestion coordinator, parsers, embedding client, worker bridges
  - `workers/`: Web workers for parsing, embedding (Transformers.js / ONNX), clustering, force layout
  - `state/` or `store/`: Zustand stores, runtime store caches, event queues
  - `utils/`: Math, geometry, vector search, formatters
- `public/`: Static assets, bundled embedding models, ONNX wasm binaries
- `tests/`: Vitest test suites

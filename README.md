# Document Graph Explorer

A drag-and-drop **3D mind map for your documents**. Drop a folder of text, Markdown, PDF, HTML, or Word/PowerPoint/Excel files onto the window and Document Graph Explorer parses them, extracts topics and relationships, and renders the whole corpus as an explorable force-directed 3D graph — documents become nodes, semantic and structural relationships become edges.

**Local-first and private by architecture.** Parsing, embeddings, similarity, and clustering all run in your browser (in web workers, with a self-hosted embedding model). Your documents never leave the tab. The only optional network call is Gemini enrichment, which is off by default and requires you to supply your own API key — enforced in production by a strict Content-Security-Policy (see [vite.config.ts](vite.config.ts)).

## Quick start

```bash
npm install      # install dependencies
npm run dev      # start the Vite dev server
```

Then open the printed local URL and drag documents onto the window. A demo corpus auto-loads on first visit.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server with HMR |
| `npm run build` | Type-check (`tsc --noEmit`) then production build |
| `npm run typecheck` | Type-check only |
| `npm test` | Run the unit test suite once (Vitest) |
| `npm run test:watch` | Run tests in watch mode |
| `npm run preview` | Preview the production build locally |

## Builds

| Command | Output | Network |
| --- | --- | --- |
| `npm run build` | `dist/` | Fully local by default; optional opt-in Gemini enrichment |
| `npm run build:airgap` | `dist-airgap/` | **Zero external network** — host-free CSP + runtime refusal + post-build verify gate |

See [SECURITY.md](SECURITY.md) for the full privacy guarantee and how to verify it.

### Run it (no dev tools)

Once you've built the air-gapped bundle (`npm run build:airgap`), you can open it without Node, npm, or a terminal each time:

1. Build once: `npm run build:airgap`
2. Double-click `run.cmd` (Windows) or `run.command` (macOS) — or run `./run.sh` on Linux.

This starts a small localhost-only static server (Node built-ins only, no dependencies) and opens the app in your default browser. It requires only Node.js to be installed; it serves `dist-airgap/` on `127.0.0.1` and is never reachable from your LAN.

## How it works

Ingestion is a pipeline that runs off the main thread:

**parse → boilerplate strip → chunk → tokenize → TF-IDF → embeddings → similarity links → Louvain clustering → topic synthesis**

- **Parsing** ([src/pipeline/parsers/](src/pipeline/parsers/)) handles Markdown, HTML, plain text, PDF (including link annotations), and Office formats (DOCX, PPTX, XLSX).
- **Embeddings** use a self-hosted `all-MiniLM-L6-v2` model in [public/models/](public/models/) via transformers.js — no third-party API.
- **The 3D scene** ([src/scene/](src/scene/)) is React Three Fiber over Three.js, with instanced nodes/edges, a force-directed layout worker, and a cluster-collapse view for large graphs.
- **State** lives in Zustand stores ([src/store/](src/store/)); the computed graph persists to IndexedDB so you don't re-parse every session, and can be exported/imported as JSON.

For the full design, see [knowledge-nebula-spec.md](knowledge-nebula-spec.md) and [docs/](docs/).

## Tech stack

React 19 · React Three Fiber / Three.js · TypeScript · Vite · Zustand · Web Workers · transformers.js · graphology (Louvain) · IndexedDB (idb) · Vitest.

## Testing

```bash
npm test
```

Unit tests cover the pure pipeline modules (tokenize, TF-IDF, similarity, links, chunker, parsers), graph algorithms (clustering names, insights, pathfinding), import validation/sanitization, the export embedding round-trip, and the graph store. Tests run under Vitest in a Node environment.

## Deployment notes

Production hosting must send the security headers Vite applies in dev/preview (`X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`) and ideally the CSP as a response header too — see the comments in [vite.config.ts](vite.config.ts).

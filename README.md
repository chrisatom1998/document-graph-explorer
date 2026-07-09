# Document Graph Explorer

A drag-and-drop **3D mind map for your documents**. Drop a folder of text, Markdown, PDF, HTML, or Word/PowerPoint/Excel files onto the window and Document Graph Explorer parses them, extracts topics and relationships, and renders the whole corpus as an explorable force-directed 3D graph — documents become nodes, semantic and structural relationships become edges.

**Local-first and private by architecture.** Parsing, embeddings, similarity, and clustering all run in your browser (in web workers, with a self-hosted embedding model). Your documents never leave the tab. The only optional network call is Gemini enrichment, which is off by default and requires you to supply your own API key — enforced in production by a strict Content-Security-Policy (see [vite.config.ts](vite.config.ts)).

## Quick start

```bash
npm install      # install dependencies
npm run dev      # start the Vite dev server
```

Then open the printed local URL and drag documents onto the window — or click **Load demo corpus** on the welcome screen to explore instantly.

### Run with Docker

```bash
docker compose up --build
```

Then visit `http://localhost:8080`. The optional Windows `.exe` download at `/downloads/` is served from a read-only bind mount of `docker/downloads/` (populate it with `npm run build:exe`); the folder is checked in empty and safe to leave that way.

**New here? Read the [User Guide](docs/user-guide.md)** — why the tool is valuable, what it can do, and a walkthrough of every feature.

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
| `npm run build:desktop` | `release/mac-arm64/Knowledge Nebula.app`, installed to `/Applications` | Normal app build wrapped as a local macOS desktop executable |
| `npm run dist:mac` | `Knowledge Nebula-<version>-arm64.dmg` and `.zip` under `release/` | Distributable macOS installer images (see [Distributing the app](#distributing-the-app-dmg)) |
| `npm run build:exe` | `release/win/` (`run.exe` + `dist/`, branded with the app icon) | Windows executable — see [Windows executable (.exe)](#windows-executable-exe) |

See [SECURITY.md](SECURITY.md) for the full privacy guarantee and how to verify it.

## Desktop app

Build a macOS app bundle from the normal production build (run on a Mac):

```bash
npm install
npm run build:desktop
```

That produces `release/mac-arm64/Knowledge Nebula.app` and copies it to `/Applications` so it shows up in Launchpad and Spotlight. This is the **local install** path — nothing is packaged for other machines.

### Distributing the app (dmg)

To package the app for other Macs, build the installer images instead:

```bash
npm run dist:mac
```

This produces `Knowledge Nebula-<version>-arm64.dmg` (drag-to-Applications installer) and a matching `.zip` under `release/`. Both targets must be built on macOS.

Distribution caveats:

- **Gatekeeper**: the build is only ad-hoc signed. On another Mac, recipients must right-click → **Open** (or approve it under System Settings → Privacy & Security → **Open Anyway**) the first time. For friction-free distribution you need an Apple Developer ID certificate plus notarization — electron-builder automates both once `CSC_LINK`/`CSC_KEY_PASSWORD` and a `notarize` config are provided.
- **Architecture**: the output is Apple Silicon (`arm64`) only. For Intel Macs, add `--universal` (larger binary) or build a separate `x64` artifact.

### Run it (no dev tools)

Once you've built the app (`npm run build`), you can open it without npm or a terminal each time:

1. Build once: `npm run build`
2. Double-click `run.cmd` (Windows) or `run.command` (macOS) — or run `./run.sh` on Linux.

This starts a small localhost-only static server (Node built-ins only, no dependencies) and opens the app in your default browser. It requires only Node.js to be installed; it serves the normal `dist/` build on `127.0.0.1` and is never reachable from your LAN.

To run the sealed air-gapped build instead, build it once (`npm run build:airgap`) and pass `--airgap` to the launcher: `run.cmd --airgap` (Windows) or `./run.sh --airgap` / `./run.command --airgap` (macOS/Linux) — or directly, `node scripts/serve.mjs --airgap`.

### Launch it from your desktop (Windows)

To get a double-clickable **"Document Graph Explorer"** icon on your desktop, run once:

```
npm run install:desktop
```

This drops a desktop shortcut (with the app icon) that points back at `run.cmd` in this repo — no separate executable is installed, so there's nothing for endpoint security to flag, and the shortcut keeps working as the repo updates. Add `-Airgap` to the script for a shortcut that launches the sealed build: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install-desktop-shortcut.ps1 -Airgap`.

The icon is generated from `public/icon.svg` into `packaging/document-graph-explorer.ico` (regenerate with `scripts/make-app-icon.ps1` if the brand icon changes). On macOS, drag `run.command` to your Dock, or right-click it on the desktop → **Make Alias** and move the alias where you like (the first launch needs a right-click → **Open** to clear Gatekeeper).

### Windows executable (.exe)

For a single, double-clickable file that needs no Node.js install on the target machine:

```bash
npm run build:exe
```

This produces a self-contained `release/win/` folder:

```
release/win/
├── run.exe   <- standalone Windows binary (double-click to launch)
└── dist/     <- the built web app, served by run.exe
```

`run.exe` is a standalone Windows binary (built with [`@yao-pkg/pkg`](https://github.com/yao-pkg/pkg), a Node.js runtime bundled with the app) that serves the `dist/` folder sitting next to it on `127.0.0.1` and opens it in the default browser, with the app icon and file metadata (product name, version, description) embedded in the executable via [`resedit`](https://www.npmjs.com/package/resedit) so it shows the branded graphic icon in Explorer, the taskbar, and the title bar — not the generic Node.js icon.

To ship it to another Windows machine, copy (or zip) the whole `release/win/` folder — `run.exe` must stay next to its `dist/` folder.

Notes:

- `run.exe` can be built from Linux, macOS, or Windows (cross-compilation), but requires Node.js ≥ 22 on the machine doing the build. The target machine needs nothing installed.
- `release/` is gitignored — build it locally or in CI whenever you need to (re)distribute it; it isn't committed to the repo.
- The embedded icon is the same `packaging/document-graph-explorer.ico` used for the desktop shortcut (see above); regenerate that file first if you want a different icon before running `build:exe`.
- Like any unsigned executable, Windows SmartScreen may warn on first run ("Windows protected your PC") — click **More info → Run anyway**. Code-signing removes this warning but requires a paid certificate and is out of scope here.

## How it works

Ingestion is a pipeline that runs off the main thread:

**parse → boilerplate strip → chunk → tokenize → TF-IDF → embeddings → similarity links → Louvain clustering → topic synthesis**

- **Parsing** ([src/pipeline/parsers/](src/pipeline/parsers/)) handles Markdown, HTML, plain text, PDF (including link annotations), and Office formats (DOCX, PPTX, XLSX).
- **Embeddings** use a self-hosted `bge-small-en-v1.5` model in [public/models/](public/models/) via transformers.js — no third-party API.
- **The 3D scene** ([src/scene/](src/scene/)) is React Three Fiber over Three.js, with instanced nodes/edges, a force-directed layout worker, and a cluster-collapse view for large graphs.
- **State** lives in Zustand stores ([src/store/](src/store/)); the computed graph persists to IndexedDB so you don't re-parse every session. (JSON export/import is implemented in [src/persistence/exportImport.ts](src/persistence/exportImport.ts) but not yet exposed in the UI.)

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

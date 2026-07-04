# Office/PDF Sample Data + Open-Original-File — Design (2026-07-04)

Two connected asks:

1. The demo corpus should include real **.pptx, .docx, and .pdf** files (the
   office parser and `docx`/`pptx`/`xlsx` file types just landed).
2. "Opening" a document must hand the user the **exact original file** —
   byte-for-byte — so it opens in whatever default application they've chosen
   for that type (PowerPoint, Word, Acrobat, …), not a re-rendered text
   extraction.

## Constraints & platform reality

- A browser cannot invoke an OS "open with default app" directly (that's the
  sandbox working as intended). The closest faithful behavior — and what this
  design implements — is handing the browser the original bytes as a download
  with the correct filename and MIME type: the file lands on disk unmodified
  and the OS file association (the user's chosen default app) opens it.
  Chromium's "Always open files of this type" makes that a zero-extra-click
  flow after the first download.
- Privacy stance is untouched: originals are stored in the same local
  IndexedDB as extracted text, never leave the browser, and are covered by
  the existing "Clear cached data" wipe.
- The working tree has substantial in-flight WIP (entity links, office
  parser, document viewer). This design *builds on* the WIP (office parser,
  viewer) without rewriting any of it.

## 1. Sample files (public/demo/)

Nine files, thematically consistent with the existing engineering-org corpus
so they cluster naturally and form keyword/entity/semantic edges:

| File | Ties into |
| --- | --- |
| `q3-platform-roadmap-review.pptx` | product-roadmap, feature-flags, canary-deployments |
| `incident-response-training.pptx` | incident-runbook, oncall-rotation, post-mortem-guide |
| `architecture-all-hands.pptx` | architecture-overview, kafka-event-bus, postgres-operations |
| `security-audit-report.docx` | vuln-scanning, penetration-testing, soc2-compliance |
| `postgres-upgrade-plan.docx` | postgres-operations, postgres-replication, database-backups |
| `team-offsite-summary.docx` | team-topologies, rfc-process, product-roadmap |
| `soc2-type2-audit-letter.pdf` | soc2-compliance, audit-logging |
| `quarterly-business-review.pdf` | usage-billing, customer-onboarding, billing-alerts |
| `employee-benefits-overview.pdf` | onboarding, developer-handbook |

Generation (one-off, artifacts committed; generators live in the session
scratchpad, not the repo):

- **.docx / .pptx** — python-docx / python-pptx in a scratchpad venv. These
  libraries produce packages Word/PowerPoint open cleanly (proper content
  types, masters/layouts, core properties). Each file gets a real
  `dc:title`, Heading-styled sections (the parser promotes those to
  headings), 300–600 words of body text, and a few hyperlinks.
- **.pdf** — headless Chrome `page.pdf()` from styled HTML: true text layer
  for pdf.js extraction, document title in metadata.

All nine are added to `public/demo/manifest.json`.

## 2. Demo loader must be binary-safe

`loadDemoCorpus()` currently does `fileRes.text()` and re-encodes — that
corrupts any binary format. Change: fetch **`arrayBuffer()`** for every file
(text formats are unaffected; ingest wants bytes anyway). This is the one
change this feature needs inside the WIP-touched `coordinator.ts` ingest
path's demo loader.

## 3. Original-bytes retention ("originals")

Nothing keeps original bytes today — ingest *transfers* the buffer to the
parser worker (detaching it). New module `src/persistence/originals.ts`:

- IndexedDB store `originals` (schema v2 → v3 in `db.ts`):
  `{ hash, name, mime, blob }` — the Blob holds the exact bytes.
- API: `putOriginalIfMissing(hash, name, blob)`, `getOriginal(hash)`,
  `deleteOriginals(hashes)`. Quota failures degrade exactly like the rest of
  the cache layer (warn-once toast, feature falls back).
- Per-file cap: 50 MB — beyond that the original isn't stored and Open falls
  back to the text viewer.

Wiring (all in `coordinator.ts`):

- `runIngest` step (b): after hashing, wrap the incoming bytes in a
  `Blob` **before** the buffer is transferred; after the node is placed
  (parse success or cache hit), fire-and-forget `putOriginalIfMissing`.
  Duplicate drops backfill an original that's missing (e.g. docs cached
  before this feature).
- `runRemove`: `deleteOriginals(removing)` alongside `deleteDocsFromCache`.
- `clearAllCaches` (cache.ts): also clears `originals`.
- Session restore needs nothing: originals are fetched lazily by id.

Imported graph JSON carries no originals (unchanged format) — restored
imports fall back to the text viewer until the file is re-dropped.

## 4. Open = the exact file

`SidePanel`'s Open button (currently → styled text viewer) becomes:

1. `getOriginal(node.id)` → hit: object-URL + anchor click with
   `download={original filename}` and the correct MIME — the exact bytes
   land in the user's downloads and open with their default app. A one-time
   toast explains the browser handoff ("tip: choose 'Always open files of
   this type'").
2. Miss (legacy cache, oversized, imported graph): the existing
   `openDocumentViewer` text reader — current behavior, now labeled a
   fallback in its tooltip.

The in-panel Document section (VirtualText) continues to show extracted text
for in-app reading; the WIP viewer remains the fallback reader. A small
`fileMime.ts` util maps FileType → MIME.

## Testing

- `office-samples.test.ts` (Node, Vitest): reads the committed
  `public/demo/*.docx|pptx` fixtures with `parseOffice` — asserts status
  `ok`, non-empty text, expected title/headings. (PDF parsing stays
  browser-side with pdf.js; covered by e2e.)
- E2E (headless Chrome): load demo corpus → all nine sample nodes ingest
  with status `ok` → for one file of each type, SHA-256 of the stored
  original blob === SHA-256 of the served `/demo/` file (byte-identity
  proof) → clicking Open fires a browser download with the right filename.
- `npm run typecheck`, `npm test`, `npm run build`.

## Non-goals

- No change to the ingest pipeline's parsing/graph behavior beyond the
  binary-safe demo fetch.
- No xlsx sample (parser supports it; the ask was pptx/docx/pdf).
- No attempt to bypass the browser sandbox to launch apps directly.

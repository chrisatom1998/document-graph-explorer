# Phase 1 Feature Bets — Design

**Date:** 2026-07-02 · **Status:** Approved (user), implementation in progress

Four features, scoped in conversation from the larger "feature bets" list. Deferred to
later passes: snapshot diff, ingestion breadth (.docx/code/URLs), folder watching,
accessibility/onboarding.

## 1. Local cluster auto-naming

**Problem:** `clusterNames` is only populated by the opt-in Gemini enrichment pass
(`enrich/gemini.ts` pass 3). Without a key, cluster chips and the collapse super-nodes
fall back to generic `Cluster N`.

**Design:** New pure module `src/graph/clusterNaming.ts` —
`computeLocalClusterNames(nodes) → Record<number, string>` derives a 1–2 keyword name
per cluster from members' TF-IDF `keywords` (fallback `topics`), scoring keywords by
in-cluster frequency × corpus-level distinctiveness, title-cased and joined with " & ".
Stored in a new `graphStore.localClusterNames` tier. Display fallback everywhere:
`clusterNames[c] (Gemini) ?? localClusterNames[c] ?? "Cluster N"`. Recomputed after
every semantic/cluster pass and on session/snapshot/import hydration.

## 2. Staleness / temporal insights

**Problem:** `DocNode` carries no timestamp; documentation health has no temporal signal.

**Design:** `IngestFile.lastModified` + `DocNode.lastModified` (epoch ms) captured from
`File.lastModified` at drop time; flows through existing persistence (node stored
wholesale) and import sanitization. New `computeStaleDocs()` in `graph/insights.ts`
(docs older than `STALE_DOC_DAYS = 180`, oldest first) surfaces as a fourth
InsightsPanel section with the existing highlight/focus pattern. SidePanel shows
"updated N months ago" (`src/util/relativeTime.ts`). Scene rendering intentionally
untouched.

## 3. Shortest-path "how are these connected?"

**Design:** Toolbar toggle enters path mode (`uiStore.pathMode` + `pathEndpoints`,
max 2; node clicks pick endpoints instead of selecting — `Nodes.tsx` click handler).
New pure `src/graph/pathfinding.ts` BFS (unweighted, undirected, `topic` edges
excluded) finds the fewest-hops path. New `PathPanel.tsx` shows endpoints/result and
feeds the path ids into the existing search-emphasis dimming (`setSearchResults`) plus
`sendCamera('frameSet', path)` — no new scene rendering. Esc and the toolbar toggle
exit and clear.

## 4. RAG chat upgrades

- **Streaming:** `:streamGenerateContent?alt=sse` (drop the JSON responseSchema —
  citations come from retrieval, not the model), deltas appended live.
- **Memory:** last ~8 real user/assistant turns sent as Gemini `contents` history;
  placeholders/system messages excluded.
- **Citations:** `ChatMessage.sources` becomes `{docId, snippet, score}[]`; chips get
  passage-preview tooltips.
- **Cancel:** AbortController; Stop button while streaming; partial answers kept.
- **Markdown:** assistant messages rendered via the already-installed (and previously
  unused) unified/remark-parse/remark-gfm on the main thread — new `ChatMarkdown.tsx`,
  no `dangerouslySetInnerHTML`, no new dependencies.
- `chatStore.clearMessages` wired into `resetCorpus()` (was dead code).

## Build approach

Shared-file scaffolding (types, stores, coordinator, DropZone, SidePanel, Toolbar,
Nodes, validateImport, config) applied directly to avoid agent collisions; the four
feature bodies built by parallel agents on disjoint file sets; then integration
(cluster-naming wiring), typecheck/tests/build, and a code-review pass.

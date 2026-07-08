# Feature Playbook: Save & Load Snapshots

**Feature Owner:** Chris Johnson  
**Status:** Shipped (v1)  
**Date:** July 2, 2026

---

## 1. Business Context

### Problem Statement

Document Graph Explorer users invest significant time ingesting documents, tuning their graph, and exploring connections. But documentation evolves — new files get added, old ones get removed, and the graph changes. Without a way to **save and return to past states**, users lose the ability to:

- Compare how a knowledge base has evolved over time
- Maintain "known-good" reference graphs for onboarding
- Experiment with different file sets without losing their current state
- Share a specific graph state with a colleague (via export)

### Business Impact

| Impact Area | Before Snapshots | After Snapshots |
|---|---|---|
| **Exploration confidence** | Users hesitated to add/remove files because it altered their graph irreversibly | Users freely experiment — they can always restore a snapshot |
| **Onboarding workflows** | Each new hire re-ingests the same docs | Team lead saves a "New Hire Orientation" snapshot that anyone can load instantly |
| **Documentation auditing** | No way to track how the knowledge graph changed over a quarter | Monthly snapshots create a version history of the documentation landscape |
| **Demo readiness** | Re-ingesting 50+ files before every demo | Save a polished snapshot once, load it in <3 seconds |

### Success Criteria

- Users can save a snapshot in <2 interactions (click save → type name → Enter)
- Snapshot restore completes in <3 seconds (matching session restore target)
- Snapshots persist across browser sessions (IndexedDB)
- Zero data loss: all documents, embeddings, and layout positions are preserved

---

## 2. User Workflow

### Saving a Snapshot

```
User clicks 💾 (Save) in toolbar
  → Inline prompt appears with auto-suggested name
    e.g. "Snapshot — Jul 2, 2026 5:50 AM"
  → User edits name (optional) → presses Enter
  → Documents + embeddings persisted to IndexedDB
  → Snapshot record created (graph state + positions + doc references)
  → Save icon flashes green ✓
```

### Loading a Past Snapshot

```
User clicks 🕐 (History) in toolbar
  → Snapshot drawer opens (modal)
  → List of saved snapshots, most recent first
    Each row: name, date, node count, [Load] [✕]
  → User clicks [Load]
  → Current graph is reset
  → Snapshot state restored (nodes, edges, positions, documents)
  → Drawer closes, graph is ready to explore
```

### Deleting a Snapshot

```
User clicks ✕ on a snapshot row
  → Snapshot record removed from IndexedDB
  → List refreshes
  → (Document/embedding records are NOT deleted — they may be shared with other snapshots or the auto-cache)
```

---

## 3. Technical Implementation

### Data Model

```typescript
interface SnapshotRecord {
  id?: number;           // Auto-generated (IndexedDB auto-increment)
  name: string;          // User-provided or auto-generated
  savedAt: number;       // Date.now() timestamp
  corpusHash: string;    // Content hash of the corpus at save time
  docHashes: string[];   // References to documents/embeddings stores
  exportData: GraphExport; // Full graph state (nodes, edges, clusters)
  positions: Record<string, [x, y, z]>; // Layout positions for instant restore
}
```

### Storage Architecture

```
IndexedDB: knowledge-nebula (v2)
├── documents      — parsed doc content (keyed by content hash)
├── embeddings     — Float32 vectors (keyed by content hash)
├── graphs         — auto-cached session (keyed by corpus hash)
├── settings       — user preferences
└── snapshots      — named snapshots (auto-incrementing key)  ← NEW
    └── index: by-savedAt (for sorted listing)
```

Snapshots reference documents/embeddings by hash — no data duplication. A 50-document snapshot adds ~50KB of metadata overhead (graph structure + positions), not the full document content again.

### Key Design Decisions

| Decision | Rationale |
|---|---|
| **Snapshots store graph state, not document content** | Documents are already in the `documents` store keyed by content hash. Snapshots hold references (hashes) to avoid doubling storage. |
| **No garbage collection on delete (v1)** | Deleting a snapshot only removes the snapshot record. Orphaned document records may exist but are harmless and small. GC is a v2 optimization. |
| **Dynamic import of `resetCorpus`** | Avoids a circular dependency between `session.ts` and `coordinator.ts`. The async import has negligible cost since it's a same-bundle module. |
| **Shared `hydrateFromRecord()` helper** | Both session restore and snapshot restore use the same code path, ensuring consistent behavior and reducing bug surface. |

### Files Changed

| File | Change |
|---|---|
| `src/persistence/db.ts` | DB v2, `SnapshotRecord` type, `snapshots` store |
| `src/persistence/cache.ts` | CRUD functions, updated `clearAllCaches` |
| `src/persistence/session.ts` | Extracted `hydrateFromRecord()`, added `saveCurrentSnapshot()` + `restoreSnapshotById()` |
| `src/store/uiStore.ts` | `snapshotsOpen` state |
| `src/ui/Toolbar.tsx` | Save + History buttons, inline prompt |
| `src/ui/SnapshotDrawer.tsx` | **New** — snapshot list/load/delete UI |
| `src/App.tsx` | Mounted drawer, Escape handling |
| `src/styles.css` | Prompt, flash animation, drawer styles |

---

## 4. Testing & Validation

| Test | Method | Result |
|---|---|---|
| TypeScript compilation | `npm run typecheck` | ✅ Clean |
| Unit/integration tests | `npm run test` (29 tests) | ✅ All pass |
| Save snapshot flow | Manual: drop files → save → verify flash | ✅ |
| Load snapshot flow | Manual: save two states → load first → verify restore | ✅ |
| Delete snapshot | Manual: delete → verify removed from list | ✅ |
| Cross-session persistence | Manual: save → close tab → reopen → open drawer | ✅ |
| Edge case: save while not ready | Button disabled when `phase !== 'ready'` | ✅ |

---

## 5. Future Enhancements

| Enhancement | Priority | Description |
|---|---|---|
| Snapshot diff view | Medium | Visually compare two snapshots — what nodes/edges were added or removed |
| Auto-snapshot on ingest | Low | Automatically save a snapshot after each ingestion completes |
| Snapshot export/import | Medium | Export a snapshot as a standalone JSON file for sharing |
| Garbage collection | Low | Periodically clean up orphaned document/embedding records |
| Snapshot thumbnails | Low | Save a small canvas screenshot with each snapshot for visual preview |

---

## Related Documents

- [Project Plan](./project-plan.md) — Overall project context, users, success metrics
- [Technical Specification](../knowledge-nebula-spec.md) — Full engineering spec
- [Product Roadmap](./product-roadmap.md) — Quarter-level milestones

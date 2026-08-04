# OpenUSD asset pipeline

Document Graph Explorer can export any corpus as an **OpenUSD stage** — the
scene-description format used by NVIDIA Omniverse, usdview, and the wider
digital-twin ecosystem. The graph you explore in the browser becomes a
composed, queryable 3D asset that downstream tools can open, validate,
re-render, and build on.

| In the app (three.js) | Same corpus in Pixar's Storm renderer (`usdrecord`) |
| --- | --- |
| Force-directed 3D nebula | ![Exported stage, detailed variant](assets/openusd-detailed.png) |

## Quick start

1. Load a corpus, then **Data → Export OpenUSD scene**. This downloads a
   self-contained `document-graph-explorer-<date>.usda` (text USD, no
   dependencies).
2. Validate and inspect it with the Python pipeline tool:

   ```bash
   cd tools/usd_pipeline
   python3 -m venv .venv && . .venv/bin/activate
   pip install -r requirements.txt
   python usd_pipeline.py report ~/Downloads/document-graph-explorer-*.usda
   ```

   The `report` command opens the stage with Pixar's `usd-core` bindings,
   verifies every schema invariant (see below), exercises the variantSet, and
   exits non-zero on any violation — usable as a CI gate for exported assets.
3. Package for Omniverse / AR Quick Look:

   ```bash
   python usd_pipeline.py usdz corpus.usda -o corpus.usdz
   ```

4. Open it anywhere USD goes: `usdview corpus.usda`, drag into NVIDIA
   Omniverse USD Composer, or render headless with the macOS-bundled tools:

   ```bash
   usdrecord --imageWidth 1600 corpus.usda corpus.png
   usdchecker corpus.usda
   ```

## Stage structure

```
/Corpus                       (Xform, defaultPrim, kind=assembly)
├── variantSet "graphView"    detailed ⇄ summary
├── /Documents
│   └── /Cluster_<n>          (Xform per community, displayName = cluster label)
│       └── /Doc_<id>         (Sphere per document/topic node)
│           ├── xformOp:translate   force-layout position
│           ├── primvars:displayColor  cluster color (OKLab-equalized palette)
│           ├── radius              degree-scaled
│           └── docGraph:*          custom attributes (schema below)
├── /Connections
│   └── /Edges_<kind>         (one BasisCurves per edge kind: reference,
│                              semantic, keyword, entity, topic — colored by
│                              kind, with parallel metadata arrays)
└── /ClusterHulls
    └── /Hull_<n>             (translucent Sphere at each cluster centroid)
```

### The `docGraph` schema

Every prim carries the graph's semantics as namespaced custom attributes, so
the stage is not just geometry — it is a queryable knowledge structure.

| Prim | Attribute | Type | Meaning |
| --- | --- | --- | --- |
| Document sphere | `docGraph:docId` | string | Stable content-hash id |
| | `docGraph:kind` | token | `document` or `topic` |
| | `docGraph:title`, `docGraph:fileType`, `docGraph:status` | string/token | Node identity |
| | `docGraph:topics`, `docGraph:entities`, `docGraph:keywords` | string[] | Extracted semantics |
| | `docGraph:wordCount`, `docGraph:degree` | int | Size and connectivity |
| Cluster Xform / hull | `docGraph:clusterId`, `docGraph:clusterName`, `docGraph:memberCount` | int/string | Community metadata |
| Edge curves | `docGraph:weights`, `docGraph:sourceIds`, `docGraph:targetIds`, `docGraph:evidence` | float[]/string[] | Per-curve parallel arrays — every edge keeps its "why are these connected?" evidence |

### Composition: the `graphView` variantSet

The stage ships two views selected by a variant on `/Corpus`: **detailed**
(document spheres + edge curves) and **summary** (translucent cluster hulls
only). Because it's real USD composition, downstream layers can switch views
without touching the exported file — this 6-line sublayer flips the render:

```usda
#usda 1.0
(
    subLayers = [@./corpus.usda@]
    defaultPrim = "Corpus"
)

over "Corpus" (
    variants = { string graphView = "summary" }
)
{
}
```

![Exported stage, summary variant — cluster hulls only](assets/openusd-summary.png)

## Validation contract

`usd_pipeline.py report` enforces, per stage:

- `defaultPrim` is `/Corpus`; document spheres exist under `/Corpus/Documents`
- every sphere carries the identity attributes; `docGraph:docId` values are unique
- every `Edges_<kind>` prim: all curves are 2-point segments, `points` length
  is exactly `2 × curveVertexCounts`, all four metadata arrays are parallel,
  and every source/target id resolves to an exported document
- the `graphView` variantSet has both variants, and switching them actually
  flips computed visibility (checked via `UsdGeom.Imageable.ComputeVisibility`)

The exported stage also passes stock `usdchecker` in all variant combinations.

## Privacy

The export carries the same envelope as the shareable URL: titles, topics,
entities, keywords, cluster labels, connection evidence, positions, and
colors. It excludes full document text, original file bytes, local paths, and
embeddings.

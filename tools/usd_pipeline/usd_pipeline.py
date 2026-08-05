#!/usr/bin/env python3
"""Validation and packaging CLI for Document Graph Explorer OpenUSD exports.

The app's "Export OpenUSD scene" action (src/persistence/usdExport.ts) writes a
composed .usda stage. This tool is the downstream half of the asset pipeline:

  report   Open the stage, verify the docGraph schema invariants, exercise the
           graphView variantSet, and print a corpus summary. Non-zero exit on
           any violation — suitable as a CI gate for exported assets.
  usdz     Flatten the stage and package it as a .usdz archive for viewers
           that want a single binary asset (Omniverse, AR Quick Look).

Requires the pip package `usd-core` (Pixar's OpenUSD Python bindings):

  python3 -m venv .venv && . .venv/bin/activate
  pip install -r requirements.txt
  python usd_pipeline.py report ~/Downloads/document-graph-explorer-*.usda
"""

from __future__ import annotations

import argparse
import sys
import tempfile
from collections import Counter
from pathlib import Path

try:
    from pxr import Tf, Usd, UsdGeom, UsdUtils
except ImportError:  # pragma: no cover - environment guard, not logic
    sys.exit(
        "error: the 'pxr' module is missing — install Pixar's OpenUSD bindings "
        "with `pip install usd-core` (see requirements.txt)."
    )

EDGE_KINDS = ("reference", "semantic", "keyword", "entity", "topic")
NODE_ATTRS = ("docGraph:docId", "docGraph:kind", "docGraph:title", "docGraph:fileType")


class Report:
    """Collects check results; keeps going after a failure so one run shows everything."""

    def __init__(self) -> None:
        self.failures: list[str] = []

    def check(self, ok: bool, label: str) -> bool:
        print(f"  {'PASS' if ok else 'FAIL'}  {label}")
        if not ok:
            self.failures.append(label)
        return ok


def open_stage(path: str) -> Usd.Stage:
    try:
        # The bindings raise Tf.ErrorException on a missing/unparseable file;
        # they do not return None. Keep the None check as a fallback.
        stage = Usd.Stage.Open(path)
    except Tf.ErrorException as err:
        sys.exit(f"error: could not open stage: {path} ({err})")
    if stage is None:
        sys.exit(f"error: could not open stage: {path}")
    return stage


def iter_document_spheres(stage: Usd.Stage) -> list[Usd.Prim]:
    docs_root = stage.GetPrimAtPath("/Corpus/Documents")
    if not docs_root:
        return []
    return [
        prim
        for prim in Usd.PrimRange(docs_root)
        if prim.GetTypeName() == "Sphere"
    ]


def attr_value(prim: Usd.Prim, name: str):
    attr = prim.GetAttribute(name)
    return attr.Get() if attr else None


def cmd_report(args: argparse.Namespace) -> int:
    stage = open_stage(args.stage)
    report = Report()

    print(f"stage: {args.stage}")
    layer_data = stage.GetRootLayer().customLayerData
    print(f"generator: {layer_data.get('generator')}  createdAt: {layer_data.get('createdAt')}")
    print()

    print("structure")
    default_prim = stage.GetDefaultPrim()
    report.check(bool(default_prim) and default_prim.GetName() == "Corpus", "defaultPrim is /Corpus")

    spheres = iter_document_spheres(stage)
    report.check(len(spheres) > 0, f"documents present ({len(spheres)} spheres)")

    doc_ids: set[str] = set()
    kinds: Counter[str] = Counter()
    file_types: Counter[str] = Counter()
    clusters: Counter[str] = Counter()
    schema_ok = True
    for prim in spheres:
        for attr in NODE_ATTRS:
            if attr_value(prim, attr) in (None, ""):
                schema_ok = report.check(False, f"{prim.GetPath()} missing {attr}") and schema_ok
        doc_id = attr_value(prim, "docGraph:docId")
        if doc_id:
            doc_ids.add(doc_id)
        kinds[attr_value(prim, "docGraph:kind") or "?"] += 1
        file_types[attr_value(prim, "docGraph:fileType") or "?"] += 1
        clusters[prim.GetParent().GetName()] += 1
    report.check(schema_ok, f"every document sphere carries {', '.join(NODE_ATTRS)}")
    report.check(len(doc_ids) == len(spheres), "docGraph:docId values are unique")

    print()
    print("connections")
    edge_total = 0
    for kind in EDGE_KINDS:
        prim = stage.GetPrimAtPath(f"/Corpus/Connections/Edges_{kind}")
        if not prim:
            continue
        counts = attr_value(prim, "curveVertexCounts") or []
        points = attr_value(prim, "points") or []
        n = len(counts)
        edge_total += n
        parallel = {
            "docGraph:weights": len(attr_value(prim, "docGraph:weights") or []),
            "docGraph:sourceIds": len(attr_value(prim, "docGraph:sourceIds") or []),
            "docGraph:targetIds": len(attr_value(prim, "docGraph:targetIds") or []),
            "docGraph:evidence": len(attr_value(prim, "docGraph:evidence") or []),
        }
        report.check(all(c == 2 for c in counts), f"Edges_{kind}: all curves are segments ({n} edges)")
        report.check(len(points) == 2 * n, f"Edges_{kind}: points array matches curve count")
        parallel_desc = ", ".join(f"{k.split(':')[1]}={v}" for k, v in parallel.items())
        report.check(
            all(v == n for v in parallel.values()),
            f"Edges_{kind}: metadata arrays parallel ({parallel_desc})",
        )
        endpoints_ok = all(
            src in doc_ids and dst in doc_ids
            for src, dst in zip(
                attr_value(prim, "docGraph:sourceIds") or [],
                attr_value(prim, "docGraph:targetIds") or [],
            )
        )
        report.check(endpoints_ok, f"Edges_{kind}: every endpoint resolves to an exported docId")

    print()
    print("composition (graphView variantSet)")
    corpus = stage.GetPrimAtPath("/Corpus")
    vset = corpus.GetVariantSet("graphView")
    report.check(
        set(vset.GetVariantNames()) == {"detailed", "summary"},
        "variants: detailed + summary",
    )
    docs_prim = UsdGeom.Imageable(stage.GetPrimAtPath("/Corpus/Documents"))
    hulls_prim = UsdGeom.Imageable(stage.GetPrimAtPath("/Corpus/ClusterHulls"))
    vset.SetVariantSelection("detailed")
    report.check(
        docs_prim.ComputeVisibility() != UsdGeom.Tokens.invisible
        and hulls_prim.ComputeVisibility() == UsdGeom.Tokens.invisible,
        "detailed: documents visible, hulls hidden",
    )
    vset.SetVariantSelection("summary")
    report.check(
        docs_prim.ComputeVisibility() == UsdGeom.Tokens.invisible
        and hulls_prim.ComputeVisibility() != UsdGeom.Tokens.invisible,
        "summary: hulls visible, documents hidden",
    )
    vset.SetVariantSelection("detailed")

    print()
    print("corpus summary")
    print(f"  nodes: {len(spheres)} ({', '.join(f'{k}={v}' for k, v in sorted(kinds.items()))})")
    print(f"  file types: {', '.join(f'{k}={v}' for k, v in sorted(file_types.items()))}")
    print(f"  clusters: {len(clusters)} (largest: {clusters.most_common(1)[0][0]} with {clusters.most_common(1)[0][1]} nodes)" if clusters else "  clusters: 0")
    print(f"  edges: {edge_total}")

    print()
    if report.failures:
        print(f"RESULT: FAIL ({len(report.failures)} violation(s))")
        return 1
    print("RESULT: PASS")
    return 0


def cmd_usdz(args: argparse.Namespace) -> int:
    stage = open_stage(args.stage)
    out = Path(args.output or Path(args.stage).with_suffix(".usdz"))
    with tempfile.TemporaryDirectory() as tmp:
        flattened = str(Path(tmp) / "corpus.usdc")
        # Flatten composition (variants resolve to their current selections) so
        # the package is a single self-contained binary layer.
        stage.Flatten().Export(flattened)
        ok = UsdUtils.CreateNewUsdzPackage(flattened, str(out))
    if not ok:
        print(f"error: usdz packaging failed for {args.stage}", file=sys.stderr)
        return 1
    print(f"wrote {out} ({out.stat().st_size} bytes)")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)

    p_report = sub.add_parser("report", help="validate schema + composition and print a summary")
    p_report.add_argument("stage", help="path to an exported .usda stage")
    p_report.set_defaults(func=cmd_report)

    p_usdz = sub.add_parser("usdz", help="flatten and package the stage as .usdz")
    p_usdz.add_argument("stage", help="path to an exported .usda stage")
    p_usdz.add_argument("-o", "--output", help="output .usdz path (default: alongside input)")
    p_usdz.set_defaults(func=cmd_usdz)

    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())

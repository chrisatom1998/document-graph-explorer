#!/usr/bin/env python3
"""usd-agent: natural-language Q&A over Document Graph Explorer OpenUSD exports.

An LLM agent whose tools are OpenUSD stage operations (via Pixar's usd-core
bindings). Ask questions about an exported corpus stage — clusters, documents,
connections, evidence — and the agent answers by querying the live stage:

  python usd_agent.py ask corpus.usda "Which cluster has the most documents?"
  python usd_agent.py repl corpus.usda            # interactive session
  python usd_agent.py selftest corpus.usda        # run every tool, no LLM

Providers (chosen with --provider, mirroring the app's philosophy):
  openrouter  cloud, needs OPENROUTER_API_KEY (default model: Claude Sonnet 5)
  ollama      local server, zero cloud (default host http://localhost:11434)
  mock        no network at all — scripted tool calls that exercise the real
              agent loop end-to-end; used by tests and demos

Both live providers speak the OpenAI chat-completions tool-calling protocol,
matching the repo's Node subagent (agent/subagentCore.mjs). All tools are
read-only except switch_view, which changes the stage's variant selection
in memory only — nothing is ever written back to the file.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request

try:
    from pxr import Tf, Usd, UsdGeom
except ImportError:  # pragma: no cover - environment guard, not logic
    sys.exit(
        "error: the 'pxr' module is missing — install Pixar's OpenUSD bindings "
        "with `pip install usd-core` (see requirements.txt)."
    )

MAX_AGENT_STEPS = 8
MAX_TOOL_RESULT_CHARS = 20_000
EDGE_KINDS = ("reference", "semantic", "keyword", "entity", "topic")


class StageError(RuntimeError):
    pass


# ---------------------------------------------------------------------------
# Stage index: one traversal up front, then every tool is a dict/list lookup
# ---------------------------------------------------------------------------


def _attr(prim, name, default=None):
    attribute = prim.GetAttribute(name)
    if not attribute:
        return default
    value = attribute.Get()
    return default if value is None else value


class StageIndex:
    def __init__(self, path: str):
        try:
            # The bindings raise Tf.ErrorException on a missing/unparseable
            # file; they do not return None. Keep the None check as a fallback.
            self.stage = Usd.Stage.Open(path)
        except Tf.ErrorException as err:
            raise StageError(f"could not open stage: {path} ({err})") from err
        if self.stage is None:
            raise StageError(f"could not open stage: {path}")
        self.path = path
        self.docs = {}  # docId -> dict of docGraph fields + position
        self.clusters = {}  # clusterId -> {name, member_ids}
        self.edges = []  # flat edge dicts across all kinds

        docs_root = self.stage.GetPrimAtPath("/Corpus/Documents")
        for prim in Usd.PrimRange(docs_root) if docs_root else []:
            if prim.GetTypeName() != "Sphere":
                continue
            doc_id = _attr(prim, "docGraph:docId")
            if not doc_id:
                continue
            translate = _attr(prim, "xformOp:translate")
            cluster_id = int(_attr(prim.GetParent(), "docGraph:clusterId", -1))
            self.docs[doc_id] = {
                "doc_id": doc_id,
                "title": _attr(prim, "docGraph:title", ""),
                "kind": str(_attr(prim, "docGraph:kind", "document")),
                "file_type": str(_attr(prim, "docGraph:fileType", "other")),
                "status": str(_attr(prim, "docGraph:status", "ok")),
                "word_count": int(_attr(prim, "docGraph:wordCount", 0)),
                "degree": int(_attr(prim, "docGraph:degree", 0)),
                "topics": list(_attr(prim, "docGraph:topics", []) or []),
                "entities": list(_attr(prim, "docGraph:entities", []) or []),
                "keywords": list(_attr(prim, "docGraph:keywords", []) or []),
                "cluster_id": cluster_id,
                "position": [round(float(v), 2) for v in translate] if translate else None,
                "prim_path": str(prim.GetPath()),
            }
            cluster_name = str(_attr(prim.GetParent(), "docGraph:clusterName", f"Cluster {cluster_id}"))
            bucket = self.clusters.setdefault(cluster_id, {"name": cluster_name, "member_ids": []})
            bucket["member_ids"].append(doc_id)

        for kind in EDGE_KINDS:
            prim = self.stage.GetPrimAtPath(f"/Corpus/Connections/Edges_{kind}")
            if not prim:
                continue
            weights = list(_attr(prim, "docGraph:weights", []) or [])
            sources = list(_attr(prim, "docGraph:sourceIds", []) or [])
            targets = list(_attr(prim, "docGraph:targetIds", []) or [])
            evidence = list(_attr(prim, "docGraph:evidence", []) or [])
            # Endpoints are required; a missing metadata array degrades to
            # defaults instead of silently dropping the whole edge kind
            # (usd_pipeline.py `report` is the strict integrity gate).
            for i in range(min(len(sources), len(targets))):
                self.edges.append(
                    {
                        "kind": kind,
                        "weight": round(float(weights[i]), 3) if i < len(weights) else 0.5,
                        "source_id": sources[i],
                        "target_id": targets[i],
                        "evidence": evidence[i] if i < len(evidence) else "",
                    }
                )

    # --- tool implementations ------------------------------------------------

    def _doc_brief(self, doc_id):
        doc = self.docs.get(doc_id)
        if not doc:
            return {"doc_id": doc_id, "title": "(unknown)"}
        return {
            "doc_id": doc_id,
            "title": doc["title"],
            "cluster_id": doc["cluster_id"],
            "degree": doc["degree"],
        }

    def stage_summary(self):
        by_kind = {}
        by_type = {}
        for doc in self.docs.values():
            by_kind[doc["kind"]] = by_kind.get(doc["kind"], 0) + 1
            by_type[doc["file_type"]] = by_type.get(doc["file_type"], 0) + 1
        edge_kinds = {}
        for edge in self.edges:
            edge_kinds[edge["kind"]] = edge_kinds.get(edge["kind"], 0) + 1
        layer = self.stage.GetRootLayer().customLayerData
        return {
            "stage": os.path.basename(self.path),
            "generator": layer.get("generator"),
            "created_at": layer.get("createdAt"),
            "node_count": len(self.docs),
            "nodes_by_kind": by_kind,
            "nodes_by_file_type": by_type,
            "cluster_count": len([c for c in self.clusters if c >= 0]),
            "edge_count": len(self.edges),
            "edges_by_kind": edge_kinds,
            "current_view": self.get_view().get("current_variant"),
        }

    def list_clusters(self):
        rows = []
        for cluster_id, info in sorted(self.clusters.items()):
            rows.append(
                {
                    "cluster_id": cluster_id,
                    "name": "Unclustered" if cluster_id < 0 else info["name"],
                    "member_count": len(info["member_ids"]),
                    "unclustered": cluster_id < 0,
                }
            )
        return rows

    def find_documents(self, query: str, limit: int = 10):
        needle = (query or "").lower()
        hits = []
        for doc in self.docs.values():
            haystacks = [doc["title"].lower()]
            haystacks.extend(t.lower() for t in doc["topics"])
            haystacks.extend(e.lower() for e in doc["entities"])
            haystacks.extend(k.lower() for k in doc["keywords"])
            if any(needle in h for h in haystacks):
                hits.append(
                    {
                        "doc_id": doc["doc_id"],
                        "title": doc["title"],
                        "cluster_id": doc["cluster_id"],
                        "cluster_name": self.clusters.get(doc["cluster_id"], {}).get("name", ""),
                        "file_type": doc["file_type"],
                        "degree": doc["degree"],
                    }
                )
        hits.sort(key=lambda d: -d["degree"])
        return {"match_count": len(hits), "documents": hits[: max(1, int(limit))]}

    def get_document(self, doc_id: str):
        doc = self.docs.get(doc_id)
        if not doc:
            close = [d["doc_id"] for d in self.find_documents(doc_id, 3)["documents"]]
            return {"error": f"no document with id '{doc_id}'", "closest_matches": close}
        enriched = dict(doc)
        enriched["cluster_name"] = self.clusters.get(doc["cluster_id"], {}).get("name", "")
        return enriched

    def get_edges(self, kind: str = "", min_weight: float = 0.0, limit: int = 20):
        if kind and kind not in EDGE_KINDS:
            return {"error": f"unknown edge kind '{kind}'", "valid_kinds": list(EDGE_KINDS)}
        rows = [
            e
            for e in self.edges
            if (not kind or e["kind"] == kind) and e["weight"] >= float(min_weight)
        ]
        rows.sort(key=lambda e: -e["weight"])
        out = []
        for edge in rows[: max(1, int(limit))]:
            out.append(
                {
                    **edge,
                    "source": self._doc_brief(edge["source_id"]),
                    "target": self._doc_brief(edge["target_id"]),
                }
            )
        return {"match_count": len(rows), "edges": out}

    def get_neighbors(self, doc_id: str, limit: int = 20):
        if doc_id not in self.docs:
            return {"error": f"no document with id '{doc_id}'"}
        rows = []
        for edge in self.edges:
            if edge["source_id"] == doc_id or edge["target_id"] == doc_id:
                other = edge["target_id"] if edge["source_id"] == doc_id else edge["source_id"]
                rows.append(
                    {
                        "neighbor": self._doc_brief(other),
                        "kind": edge["kind"],
                        "weight": edge["weight"],
                        "evidence": edge["evidence"],
                    }
                )
        rows.sort(key=lambda r: -r["weight"])
        return {"neighbor_count": len(rows), "neighbors": rows[: max(1, int(limit))]}

    def top_connected(self, limit: int = 10):
        rows = sorted(self.docs.values(), key=lambda d: -d["degree"])
        return [
            {"doc_id": d["doc_id"], "title": d["title"], "degree": d["degree"], "cluster_id": d["cluster_id"]}
            for d in rows[: max(1, int(limit))]
        ]

    def get_view(self):
        corpus = self.stage.GetPrimAtPath("/Corpus")
        if not corpus:  # invalid prim, not None — bool() is the validity check
            return {"error": "stage has no /Corpus prim; not a Document Graph Explorer export?"}
        vset = corpus.GetVariantSet("graphView")
        visible = {}
        for scope in ("Documents", "Connections", "ClusterHulls"):
            prim = self.stage.GetPrimAtPath(f"/Corpus/{scope}")
            if prim:
                visible[scope] = str(UsdGeom.Imageable(prim).ComputeVisibility()) != "invisible"
        return {
            "variant_set": "graphView",
            "current_variant": vset.GetVariantSelection(),
            "available_variants": list(vset.GetVariantNames()),
            "visible_scopes": visible,
        }

    def switch_view(self, variant: str):
        corpus = self.stage.GetPrimAtPath("/Corpus")
        if not corpus:
            return {"error": "stage has no /Corpus prim; not a Document Graph Explorer export?"}
        vset = corpus.GetVariantSet("graphView")
        if variant not in vset.GetVariantNames():
            return {"error": f"unknown variant '{variant}'", "available": list(vset.GetVariantNames())}
        vset.SetVariantSelection(variant)  # in-memory only; never written back
        return self.get_view()


# ---------------------------------------------------------------------------
# Tool registry (OpenAI function-calling schemas)
# ---------------------------------------------------------------------------


def _tool(name, description, properties=None, required=None):
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": {
                "type": "object",
                "properties": properties or {},
                "required": required or [],
            },
        },
    }


TOOLS = [
    _tool("stage_summary", "Corpus overview: node/edge counts by kind, cluster count, current view."),
    _tool("list_clusters", "All clusters with their AI/keyword-derived names and member counts."),
    _tool(
        "find_documents",
        "Case-insensitive substring search over titles, topics, entities, and keywords.",
        {"query": {"type": "string"}, "limit": {"type": "integer", "default": 10}},
        ["query"],
    ),
    _tool(
        "get_document",
        "Full docGraph record for one document id: topics, entities, keywords, cluster, position.",
        {"doc_id": {"type": "string"}},
        ["doc_id"],
    ),
    _tool(
        "get_edges",
        "Connections filtered by kind and minimum weight, strongest first, with per-edge evidence.",
        {
            "kind": {"type": "string", "enum": list(EDGE_KINDS) + [""]},
            "min_weight": {"type": "number", "default": 0},
            "limit": {"type": "integer", "default": 20},
        },
    ),
    _tool(
        "get_neighbors",
        "Every document connected to the given one, with edge kind, weight, and evidence.",
        {"doc_id": {"type": "string"}, "limit": {"type": "integer", "default": 20}},
        ["doc_id"],
    ),
    _tool(
        "top_connected",
        "Documents ranked by connection count (degree).",
        {"limit": {"type": "integer", "default": 10}},
    ),
    _tool("get_view", "Current graphView variant selection and which scopes are visible."),
    _tool(
        "switch_view",
        "Switch the graphView variantSet (detailed or summary) in memory and report visibility.",
        {"variant": {"type": "string", "enum": ["detailed", "summary"]}},
        ["variant"],
    ),
]

TOOL_NAMES = [t["function"]["name"] for t in TOOLS]


def dispatch_tool(index: StageIndex, name: str, arguments: dict):
    if name not in TOOL_NAMES:
        return {"error": f"unknown tool '{name}'"}
    try:
        return getattr(index, name)(**arguments)
    except (TypeError, ValueError, AttributeError, KeyError, IndexError) as err:
        # Arguments are model output; a bad call must become an error string
        # the model can correct, never a crash that ends the session.
        return {"error": f"bad arguments for {name}: {type(err).__name__}: {err}"}


# ---------------------------------------------------------------------------
# Providers
# ---------------------------------------------------------------------------


class ProviderError(RuntimeError):
    pass


def _post_json(url: str, payload: dict, headers: dict, timeout: int = 120) -> dict:
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", **headers},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as err:
        detail = err.read().decode("utf-8", "replace")[:300]
        raise ProviderError(f"{url} -> HTTP {err.code}: {detail}") from err
    except urllib.error.URLError as err:
        raise ProviderError(f"{url} unreachable: {err.reason}") from err


class OpenAICompatProvider:
    """OpenRouter or Ollama through the OpenAI chat-completions protocol."""

    def __init__(self, base_url: str, api_key: str, model: str):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model = model

    def complete(self, messages):
        headers = {}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        body = _post_json(
            f"{self.base_url}/chat/completions",
            {
                "model": self.model,
                "messages": messages,
                "tools": TOOLS,
                "tool_choice": "auto",
                "temperature": 0.2,
            },
            headers,
        )
        try:
            return body["choices"][0]["message"]
        except (KeyError, IndexError) as err:
            raise ProviderError(f"malformed response: {json.dumps(body)[:300]}") from err


class MockProvider:
    """Deterministic scripted run: exercises the real agent loop with no network.

    Step 1 asks for a summary and the cluster list; step 2 answers from the
    actual tool results. This validates tool schemas, dispatch, message
    threading, and transcript rendering end to end.
    """

    def __init__(self, model: str = "mock"):
        self.model = model
        self.step = 0

    def reset(self):
        self.step = 0

    def complete(self, messages):
        self.step += 1
        if self.step == 1:
            return {
                "role": "assistant",
                "content": None,
                "tool_calls": [
                    {
                        "id": "mock-1",
                        "type": "function",
                        "function": {"name": "stage_summary", "arguments": "{}"},
                    },
                    {
                        "id": "mock-2",
                        "type": "function",
                        "function": {"name": "list_clusters", "arguments": "{}"},
                    },
                ],
            }
        summary = {}
        clusters = []
        for message in messages:
            if message.get("role") != "tool":
                continue
            payload = json.loads(message["content"])
            if message.get("name") == "stage_summary":
                summary = payload
            elif message.get("name") == "list_clusters":
                clusters = payload
        largest = max(
            (c for c in clusters if c["cluster_id"] >= 0),
            key=lambda c: c["member_count"],
            default=None,
        )
        lines = [
            f"[mock provider] Stage {summary.get('stage')}: {summary.get('node_count')} nodes, "
            f"{summary.get('edge_count')} edges, {summary.get('cluster_count')} clusters.",
        ]
        if largest:
            lines.append(
                f"Largest cluster: '{largest['name']}' (id {largest['cluster_id']}) "
                f"with {largest['member_count']} members."
            )
        return {"role": "assistant", "content": "\n".join(lines)}


def make_provider(name: str, model: str):
    if name == "mock":
        return MockProvider()
    if name == "openrouter":
        api_key = os.environ.get("OPENROUTER_API_KEY", "")
        if not api_key:
            raise ProviderError("OPENROUTER_API_KEY is not set (or use --provider ollama|mock)")
        return OpenAICompatProvider(
            "https://openrouter.ai/api/v1", api_key, model or "anthropic/claude-sonnet-5"
        )
    if name == "ollama":
        host = os.environ.get("OLLAMA_HOST", "http://localhost:11434").rstrip("/")
        return OpenAICompatProvider(f"{host}/v1", "", model or "llama3.1")
    raise ProviderError(f"unknown provider '{name}'")


# ---------------------------------------------------------------------------
# Agent loop
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = (
    "You are usd-agent, an analyst for Document Graph Explorer OpenUSD exports. "
    "The stage models a document corpus: Sphere prims are documents/topics with "
    "docGraph:* attributes, BasisCurves are typed connections whose evidence "
    "explains WHY two documents relate. Answer questions by calling tools — "
    "never guess stage contents. Quote evidence strings when explaining "
    "connections. Be concise and concrete; cite doc titles with their ids."
)


STEPS_EXCEEDED = "(gave up: exceeded max agent steps without a final answer)"


def _parse_tool_arguments(raw):
    """Model-supplied arguments: a JSON string, already-decoded dict, or junk."""
    if isinstance(raw, dict):
        return raw, None
    if raw is None or raw == "":
        return {}, None
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError as err:
            return None, f"arguments were not valid JSON ({err}); resend the call with corrected JSON"
        if isinstance(parsed, dict):
            return parsed, None
        return None, f"arguments must be a JSON object, got {type(parsed).__name__}"
    return None, f"arguments must be a JSON object, got {type(raw).__name__}"


def run_agent(index: StageIndex, provider, question: str, verbose: bool = True) -> str:
    if hasattr(provider, "reset"):
        provider.reset()  # scripted providers are stateful per question
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": question},
    ]
    for step in range(MAX_AGENT_STEPS):
        message = provider.complete(messages)
        tool_calls = message.get("tool_calls") or []
        if not tool_calls:
            return message.get("content") or "(empty response)"
        if step == MAX_AGENT_STEPS - 1:
            break  # out of budget — don't burn a tool round nobody will read
        messages.append(message)
        for call in tool_calls:
            name = call.get("function", {}).get("name", "")
            arguments, parse_error = _parse_tool_arguments(call.get("function", {}).get("arguments"))
            if parse_error is not None:
                result = {"error": parse_error}
            else:
                result = dispatch_tool(index, name, arguments)
            if verbose:
                print(f"  ⚙ {name}({json.dumps(arguments) if arguments is not None else '<unparsable>'})", file=sys.stderr)
            content = json.dumps(result)
            if len(content) > MAX_TOOL_RESULT_CHARS:
                content = content[:MAX_TOOL_RESULT_CHARS] + "... [truncated; use limit arguments to narrow the query]"
            messages.append(
                {
                    "role": "tool",
                    "tool_call_id": call.get("id", ""),
                    "name": name,
                    "content": content,
                }
            )
    return STEPS_EXCEEDED


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def cmd_ask(args):
    index = StageIndex(args.stage)
    provider = make_provider(args.provider, args.model)
    answer = run_agent(index, provider, args.question, verbose=not args.quiet)
    print(answer)
    return 1 if answer == STEPS_EXCEEDED else 0


def cmd_repl(args):
    index = StageIndex(args.stage)
    provider = make_provider(args.provider, args.model)
    print(f"usd-agent repl — stage: {args.stage} (provider: {args.provider}; empty line quits)")
    while True:
        try:
            question = input("usd> ").strip()
        except (EOFError, KeyboardInterrupt):
            break
        if not question:
            break
        # One bad question (provider hiccup, Ctrl-C mid-call) must not end the
        # whole session — that would throw away the user's context.
        try:
            print(run_agent(index, provider, question, verbose=not args.quiet))
        except ProviderError as err:
            print(f"provider error: {err}", file=sys.stderr)
        except KeyboardInterrupt:
            print("(interrupted)", file=sys.stderr)
    return 0


def cmd_selftest(args):
    """Run every tool against the stage with sample arguments — no LLM."""
    index = StageIndex(args.stage)
    some_doc = next(iter(index.docs), "")
    samples = {
        "stage_summary": {},
        "list_clusters": {},
        "find_documents": {"query": "a", "limit": 3},
        "get_document": {"doc_id": some_doc},
        "get_edges": {"kind": "semantic", "min_weight": 0.5, "limit": 3},
        "get_neighbors": {"doc_id": some_doc, "limit": 3},
        "top_connected": {"limit": 3},
        "get_view": {},
        "switch_view": {"variant": "summary"},
    }
    failures = 0
    # A corpus export always has documents — an empty index means the stage is
    # not what this agent expects, and every later check would be vacuous.
    docs_ok = len(index.docs) > 0
    print(f"  {'PASS' if docs_ok else 'FAIL'}  stage has documents ({len(index.docs)})")
    failures += 0 if docs_ok else 1
    for name in TOOL_NAMES:
        result = dispatch_tool(index, name, samples[name])
        ok = not (isinstance(result, dict) and "error" in result)
        print(f"  {'PASS' if ok else 'FAIL'}  {name} -> {json.dumps(result)[:120]}")
        failures += 0 if ok else 1
    # Ill-typed model arguments must come back as error dicts, never raise.
    hostile = [
        ("get_edges", {"min_weight": "high"}),
        ("find_documents", {"query": 5}),
        ("get_edges", {"kind": "SEMANTIC"}),
        ("switch_view", {"variant": "nope"}),
        ("top_connected", {"limit": None}),
    ]
    for name, bad_args in hostile:
        try:
            result = dispatch_tool(index, name, bad_args)
            ok = isinstance(result, dict) and "error" in result
        except Exception as err:  # noqa: BLE001 - the whole point of the check
            result = {"raised": f"{type(err).__name__}: {err}"}
            ok = False
        print(f"  {'PASS' if ok else 'FAIL'}  rejects {name}({json.dumps(bad_args)}) -> {json.dumps(result)[:80]}")
        failures += 0 if ok else 1
    # Loop machinery end-to-end via the mock provider.
    answer = run_agent(index, MockProvider(), "selftest question", verbose=False)
    loop_ok = "[mock provider]" in answer
    print(f"  {'PASS' if loop_ok else 'FAIL'}  agent loop (mock provider) -> {answer.splitlines()[0][:100]}")
    failures += 0 if loop_ok else 1
    print(f"RESULT: {'PASS' if failures == 0 else f'FAIL ({failures})'}")
    return 0 if failures == 0 else 1


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    sub = parser.add_subparsers(dest="command", required=True)

    def common(p, with_provider=True):
        p.add_argument("stage", help="path to an exported .usda stage")
        if with_provider:
            p.add_argument(
                "--provider", choices=["openrouter", "ollama", "mock"], default="openrouter"
            )
            p.add_argument("--model", default="", help="override the provider's default model")
            p.add_argument("--quiet", action="store_true", help="hide tool-call trace on stderr")

    p_ask = sub.add_parser("ask", help="answer one question about the stage")
    common(p_ask)
    p_ask.add_argument("question")
    p_ask.set_defaults(func=cmd_ask)

    p_repl = sub.add_parser("repl", help="interactive question loop")
    common(p_repl)
    p_repl.set_defaults(func=cmd_repl)

    p_selftest = sub.add_parser("selftest", help="exercise every tool without an LLM")
    common(p_selftest, with_provider=False)
    p_selftest.set_defaults(func=cmd_selftest)

    args = parser.parse_args()
    try:
        return args.func(args)
    except StageError as err:
        print(f"error: {err}", file=sys.stderr)
        return 2
    except ProviderError as err:
        print(f"provider error: {err}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())

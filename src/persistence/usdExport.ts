/**
 * OpenUSD (.usda) scene export.
 *
 * Serializes the current graph as a self-contained USD stage that opens in
 * usdview / NVIDIA Omniverse:
 *
 *   /Corpus                      (Xform, defaultPrim, variantSet "graphView")
 *     /Documents/Cluster_<n>     one Xform per community, named
 *       /Doc_<id12>              Sphere per node + docGraph:* custom attrs
 *     /Connections/Edges_<kind>  one BasisCurves per edge kind; weight and
 *                                evidence ride along as uniform primvars
 *     /ClusterHulls/Hull_<n>     translucent centroid sphere per cluster
 *
 * The "graphView" variantSet switches between "detailed" (documents +
 * connections) and "summary" (hulls only) by overriding visibility — the
 * export is a composed stage, not a flat geometry dump.
 *
 * Graph metadata (titles, topics, entities, edge evidence) is written as
 * custom attributes in the `docGraph:` namespace so the stage is queryable
 * downstream. Same privacy envelope as the shareable URL: no document text,
 * no local paths, no embeddings.
 */

import type { DocNode, Edge, EdgeKind } from '../model/types';
import { clusterColor, EDGE_KIND_HEX } from '../scene/palette';
import { getNodePosition } from '../scene/positionBuffer';
import { useGraphStore } from '../store/graphStore';

export type Vec3 = [number, number, number];

export interface UsdNodeInput {
  id: string;
  kind: 'document' | 'topic';
  title: string;
  fileType: string;
  cluster: number;
  degree: number;
  status: string;
  wordCount: number;
  topics: string[];
  entities: string[];
  keywords: string[];
  position: Vec3;
  /** Linear RGB 0..1 (matches UsdGeom displayColor expectations). */
  color: Vec3;
}

export interface UsdEdgeInput {
  source: string;
  target: string;
  kind: EdgeKind;
  weight: number;
  evidence: string[];
}

export interface UsdStageInput {
  nodes: UsdNodeInput[];
  edges: UsdEdgeInput[];
  /** Resolved display name per cluster id. */
  clusterNames: Record<number, string>;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Serialization helpers
// ---------------------------------------------------------------------------

/** Escape a string for a double-quoted .usda literal. */
export function usdString(value: string): string {
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, '\\n')
    // Remaining control chars have no meaning in USD text — drop them.
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
  return `"${escaped}"`;
}

function usdStringArray(values: string[]): string {
  return `[${values.map(usdString).join(', ')}]`;
}

function num(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const s = n.toFixed(4);
  // Trim trailing zeros ("1.5000" -> "1.5", "2.0000" -> "2")
  return s.replace(/\.?0+$/, '') || '0';
}

function vec3(v: Vec3): string {
  return `(${num(v[0])}, ${num(v[1])}, ${num(v[2])})`;
}

/**
 * A legal USD prim identifier: [A-Za-z_][A-Za-z0-9_]*. Node ids are content
 * hashes (may start with a digit) and topic ids can carry punctuation, so
 * sanitize and prefix. Collisions get a numeric suffix.
 */
export function primName(prefix: string, id: string, taken: Set<string>): string {
  const safe = id.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 12) || 'x';
  let name = `${prefix}_${safe}`;
  let n = 2;
  while (taken.has(name)) name = `${prefix}_${safe}_${n++}`;
  taken.add(name);
  return name;
}

function hexToLinearRgb(hex: string): Vec3 {
  const v = parseInt(hex.replace('#', ''), 16);
  const srgb: Vec3 = [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
  return srgb.map((c) =>
    c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4),
  ) as Vec3;
}

/** Node visual radius from connectivity — mirrors the scene's degree scaling. */
export function nodeRadius(degree: number): number {
  return 0.9 + Math.min(1.6, Math.sqrt(Math.max(0, degree)) * 0.25);
}

// ---------------------------------------------------------------------------
// Stage builder
// ---------------------------------------------------------------------------

const EDGE_KINDS: EdgeKind[] = ['reference', 'semantic', 'keyword', 'entity', 'topic'];

export function buildUsdaStage(input: UsdStageInput): string {
  const lines: string[] = [];
  const out = (s: string) => lines.push(s);

  out('#usda 1.0');
  out('(');
  out('    defaultPrim = "Corpus"');
  out('    upAxis = "Y"');
  out('    metersPerUnit = 1');
  out(`    doc = "Document Graph Explorer corpus export (${input.nodes.length} nodes, ${input.edges.length} edges)"`);
  out('    customLayerData = {');
  out('        string generator = "document-graph-explorer"');
  out(`        string createdAt = ${usdString(input.createdAt)}`);
  out('    }');
  out(')');
  out('');
  out('def Xform "Corpus" (');
  out('    kind = "assembly"');
  out('    variants = {');
  out('        string graphView = "detailed"');
  out('    }');
  out('    prepend variantSets = "graphView"');
  out(')');
  out('{');
  out('    variantSet "graphView" = {');
  const variantOver = (indent: string, scope: string, visibility: string) => {
    out(`${indent}over "${scope}"`);
    out(`${indent}{`);
    out(`${indent}    token visibility = "${visibility}"`);
    out(`${indent}}`);
  };
  out('        "detailed" {');
  variantOver('            ', 'Documents', 'inherited');
  variantOver('            ', 'Connections', 'inherited');
  variantOver('            ', 'ClusterHulls', 'invisible');
  out('        }');
  out('        "summary" {');
  variantOver('            ', 'Documents', 'invisible');
  variantOver('            ', 'Connections', 'invisible');
  variantOver('            ', 'ClusterHulls', 'inherited');
  out('        }');
  out('    }');
  out('');

  // --- Documents, grouped by cluster ---------------------------------------
  const byCluster = new Map<number, UsdNodeInput[]>();
  for (const node of input.nodes) {
    const group = byCluster.get(node.cluster);
    if (group) group.push(node);
    else byCluster.set(node.cluster, [node]);
  }
  const clusterIds = [...byCluster.keys()].sort((a, b) => a - b);
  const positionOf = new Map(input.nodes.map((n): [string, Vec3] => [n.id, n.position]));

  out('    def Scope "Documents"');
  out('    {');
  const takenNames = new Set<string>();
  for (const clusterId of clusterIds) {
    const members = byCluster.get(clusterId)!;
    const clusterName = input.clusterNames[clusterId] ?? `Cluster ${clusterId}`;
    const groupName = clusterId < 0 ? 'Unclustered' : `Cluster_${clusterId}`;
    out(`        def Xform "${groupName}" (`);
    out('            kind = "group"');
    out(`            displayName = ${usdString(clusterName)}`);
    out('        )');
    out('        {');
    out(`            custom int docGraph:clusterId = ${clusterId}`);
    out(`            custom string docGraph:clusterName = ${usdString(clusterName)}`);
    out('');
    for (const node of members) {
      out(`            def Sphere "${primName('Doc', node.id, takenNames)}" (`);
      out('                kind = "component"');
      out(`                displayName = ${usdString(node.title)}`);
      out('            )');
      out('            {');
      out(`                double radius = ${num(nodeRadius(node.degree))}`);
      out(`                color3f[] primvars:displayColor = [${vec3(node.color)}]`);
      out(`                double3 xformOp:translate = ${vec3(node.position)}`);
      out('                uniform token[] xformOpOrder = ["xformOp:translate"]');
      out(`                custom string docGraph:docId = ${usdString(node.id)}`);
      out(`                custom token docGraph:kind = ${usdString(node.kind)}`);
      out(`                custom string docGraph:title = ${usdString(node.title)}`);
      out(`                custom token docGraph:fileType = ${usdString(node.fileType)}`);
      out(`                custom token docGraph:status = ${usdString(node.status)}`);
      out(`                custom int docGraph:wordCount = ${Math.round(node.wordCount)}`);
      out(`                custom int docGraph:degree = ${Math.round(node.degree)}`);
      out(`                custom string[] docGraph:topics = ${usdStringArray(node.topics)}`);
      out(`                custom string[] docGraph:entities = ${usdStringArray(node.entities)}`);
      out(`                custom string[] docGraph:keywords = ${usdStringArray(node.keywords)}`);
      out('            }');
    }
    out('        }');
  }
  out('    }');
  out('');

  // --- Connections: one BasisCurves per edge kind --------------------------
  out('    def Scope "Connections"');
  out('    {');
  for (const kind of EDGE_KINDS) {
    const edges = input.edges.filter(
      (e) => e.kind === kind && positionOf.has(e.source) && positionOf.has(e.target),
    );
    if (edges.length === 0) continue;
    const points = edges
      .flatMap((e) => [positionOf.get(e.source)!, positionOf.get(e.target)!])
      .map(vec3);
    out(`        def BasisCurves "Edges_${kind}"`);
    out('        {');
    out('            uniform token type = "linear"');
    out(`            int[] curveVertexCounts = [${edges.map(() => '2').join(', ')}]`);
    out(`            point3f[] points = [${points.join(', ')}]`);
    out('            float[] widths = [0.15] (interpolation = "constant")');
    out(
      `            color3f[] primvars:displayColor = [${vec3(hexToLinearRgb(EDGE_KIND_HEX[kind]))}] (interpolation = "constant")`,
    );
    out(
      `            custom float[] docGraph:weights = [${edges.map((e) => num(e.weight)).join(', ')}]`,
    );
    out(
      `            custom string[] docGraph:sourceIds = ${usdStringArray(edges.map((e) => e.source))}`,
    );
    out(
      `            custom string[] docGraph:targetIds = ${usdStringArray(edges.map((e) => e.target))}`,
    );
    out(
      `            custom string[] docGraph:evidence = ${usdStringArray(edges.map((e) => e.evidence.join('; ')))}`,
    );
    out('        }');
  }
  out('    }');
  out('');

  // --- Cluster hulls: centroid + bounding-radius spheres -------------------
  out('    def Scope "ClusterHulls"');
  out('    {');
  for (const clusterId of clusterIds) {
    if (clusterId < 0) continue;
    const members = byCluster.get(clusterId)!;
    const centroid: Vec3 = [0, 0, 0];
    for (const m of members) {
      centroid[0] += m.position[0] / members.length;
      centroid[1] += m.position[1] / members.length;
      centroid[2] += m.position[2] / members.length;
    }
    let radius = 2;
    for (const m of members) {
      const d = Math.hypot(
        m.position[0] - centroid[0],
        m.position[1] - centroid[1],
        m.position[2] - centroid[2],
      );
      radius = Math.max(radius, d + 2);
    }
    const clusterName = input.clusterNames[clusterId] ?? `Cluster ${clusterId}`;
    out(`        def Sphere "Hull_${clusterId}" (`);
    out(`            displayName = ${usdString(clusterName)}`);
    out('        )');
    out('        {');
    out(`            double radius = ${num(radius)}`);
    out(`            color3f[] primvars:displayColor = [${vec3(members[0].color)}]`);
    out('            float[] primvars:displayOpacity = [0.25]');
    out(`            double3 xformOp:translate = ${vec3(centroid)}`);
    out('            uniform token[] xformOpOrder = ["xformOp:translate"]');
    out(`            custom int docGraph:clusterId = ${clusterId}`);
    out(`            custom string docGraph:clusterName = ${usdString(clusterName)}`);
    out(`            custom int docGraph:memberCount = ${members.length}`);
    out('        }');
  }
  out('    }');
  out('}');
  out('');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Browser wrapper: gather live state -> .usda download
// ---------------------------------------------------------------------------

function toUsdNode(node: DocNode, position: Vec3): UsdNodeInput {
  const c = clusterColor(node.cluster); // read-only cached THREE.Color (linear rgb)
  return {
    id: node.id,
    kind: node.kind,
    title: node.title,
    fileType: node.fileType,
    cluster: node.cluster,
    degree: node.degree,
    status: node.status,
    wordCount: node.wordCount,
    topics: node.topics,
    entities: node.entities,
    keywords: node.keywords,
    position,
    color: [c.r, c.g, c.b],
  };
}

/** Same privacy envelope as the shareable URL: metadata only, no full text. */
export function toUsdStageInput(): UsdStageInput {
  const state = useGraphStore.getState();
  const nodes: UsdNodeInput[] = [];
  for (const node of state.nodes) {
    const position = getNodePosition(node.id);
    if (position) nodes.push(toUsdNode(node, position));
  }
  const clusterNames: Record<number, string> = {};
  for (const node of nodes) {
    if (node.cluster >= 0 && !(node.cluster in clusterNames)) {
      clusterNames[node.cluster] =
        state.clusterNames[node.cluster] ??
        state.localClusterNames[node.cluster] ??
        `Cluster ${node.cluster}`;
    }
  }
  const edges: UsdEdgeInput[] = state.edges.map((e: Edge) => ({
    source: e.source,
    target: e.target,
    kind: e.kind,
    weight: e.weight,
    evidence: e.evidence,
  }));
  return { nodes, edges, clusterNames, createdAt: new Date().toISOString() };
}

export async function exportGraphUSD(): Promise<void> {
  const { downloadBlob, dateStamp } = await import('./exportImport');
  const text = buildUsdaStage(toUsdStageInput());
  const blob = new Blob([text], { type: 'text/plain' });
  downloadBlob(blob, `document-graph-explorer-${dateStamp()}.usda`);
}

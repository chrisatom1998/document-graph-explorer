/**
 * Topic-hub synthesis shared by ingest/removal and optional AI enrichment.
 *
 * This lives outside coordinator.ts so enrichment can rebuild the hubs after
 * replacing document topics without importing the PDF/worker orchestrator.
 */

import { TOPIC_MAX_DOC_FRACTION, TOPIC_MIN_DOCS } from '../config';
import {
  layoutAddNodes,
  layoutReheat,
  layoutRemoveNodes,
  layoutSetLinks,
} from '../layout/layoutBridge';
import type { DocNode, Edge } from '../model/types';
import { useGraphStore } from '../store/graphStore';
import { randomSpherePoint } from './spawnPosition';
import { groupTopics } from './topics';

const TOPIC_EDGE_WEIGHT = 0.5;
const SPAWN_RADIUS = 140;
const SPAWN_JITTER = 25;

function randomSpawn(): [number, number, number] {
  return randomSpherePoint(SPAWN_RADIUS, SPAWN_JITTER);
}

/**
 * Rebuild synthetic topic-concept nodes from the current document topics.
 * Existing hubs and their edges are removed first, making this idempotent.
 */
export function synthesizeTopicNodes(): void {
  const store = useGraphStore.getState;
  const existingTopics = store().nodes.filter((n) => n.kind === 'topic').map((n) => n.id);
  if (existingTopics.length > 0) store().removeNodes(existingTopics);

  const documents = store().nodes.filter((n) => n.kind === 'document');
  const groups = groupTopics(
    documents.map((n) => ({ id: n.id, topics: n.topics, title: n.title, topicsSource: n.topicsSource })),
    { minDocs: TOPIC_MIN_DOCS, maxDocFraction: TOPIC_MAX_DOC_FRACTION },
  );

  const newNodes: DocNode[] = [];
  const newEdges: Edge[] = [];

  for (const { key, label, docIds } of groups) {
    const topicId = `topic:${key}`;

    const clusterVotes = new Map<number, number>();
    for (const docId of docIds) {
      const idx = store().nodeIndex[docId];
      if (idx === undefined) continue;
      const cluster = store().nodes[idx].cluster;
      if (cluster >= 0) clusterVotes.set(cluster, (clusterVotes.get(cluster) ?? 0) + 1);
    }
    let bestCluster = -1;
    let bestCount = 0;
    for (const [cluster, count] of clusterVotes) {
      if (count > bestCount) {
        bestCluster = cluster;
        bestCount = count;
      }
    }

    newNodes.push({
      id: topicId,
      kind: 'topic',
      title: label,
      fileType: 'other',
      topics: [label],
      entities: [],
      keywords: [],
      wordCount: 0,
      cluster: bestCluster,
      degree: docIds.length,
      status: 'ok',
    });

    for (const docId of docIds) {
      newEdges.push({
        id: `${docId}->${topicId}:topic`,
        source: docId,
        target: topicId,
        kind: 'topic',
        weight: TOPIC_EDGE_WEIGHT,
        evidence: [`Shared topic: "${label}"`],
      });
    }
  }

  // Slots are append-only, so explicitly free hubs that disappeared.
  const newIds = new Set(newNodes.map((n) => n.id));
  const staleTopicIds = existingTopics.filter((id) => !newIds.has(id));
  if (staleTopicIds.length > 0) layoutRemoveNodes(staleTopicIds);
  if (newNodes.length === 0) return;

  // Hubs rejected at the layout capacity must not become invisible store
  // nodes or leave dangling edges behind.
  const droppedIds = new Set(
    layoutAddNodes(
      newNodes.map((n) => ({ id: n.id, cluster: n.cluster, spawn: randomSpawn() })),
    ),
  );
  const placedNodes = newNodes.filter((n) => !droppedIds.has(n.id));
  const placedEdges = newEdges.filter(
    (edge) => !droppedIds.has(edge.source) && !droppedIds.has(edge.target),
  );
  if (placedNodes.length === 0) return;

  store().addNodes(placedNodes);
  const edges = [...store().edges, ...placedEdges];
  store().setEdges(edges);
  layoutSetLinks(edges.map((edge) => ({
    source: edge.source,
    target: edge.target,
    weight: edge.weight,
  })));
  layoutReheat(0.3);
}

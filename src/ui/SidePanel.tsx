import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { DUP_SIM_THRESHOLD } from '../config';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';
import { docVectorStore } from '../store/runtimeStores';
import { useDocText } from './useDocText';
import { hexFor } from '../scene/palette';
import { timeAgo } from '../util/relativeTime';
import { useSettingsStore } from '../store/settingsStore';
import { codeLanguageForNode, fileTypeChip, fileTypeLabel } from '../pipeline/codeLanguage';
import { openCompare } from './openCompare';
import { type ConnectionRow } from './sidePanelModel';
import SidePanelAbout from './SidePanelAbout';
import SidePanelConnections from './SidePanelConnections';
import SidePanelHeader from './SidePanelHeader';
import SidePanelReader from './SidePanelReader';

function Disclose({
  label,
  open,
  onToggle,
  compact,
  children,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  compact?: boolean;
  children: ReactNode;
}) {
  const sectionClass = compact ? 'side-panel__section side-panel__section--compact' : 'side-panel__section';
  return (
    <div className={sectionClass}>
      <button
        type="button"
        className="side-panel__disclose"
        aria-expanded={open}
        aria-label={label}
        title={open ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
        onClick={onToggle}
      >
        {label}
        <span className="side-panel__disclose-hint">{open ? 'Hide' : 'Show'}</span>
      </button>
      {/* Keep children mounted so Ask AI (and other local state) survives collapse. */}
      <div hidden={!open}>{children}</div>
    </div>
  );
}

export default function SidePanel() {
  const selectedId = useUiStore((s) => s.selectedId);
  const readerHighlight = useUiStore((s) => s.readerHighlight);
  const offlineMode = useSettingsStore((s) => s.offlineMode);

  const nodes = useGraphStore((s) => s.nodes);
  const nodeIndex = useGraphStore((s) => s.nodeIndex);
  const edges = useGraphStore((s) => s.edges);
  const clusterNames = useGraphStore((s) => s.clusterNames);
  const localClusterNames = useGraphStore((s) => s.localClusterNames);

  const node = selectedId !== null ? nodes[nodeIndex[selectedId]] : undefined;
  const nodeId = node?.id;
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!nodeId) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();
    return () => {
      if (previouslyFocused && previouslyFocused !== document.body && previouslyFocused.isConnected) {
        previouslyFocused.focus();
      } else {
        // A canvas click leaves document.body as the active element. Sending
        // focus to GraphNavigator here made its normally-hidden panel slide
        // over most of compact viewports and intercept both orbit and node
        // clicks. Return focus to the graph surface instead; tabIndex=-1 keeps
        // it out of the normal keyboard order while allowing this restoration.
        const graphSurface = document.querySelector<HTMLElement>('.nebula-canvas');
        if (graphSurface) graphSurface.focus({ preventScroll: true });
        else document.querySelector<HTMLElement>('.graph-navigator__list')?.focus();
      }
    };
  }, [nodeId]);

  // Two-step inline confirm for the destructive Remove action. Reset whenever
  // the selection changes so an armed confirm never lingers onto a different
  // document (or survives the panel closing and reopening).
  const [confirmRemove, setConfirmRemove] = useState(false);
  useEffect(() => {
    setConfirmRemove(false);
  }, [selectedId]);

  // About / Connections start collapsed so the reader is on screen. Topic
  // hubs have no reader — their member list is the primary content, so
  // Connections opens instead. Passage fly-tos keep both closed, including
  // same-document search/chat commits that only update readerHighlight.
  const [aboutOpen, setAboutOpen] = useState(false);
  const [connectionsOpen, setConnectionsOpen] = useState(false);
  useEffect(() => {
    const graph = useGraphStore.getState();
    const selected = selectedId !== null ? graph.nodes[graph.nodeIndex[selectedId]] : undefined;
    const highlightMatches = selected !== undefined && readerHighlight?.docId === selected.id;
    setAboutOpen(false);
    setConnectionsOpen(selected?.kind === 'topic' && !highlightMatches);
  }, [selectedId, readerHighlight]);

  // Connections are uncapped by nature (a hub document can have dozens, each
  // with several evidence lines). Show the strongest few by default; the list
  // is already sorted by weight, so nothing high-signal hides behind this.
  const [showAllConnections, setShowAllConnections] = useState(false);
  // Evidence expands per row (by edge id) — a reference edge can carry a
  // dozen "mentions …" lines, and one long row shouldn't push the rest away.
  const [expandedEvidence, setExpandedEvidence] = useState<Set<string>>(new Set());
  useEffect(() => {
    setShowAllConnections(false);
    setExpandedEvidence(new Set());
  }, [selectedId]);

  const toggleEvidence = (edgeId: string): void => {
    setExpandedEvidence((prev) => {
      const next = new Set(prev);
      if (!next.delete(edgeId)) next.add(edgeId);
      return next;
    });
  };

  const connections = useMemo<ConnectionRow[]>(() => {
    if (!node) return [];
    const rows: ConnectionRow[] = [];
    for (const edge of edges) {
      let neighborId: string | null = null;
      if (edge.source === node.id) neighborId = edge.target;
      else if (edge.target === node.id) neighborId = edge.source;
      if (!neighborId) continue;
      const neighbor = nodes[nodeIndex[neighborId]];
      rows.push({ edge, neighborId, neighbor });
    }
    rows.sort((a, b) => b.edge.weight - a.edge.weight);
    return rows;
  }, [node, edges, nodes, nodeIndex]);

  // Near-duplicates of THIS doc: exact vector cosine against every other
  // document, not just existing semantic-edge neighbors — a genuine
  // duplicate can be crowded out of the mutual-top-k edge rule by other
  // near-duplicates (see similarity.ts), so scanning edges alone would miss
  // it. O(n) for the selected node only, cheap enough for the main thread.
  const duplicatesOf = useMemo<{ id: string; sim: number }[]>(() => {
    if (!node) return [];
    const va = docVectorStore.get(node.id);
    if (!va) return [];
    const out: { id: string; sim: number }[] = [];
    for (const other of nodes) {
      if (other.id === node.id || other.kind !== 'document') continue;
      const vb = docVectorStore.get(other.id);
      if (!vb || vb.length !== va.length) continue;
      let dot = 0;
      for (let d = 0; d < va.length; d += 1) dot += va[d] * vb[d];
      if (dot >= DUP_SIM_THRESHOLD) out.push({ id: other.id, sim: dot });
    }
    out.sort((x, y) => y.sim - x.sim);
    return out;
  }, [node, nodes]);

  // Gates the Ask-AI section below; hydrates an evicted body on demand.
  const { text: fullText } = useDocText(node?.kind === 'document' ? node.id : undefined);

  if (!node) return null;

  const clusterLabel =
    clusterNames[node.cluster] ?? localClusterNames[node.cluster] ?? `Cluster ${node.cluster}`;
  const clusterColor = hexFor(node.cluster);
  const codeLang = codeLanguageForNode(node);
  const typeChip = node.kind === 'topic' ? 'Topic hub' : fileTypeChip(node);
  const readerLabel = codeLang?.label ?? fileTypeLabel(node);
  const isDocument = node.kind === 'document';
  const isTopic = node.kind === 'topic';
  const dialogLabel = isTopic
    ? `${node.title} (topic hub, ${node.degree} document${node.degree === 1 ? '' : 's'})`
    : codeLang
      ? `${node.title} (${codeLang.label})`
      : node.title;

  return (
    <div className="side-panel-layer">
      <div className="side-panel glass-panel" role="dialog" aria-label={dialogLabel}>
        <SidePanelHeader
          node={node}
          codeLang={codeLang}
          confirmRemove={confirmRemove}
          onArmRemove={() => setConfirmRemove(true)}
          onCancelRemove={() => setConfirmRemove(false)}
          closeButtonRef={closeButtonRef}
        />
        <div className="side-panel__scroll">
          <div className="side-panel__identity">
            <div className="side-panel__badges">
              <span className="chip">{typeChip}</span>
              <span className="chip">
                <span
                  className="chip-dot"
                  style={{ background: clusterColor }}
                  aria-hidden="true"
                />
                {clusterLabel}
              </span>
              {node.status !== 'ok' && (
                <span className="chip side-panel__badge-warning">
                  ⚠ {node.warning ?? node.status}
                </span>
              )}
              {duplicatesOf.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  className="chip chip-selectable side-panel__badge-warning side-panel__dup-chip"
                  title={`${(d.sim * 100).toFixed(1)}% similar — compare these side by side`}
                  onClick={() => openCompare(node.id, d.id)}
                >
                  ≈ duplicate of {nodes[nodeIndex[d.id]]?.title ?? d.id}
                </button>
              ))}
            </div>

            <div className="side-panel__stats">
              {isTopic ? (
                <span>
                  {node.degree} document{node.degree === 1 ? '' : 's'}
                </span>
              ) : (
                <>
                  <span>{node.wordCount.toLocaleString()} words</span>
                  <span>{node.degree} connection{node.degree === 1 ? '' : 's'}</span>
                </>
              )}
              {node.lastModified !== undefined && (
                <span title={new Date(node.lastModified).toLocaleString()}>
                  updated {timeAgo(node.lastModified)}
                </span>
              )}
            </div>
          </div>

          {isDocument && (
            <SidePanelReader
              node={node}
              nodes={nodes}
              readerHighlight={readerHighlight}
              readerLabel={readerLabel}
              codeLang={codeLang}
            />
          )}

          {isDocument && (
            <Disclose
              label="About"
              open={aboutOpen}
              onToggle={() => setAboutOpen((v) => !v)}
              compact
            >
              <SidePanelAbout
                node={node}
                nodes={nodes}
                nodeIndex={nodeIndex}
                fullText={fullText}
                offlineMode={offlineMode}
              />
            </Disclose>
          )}

          {isTopic ? (
            <div className="side-panel__section">
              <p className="side-panel__section-label">Documents</p>
              <SidePanelConnections
                connections={connections}
                showAllConnections={showAllConnections}
                expandedEvidence={expandedEvidence}
                onToggleShowAll={() => setShowAllConnections((v) => !v)}
                onToggleEvidence={toggleEvidence}
              />
            </div>
          ) : (
            <Disclose
              label="Connections"
              open={connectionsOpen}
              onToggle={() => setConnectionsOpen((v) => !v)}
              compact
            >
              <SidePanelConnections
                sourceId={node.id}
                connections={connections}
                showAllConnections={showAllConnections}
                expandedEvidence={expandedEvidence}
                onToggleShowAll={() => setShowAllConnections((v) => !v)}
                onToggleEvidence={toggleEvidence}
              />
            </Disclose>
          )}
        </div>
      </div>
    </div>
  );
}

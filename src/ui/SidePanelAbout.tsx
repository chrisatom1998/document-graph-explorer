import { AIRGAP } from '../airgap';
import { canonicalizeTopic } from '../pipeline/topics';
import { annotationKey } from '../store/annotationStore';
import type { DocNode } from '../model/types';
import DocAiSection from './DocAiSection';
import NotesTagsSection from './NotesTagsSection';
import { focusNode } from './focusNode';

interface SidePanelAboutProps {
  node: DocNode;
  nodes: DocNode[];
  nodeIndex: Record<string, number>;
  fullText: string | undefined;
  offlineMode: boolean;
}

export default function SidePanelAbout({
  node,
  nodes,
  nodeIndex,
  fullText,
  offlineMode,
}: SidePanelAboutProps) {
  const entities = node.entities.slice(0, 8);

  return (
    <div className="side-panel__disclose-body">
      <div className="side-panel__block">
        <p className="side-panel__section-label">Summary</p>
        <p className={`side-panel__summary${node.summary ? '' : ' is-fallback'}`}>
          {node.summary || 'No summary available yet.'}
        </p>
      </div>

      {node.topics.length > 0 && (
        <div className="side-panel__block">
          <p className="side-panel__section-label">Topics</p>
          <div className="side-panel__chip-row">
            {node.topics.map((t) => {
              // A topic becomes a hub node when ≥2 docs share it. When one
              // exists, the chip jumps to that hub — where the Connections
              // list shows every document carrying the topic — and shows
              // how many docs that is. Otherwise it's a plain label.
              const hub = nodes[nodeIndex[`topic:${canonicalizeTopic(t)}`]];
              if (!hub || hub.id === node.id) {
                return (
                  <span key={t} className="chip">
                    {t}
                  </span>
                );
              }
              return (
                <button
                  key={t}
                  type="button"
                  className="chip chip-selectable side-panel__topic-chip"
                  title={`${hub.degree} document${hub.degree === 1 ? '' : 's'} share this topic — open the topic hub`}
                  onClick={() => focusNode(hub.id)}
                >
                  {t}
                  <span className="side-panel__topic-count">{hub.degree}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {entities.length > 0 && (
        <div className="side-panel__block">
          <p className="side-panel__section-label">Entities</p>
          <div className="side-panel__chip-row">
            {entities.map((e) => (
              <span key={e} className="chip chip-muted">
                {e}
              </span>
            ))}
          </div>
        </div>
      )}

      {node.kind === 'document' && (
        /* key resets the tag draft when the selection changes */
        <NotesTagsSection key={node.id} docKey={annotationKey(node)} />
      )}

      {!(AIRGAP || offlineMode) && fullText && (
        <>
          <hr className="hairline" />
          {/* key resets the Q&A state when the selection changes */}
          <DocAiSection key={node.id} docId={node.id} title={node.title} />
        </>
      )}
    </div>
  );
}

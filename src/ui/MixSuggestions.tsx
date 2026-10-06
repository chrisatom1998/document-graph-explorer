import { useMemo } from 'react';
import type { DocNode } from '../model/types';
import { camelotCode, mixFeatures, mixSuggestions } from '../audio/mixSuggestions';
import { focusNode } from './focusNode';

/** Tracks from the whole library that mix with this one: Camelot key, tempo within 6% (half/double allowed), then sound. */
export default function MixSuggestions({ node, nodes, limit = 5 }: { node: DocNode; nodes: DocNode[]; limit?: number }) {
  const rows = useMemo(() => mixSuggestions(node, nodes, { limit }), [node, nodes, limit]);
  const self = useMemo(() => node.audio ? mixFeatures(node) : undefined, [node]);
  if (!self) return null;
  const header = [self.tempo && `${self.tempo.bpm.toFixed(0)} BPM`, self.key && `${camelotCode(self.key)} ${self.key.display}`].filter(Boolean).join(' · ');
  return <section className="audio-related mix-suggestions" aria-label="Mix suggestions">
    <h3>Mix with{header && <small>{header}</small>}</h3>
    {rows.map(row => <button key={row.node.id} type="button" onClick={() => focusNode(row.node.id)} title={row.reasons.join('; ')}>
      <span className="audio-related-icon" aria-hidden="true">{row.camelot ?? '♫'}</span>
      <span>{row.node.title}<small>{row.reasons.join(' · ')}</small></span>
      <span aria-hidden="true">↗</span>
    </button>)}
    {!rows.length && <p>{self.tempo || self.key ? 'No tracks in this library are in a compatible key and tempo yet.' : 'Tempo and key are not known for this track yet.'}</p>}
  </section>;
}

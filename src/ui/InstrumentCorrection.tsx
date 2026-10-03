import { useState } from 'react';
import { INSTRUMENT_LABELS } from '../audio/instrumentLabels';
import { useGraphStore } from '../store/graphStore';
import type { DocNode } from '../model/types';

export default function InstrumentCorrection({ node }: { node: DocNode }) {
  const phase = useGraphStore(s => s.phase);
  const [label, setLabel] = useState('synthesizer');
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const save = async (reset = false) => {
    setBusy(true); setMessage('');
    try {
      const ids = all ? useGraphStore.getState().nodes.filter(n => n.fileType === 'audio' && n.audio).map(n => n.id) : [node.id];
      const { setAudioInstruments } = await import('../pipeline/coordinatorLazy');
      const result = await setAudioInstruments(ids, reset ? undefined : [label]);
      const action = reset ? 'Instrument override removed' : 'Instrument updated';
      setMessage(`${action} for ${result.count} track${result.count === 1 ? '' : 's'}. ${result.saved ? 'Saved on this device.' : 'Export this graph to keep your changes.'}`);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not save the instrument.'); }
    finally { setBusy(false); }
  };
  return <details>
    <summary>Correct the instrument</summary>
    <p>Choose the instrument you know is present. This replaces the displayed instrument estimates and updates connections.</p>
    <label>Known instrument <select value={label} onChange={event => setLabel(event.target.value)}>
      {INSTRUMENT_LABELS.map(value => <option key={value} value={value}>{value}</option>)}
    </select></label>
    <label className="instrument-correction-scope"><input type="checkbox" checked={all} onChange={event => setAll(event.target.checked)} />Apply to all analyzed audio tracks in this collection</label>
    <button type="button" disabled={busy || phase !== 'ready'} onClick={() => void save()}>Save confirmed instrument</button>
    {(node.audio?.confirmedInstruments !== undefined || all) && <button type="button" disabled={busy || phase !== 'ready'} onClick={() => void save(true)}>{node.audio?.soundReviews?.length || node.audio?.confirmedDjTags ? 'Remove instrument override' : 'Use automatic estimates'}</button>}
    <p>Your correction replaces automatic estimates. Reanalysis keeps it until you remove this override. Separate sound-tag corrections and individual evidence reviews still apply.</p>
    {message && <p role="status">{message}</p>}
  </details>;
}

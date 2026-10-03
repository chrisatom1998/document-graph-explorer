import { useState } from 'react';
import { DJ_CATALOG, DJ_LABELS, type ConfirmedDjTags, type DjGroup } from '../audio/djTags';
import type { DocNode } from '../model/types';
import { useGraphStore } from '../store/graphStore';
const names: Record<DjGroup,string> = {source:'Source',production:'Production type',character:'Character'};
function automaticTags(node: DocNode): ConfirmedDjTags {
  return Object.fromEntries(Object.keys(DJ_LABELS).map(group => [
    group, node.audio?.soundProfile?.djTags?.filter(tag => tag.group === group).map(tag => tag.label) ?? [],
  ])) as ConfirmedDjTags;
}
export default function DjTagCorrection({node}:{node:DocNode}) {
  const phase=useGraphStore(s=>s.phase);
  const [labels,setLabels]=useState<ConfirmedDjTags>(()=>node.audio?.confirmedDjTags ?? automaticTags(node));
  const [query,setQuery]=useState('');
  const [busy,setBusy]=useState(false);const [message,setMessage]=useState('');
  const save = async (reset = false) => {
    setBusy(true);
    try {
      const { setAudioDjTags } = await import('../pipeline/coordinatorLazy');
      const saved = await setAudioDjTags(node.id, reset ? undefined : labels);
      if (reset) setLabels(automaticTags(node));
      setMessage(saved ? reset ? 'Automatic DJ tags restored.' : 'Your DJ tags are saved.' : 'Tags updated. Export this graph to keep the changes.');
    } catch {
      setMessage('Could not save tags. Try again.');
    } finally {
      setBusy(false);
    }
  };
  return <details><summary>Correct DJ tags</summary>
    <p>Save the sounds you know are present. Corrections stay separate from model guesses and are included in collection exports.</p>
    <label>Find a sound category<input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Vocal chop, breath, Reese, riser…" /></label>
    <p>{DJ_CATALOG.length} categories. Automatic matches are estimates; accuracy has not been established for every category.</p>
    {(Object.keys(DJ_LABELS) as DjGroup[]).map(group=><fieldset key={group}><legend>{names[group]}</legend><div className="dj-tag-choices">{DJ_LABELS[group].filter(label=>labels[group].includes(label) || DJ_CATALOG.some(c=>c.group===group && c.label===label && [c.label,c.family,...c.aliases].some(v=>v.includes(query.trim().toLowerCase())))).map(label=><label key={label}><input type="checkbox" checked={labels[group].includes(label)} onChange={e=>setLabels(previous=>({...previous,[group]:e.target.checked?[...previous[group],label]:previous[group].filter(v=>v!==label)}))}/>{label}</label>)}</div></fieldset>)}
    <button disabled={busy||phase!=='ready'} onClick={()=>void save()}>Save DJ tags</button>
    {node.audio?.confirmedDjTags && <button disabled={busy||phase!=='ready'} onClick={()=>void save(true)}>Use automatic DJ tags</button>}
    <p>These corrections do not automatically retrain the models.</p>{message&&<p role="status">{message}</p>}
  </details>;
}

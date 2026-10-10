import { resolvedNonSourceLabels } from '../audio/soundReviewPolicy';
import { confirmedInstrumentList, sourceReviewAllows } from '../audio/instrumentEvidence';
import { useState } from 'react';
import { DJ_CATALOG, DJ_LABELS, DJ_PICKER_LABELS, MERGED_DJ_LABELS, mergedDjLabel, soundLabelText, type ConfirmedDjTags, type DjGroup } from '../audio/djTags';
import type { DocNode } from '../model/types';
import { useGraphStore } from '../store/graphStore';
const names: Record<DjGroup,string> = {source:'Source',production:'Production type',character:'Character'};
const PICKER_COUNT = Object.values(DJ_PICKER_LABELS).flat().length;
/** Merged-away names still find the tag they now show under. */
const MERGED_FROM: Record<string,string[]> = {};
for (const [from, to] of Object.entries(MERGED_DJ_LABELS)) (MERGED_FROM[`${to.group}:${to.label}`] ??= []).push(from.split(':')[1]);
/** Automatic tags under their merged names, so a box for a merged-away label never shows up checked and hidden. */
function mergedTags(tags: ConfirmedDjTags): ConfirmedDjTags {
  const out: ConfirmedDjTags = {source:[],production:[],character:[]};
  for (const group of Object.keys(out) as DjGroup[]) for (const label of tags[group]) { const m = mergedDjLabel(group,label); if (!out[m.group].includes(m.label)) out[m.group].push(m.label); }
  return out;
}
function automaticTags(node: DocNode): ConfirmedDjTags {
  const audio=node.audio;
  if(!audio)return {source:[],production:[],character:[]};
  const nonSource=resolvedNonSourceLabels(audio);
  return {source:confirmedInstrumentList(audio)??audio.soundProfile?.djTags?.filter(t=>t.group==='source'&&sourceReviewAllows(audio,t.label)).map(t=>t.label)??[],
    production:nonSource.filter(t=>t.group==='production').map(t=>t.label),
    character:nonSource.filter(t=>t.group==='character').map(t=>t.label)};
}
export default function DjTagCorrection({node}:{node:DocNode}) {
  return <DjTagEditor key={JSON.stringify([node.id,node.audio?.soundReviews])} node={node}/>;
}
function DjTagEditor({node}:{node:DocNode}) {
  const phase=useGraphStore(s=>s.phase);
  const [labels,setLabels]=useState<ConfirmedDjTags>(()=>mergedTags(automaticTags(node)));
  const [query,setQuery]=useState('');
  const [busy,setBusy]=useState(false);const [message,setMessage]=useState('');
  const save = async (reset = false) => {
    setBusy(true);
    try {
      const { setAudioDjTags } = await import('../pipeline/coordinatorLazy');
      const saved = await setAudioDjTags(node.id, reset ? undefined : labels);
      if (reset) setLabels(mergedTags(automaticTags(node)));
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
    <p>{PICKER_COUNT} categories. Automatic matches are estimates; accuracy has not been established for every category.</p>
    {(Object.keys(DJ_LABELS) as DjGroup[]).map(group=><fieldset key={group}><legend>{names[group]}</legend><div className="dj-tag-choices">{DJ_PICKER_LABELS[group].filter(label=>labels[group].includes(label) || DJ_CATALOG.some(c=>c.group===group && c.label===label && [c.label,c.family,...c.aliases,...(MERGED_FROM[`${group}:${label}`]??[])].some(v=>v.includes(query.trim().toLowerCase())))).map(label=><label key={label}><input type="checkbox" checked={labels[group].includes(label)} onChange={e=>setLabels(previous=>({...previous,[group]:e.target.checked?[...previous[group],label]:previous[group].filter(v=>v!==label)}))}/>{soundLabelText(label)}</label>)}</div></fieldset>)}
    <button disabled={busy||phase!=='ready'} onClick={()=>void save()}>Save DJ tags</button>
    {node.audio?.confirmedDjTags && <button disabled={busy||phase!=='ready'} onClick={()=>void save(true)}>Use automatic DJ tags</button>}
    <p>These corrections do not automatically retrain the models.</p>{message&&<p role="status">{message}</p>}
  </details>;
}

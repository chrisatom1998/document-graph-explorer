import { useMemo, useState } from 'react';
import { soundLabelText } from '../audio/djTags';
import { soundTagFixOptions, type SoundTagFix } from '../audio/soundTagFixes';

/** The small "Not sure? Fix it" panel for one uncertain tag: keep it, remove it, or pick the right tag. */
export default function SoundTagFixer({tag,onFix,onClose}:{tag:{dimension:SoundTagFix['dimension'];label:string};
  onFix:(fix:Omit<SoundTagFix,'at'>)=>Promise<unknown>;onClose:()=>void}) {
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const groups=useMemo(()=>soundTagFixOptions().map(g=>({...g,options:g.options.filter(o=>o.dimension!==tag.dimension||o.label!==tag.label)})),[tag.dimension,tag.label]);
  const name=soundLabelText(tag.label);
  const save=async(fix:Omit<SoundTagFix,'at'>)=>{
    setBusy(true);setError('');
    try{await onFix(fix);onClose();}
    catch(e){setError(e instanceof Error?e.message:'Could not save this fix.');}
    finally{setBusy(false);}
  };
  return <div className="sound-tag-fixer" role="group" aria-label={`Fix ${name}`}>
    <p className="sound-tag-fixer__question">Is <strong>{name}</strong> right?</p>
    <div className="sound-tag-fixer__actions">
      <button type="button" disabled={busy} onClick={()=>void save({...tag,action:'keep'})}>Keep</button>
      <button type="button" disabled={busy} onClick={()=>void save({...tag,action:'remove'})}>Remove</button>
      <select aria-label="Pick the right tag" disabled={busy} value="" onChange={event=>{
        const [dimension,...rest]=event.target.value.split(':');const label=rest.join(':');
        if(label)void save({...tag,action:'replace',to:{dimension:dimension as SoundTagFix['dimension'],label}});
      }}>
        <option value="">Pick the right tag…</option>
        {groups.map(g=><optgroup key={g.group} label={g.group}>{g.options.map(o=><option key={`${o.dimension}:${o.label}`} value={`${o.dimension}:${o.label}`}>{o.text}</option>)}</optgroup>)}
      </select>
      <button type="button" className="sound-tag-fixer__close" disabled={busy} onClick={onClose} aria-label="Close fix">Cancel</button>
    </div>
    {error&&<p role="alert" className="sound-tag-fixer__error">{error}</p>}
  </div>;
}

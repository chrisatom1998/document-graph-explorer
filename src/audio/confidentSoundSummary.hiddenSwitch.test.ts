import {afterEach,expect,it} from 'vitest';
import {confidentSoundSummary} from './confidentSoundSummary';
import {DJ_HIDDEN_LABELS} from './djTags';
import {setHiddenSoundTagsShown} from './hiddenSoundTagsSwitch';
import type {MusicAnalysis} from './musicTypes';
const clip=(...labels:string[]):MusicAnalysis=>({version:2,durationSeconds:8,analyzedSeconds:8,instruments:[],notes:[],
  soundProfile:{version:1,character:[],roles:[],models:[],disagreement:false,djTags:labels.map(label=>({group:'production' as const,label,score:.9,model:'Trained head' as const}))}});
afterEach(()=>setHiddenSoundTagsShown(true));
it('cowbell is a hidden tag (fixture check)',()=>{expect(DJ_HIDDEN_LABELS.has('production:cowbell')).toBe(true)});
it('shows hidden tags on clips while the switch is on (the default)',()=>{
  expect(confidentSoundSummary(clip('kick','cowbell')).map(s=>s.label)).toEqual(expect.arrayContaining(['kick','cowbell']));
});
it('drops hidden tags, and only them, when the switch is off',()=>{
  setHiddenSoundTagsShown(false);
  const labels=confidentSoundSummary(clip('kick','cowbell')).map(s=>s.label);
  expect(labels).toContain('kick');expect(labels).not.toContain('cowbell');
});

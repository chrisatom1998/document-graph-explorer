import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { DJ_CATALOG, DJ_LABELS, canonicalDjLabel, sanitizeConfirmedDjTags, selectDjTags } from './djTags';
import { mergeDjTags } from './djClassification';
import { DescriptionAccumulator, descriptionScores, type DescriptionGroup } from './profileDescriptions';
import type { SoundProfile } from './soundProfile';

it('keeps generic chops independent from vocal chops and does not infer a voice source', () => {
  expect(canonicalDjLabel('production', 'chop')).toBe('chops');
  expect(canonicalDjLabel('production', 'chops')).toBe('chops');
  expect(canonicalDjLabel('production', 'vocal chop')).toBe('vocal chops');
  expect(canonicalDjLabel('production', 'vox chop')).toBe('vocal chops');
  const profile: SoundProfile = {version:1,character:[],roles:[],disagreement:false,models:[]};
  mergeDjTags(profile, [{group:'production',label:'chops',score:.9,model:'Music CLAP'}]);
  expect(profile.djTags).toEqual([{group:'production',label:'chops',score:.9,model:'Music CLAP'}]);
  expect(profile.source).toBeUndefined();
});

it('ships matching finite CLAP vectors for every catalog category and competing unknowns', () => {
  const prompts = JSON.parse(readFileSync('public/sound-model/prompts.json', 'utf8'));
  expect(DJ_CATALOG.length).toBeGreaterThanOrEqual(190);
  expect(new Set(DJ_CATALOG.map(c => `${c.group}:${c.label}`)).size).toBe(DJ_CATALOG.length);
  for (const category of DJ_CATALOG) {
    // A derived tag (e.g. vocal one-shot from the one-shot voice head) is never chosen by CLAP similarity, so it has no prompt.
    if ('derivedFrom' in category) { expect(prompts.some((p: {label: string}) => p.label === category.label)).toBe(false); continue; }
    const match = prompts.find((p: {group: string; label: string}) => p.group === category.axis && p.label === category.label);
    expect(match, category.label).toBeDefined();
    expect(match.vector).toHaveLength(512);
    expect(match.vector.every(Number.isFinite)).toBe(true);
    expect(prompts.some((p: {group: string; label: string | null}) => p.group === category.axis && p.label === null), category.axis).toBe(true);
    expect(category.recognition).toBe('experimental');
  }
});

it('retains simultaneous vocal, bass and drum estimates and rejects tied or weak new-family results', () => {
  const scores = ['vocal shout','reese bass','kick'].flatMap(label => {
    const c = DJ_CATALOG.find(c => c.label === label)!;
    return [{group: c.axis as DescriptionGroup,label,score:.65}, {group:c.axis as DescriptionGroup,label:null,score:.2}];
  });
  expect(selectDjTags(scores).map(t => t.label)).toEqual(['vocal shout','reese bass','kick']);
  const profile: SoundProfile = {version:1,character:[],roles:[],disagreement:false,models:[]};
  mergeDjTags(profile, selectDjTags(scores));
  expect(profile.djTags?.filter(t=>t.group==='source').map(t=>t.label)).toEqual(['voice','synthesizer','drums']);
  for (const [best,other] of [[.3,.1],[.65,.64],[.4,.8]]) {
    expect(selectDjTags([{group:'dj-bass',label:'reese bass',score:best},{group:'dj-bass',label:null,score:other}])).toEqual([]);
  }
  expect(selectDjTags([{group:'dj-bass',label:'reese bass',score:.9}])).toEqual([]);
});

it('resolves pack aliases without losing canonical labels or accepting arbitrary tags', () => {
  expect(canonicalDjLabel('production',' REESE ')).toBe('reese bass');
  expect(canonicalDjLabel('production','vox chop')).toBe('vocal chops');
  expect(sanitizeConfirmedDjTags({source:['synth'],production:['reese','reese bass','uplifter'],character:['wet','imaginary']})).toEqual({source:['synthesizer'],production:['reese bass','riser'],character:['reverberant']});
  for (const [group,labels] of Object.entries(DJ_LABELS)) expect(labels.every(label=>canonicalDjLabel(group as keyof typeof DJ_LABELS,label)===label)).toBe(true);
});

it('preserves competing unknown descriptions across Full-mode windows', () => {
  const scores = descriptionScores([1,0], [
    {group:'dj-bass',label:'reese bass',vector:[.8,.6]},
    {group:'dj-bass',label:null,prompt:'Silence',vector:[0,1]},
    {group:'dj-bass',label:null,prompt:'Synth lead',vector:[1,0]},
  ]);
  const accumulator = new DescriptionAccumulator();
  accumulator.add(scores); accumulator.add(scores);
  expect(accumulator.average()).toHaveLength(3);
  expect(selectDjTags(accumulator.average())).toEqual([]);
});

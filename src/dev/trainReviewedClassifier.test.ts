import { expect, it } from 'vitest';
import { trainReviewedClassifier } from './trainReviewedClassifier';
import { learnedDjScores, sanitizeLearnedDjModel, type LearnedDjExample } from '../audio/learnedDjModel';
const examples=():LearnedDjExample[]=>Array.from({length:16},(_,i)=>{
  const vector=Array(512).fill(0);vector[i<8?0:1]=.85;vector[i+2]=Math.sqrt(1-.85**2);
  return {id:String(i).padStart(2,'0'),vector,labels:{source:[],production:i<8?['vocal chops']:[],character:[]},knownLabels:['production:vocal chops'],provenance:'explicit human confirmation'};
});
it('fits a classifier using training clips only and recognizes a new, non-nearest clip',()=>{
  const data=examples(),trained=trainReviewedClassifier(data);
  expect(trained.heads).toHaveLength(1);
  const report=trained.report.categories[0];
  expect(report.precision).toBe(1);expect(report.recall).toBe(1);
  expect(report.testIds).toHaveLength(4);
  expect(report.trainingIds.some(id=>report.testIds.includes(id))).toBe(false);
  const model=sanitizeLearnedDjModel({version:1,encoder:'test',revision:'test',examples:data,heads:trained.heads})!;
  const novel=Array(512).fill(0);novel[0]=.85;novel[100]=Math.sqrt(1-.85**2);
  expect(learnedDjScores(novel,{...model,heads:[]})).toEqual([]);
  expect(learnedDjScores(novel,model)).toEqual([expect.objectContaining({label:'vocal chops',decision:'include'})]);
});
it('does not train from too few examples or snapshots without the category',()=>{
  expect(trainReviewedClassifier(examples().slice(0,9)).heads).toEqual([]);
  const data=examples();data.slice(8).forEach(e=>{e.knownLabels=[];});
  expect(trainReviewedClassifier(data).report.categories[0].negatives).toBe(0);
});
it('keeps related takes and duplicate audio from inflating independent sample counts',()=>{
  const data=examples();
  const families=Object.fromEntries(data.map(e=>[e.id,'same recording']));
  expect(trainReviewedClassifier(data,families).heads).toEqual([]);
  data.forEach(e=>{e.vector=data[0].vector;});
  expect(trainReviewedClassifier(data).heads).toEqual([]);
});
it('rejects corrupt head weights and preserves the legacy model format',()=>{
  const base={version:1,encoder:'test',revision:'test',examples:examples()};
  expect(sanitizeLearnedDjModel(base)).toBeDefined();
  expect(sanitizeLearnedDjModel({...base,heads:[{group:'production',label:'vocal chops',weights:[NaN],bias:0,threshold:.7}]})).toBeUndefined();
});
it('withholds a trained head that cannot recognize its held-out clips',()=>{
  const data=examples();
  data.forEach((e,i)=>{e.vector=Array(512).fill(0);e.vector[i]=1;});
  const trained=trainReviewedClassifier(data);
  expect(trained.heads).toEqual([]);
  expect(trained.report.categories[0].status).toBe('failed-validation');
  expect(trained.report.categories[0].tested).toBe(4);
});

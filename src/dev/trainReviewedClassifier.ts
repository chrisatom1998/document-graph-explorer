import { trainBinary, predict } from '../../scripts/dj-training/learning.mjs';
import type { LearnedDjExample, LearnedDjHead, ReviewedGroup } from '../audio/learnedDjModel';

const THRESHOLD = .7;
export interface CategoryTrainingReport {
  key: string; positives: number; negatives: number;
  status: 'needs-examples' | 'failed-validation' | 'active';
  tested: number; precision: number | null; recall: number | null;
  trainingIds: string[]; testIds: string[];
}
/** Split sound families before fitting. Neither filenames nor model guesses supply labels. */
export function trainReviewedClassifier(examples: LearnedDjExample[], families: Record<string,string> = {}) {
  const ordered = [...examples].sort((a,b) => a.id.localeCompare(b.id));
  const parent = ordered.map((_,i) => i);
  const root = (i:number):number => parent[i] === i ? i : (parent[i] = root(parent[i]));
  for (let i=0;i<ordered.length;i++) for (let j=0;j<i;j++) {
    const sameFamily = families[ordered[i].id] && families[ordered[i].id] === families[ordered[j].id];
    const similarity = ordered[i].vector.reduce((sum,x,k) => sum+x*ordered[j].vector[k],0);
    if (sameFamily || similarity >= .995) parent[root(i)] = root(j);
  }
  const heads: LearnedDjHead[] = [];
  const categories: CategoryTrainingReport[] = [];
  for (const key of new Set(ordered.flatMap(e => e.knownLabels))) {
    const [group,...parts] = key.split(':'); const label = parts.join(':');
    if (!['source','production','character'].includes(group)) continue;
    const g = group as ReviewedGroup;
    const rows = ordered.flatMap((e,i) => e.knownLabels.includes(key) ? [{id:e.id,vector:e.vector,targets:{[key]:Number(e.labels[g].includes(label))},family:root(i)}] : []);
    const pos = rows.filter(r => r.targets[key] === 1), neg = rows.filter(r => r.targets[key] === 0);
    const report:CategoryTrainingReport = {key,positives:pos.length,negatives:neg.length,status:'needs-examples',tested:0,precision:null,recall:null,trainingIds:[],testIds:[]};
    categories.push(report);
    // Require independent families in both train and test, not repeated takes.
    const positiveFamilies = [...new Set(pos.map(r=>r.family))];
    const negativeFamilies = [...new Set(neg.map(r=>r.family))];
    if (positiveFamilies.length < 6 || negativeFamilies.length < 6) continue;
    const held = new Set([...positiveFamilies.slice(0,2),...negativeFamilies.slice(0,2)]);
    const train = rows.filter(r=>!held.has(r.family)), test = rows.filter(r=>held.has(r.family));
    if (new Set(train.filter(r=>r.targets[key]===1).map(r=>r.family)).size < 4 || new Set(train.filter(r=>r.targets[key]===0).map(r=>r.family)).size < 4) continue;
    const head = trainBinary(train,key);
    if (!head) continue;
    report.trainingIds=train.map(r=>r.id);report.testIds=test.map(r=>r.id);report.tested=test.length;
    let tp=0,fp=0,fn=0;
    for (const row of test) {
      const prediction=predict(head,row.vector)>=THRESHOLD, actual=row.targets[key]===1;
      if(prediction&&actual)tp++;if(prediction&&!actual)fp++;if(!prediction&&actual)fn++;
    }
    report.precision=tp+fp ? tp/(tp+fp) : null; report.recall=tp+fn ? tp/(tp+fn) : null;
    report.status=(report.precision ?? 0)>=.8 && (report.recall ?? 0)>=.5 ? 'active' : 'failed-validation';
    if(report.status==='active')heads.push({group:g,label,weights:head.weights,bias:head.bias,threshold:THRESHOLD});
  }
  return {heads,report:{method:'Balanced logistic classifiers on frozen CLAP features',minimum:'At least 6 independent positive and 6 independent negative sound families per category',note:'Small held-out checks are provisional, not proof of improvement over the base model. Test clips are excluded from head fitting; nearest-example matching still uses all reviews.',activeHeads:heads.length,categories}};
}

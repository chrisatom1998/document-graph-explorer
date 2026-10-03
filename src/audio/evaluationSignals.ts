type Key={tonic:number;mode:'major'|'minor'};
type Interval={start:number;end:number};
interface RuntimeSample {profile:string;cold:boolean;durationSeconds:number;elapsedMs:number;status:'complete'|'partial'|'failed'|'cancelled';peakMemoryBytes?:number;cancellationMs?:number}
const nonnegative=(v:number)=>Number.isFinite(v)&&v>=0;
/** Product metric: relative tolerance; half/double credit is deliberately separate. */
export function scoreTempo(reference:number|null,estimate:number|null,tolerance:number) {
  if(!nonnegative(tolerance)||tolerance>1||[reference,estimate].some(v=>v!==null&&(!Number.isFinite(v)||v<=0)))throw new Error('Invalid tempo or tolerance');
  if(reference===null)return {strict:null,halfDouble:null,noPulseCorrect:estimate===null};
  const hit=(value:number)=>Math.abs(value-reference)<=tolerance*reference;
  return {strict:estimate!==null&&hit(estimate),halfDouble:estimate!==null&&[estimate/2,estimate,estimate*2].some(hit),noPulseCorrect:null};
}
/** MIREX related-key credit with descending fifths enabled, per mir_eval.key.
 * https://mir-eval.readthedocs.io/latest/api/key.html
 * Root-only guesses must not be passed as major/minor keys.
 */
export function scoreKey(reference:Key|null,estimate:Key|null) {
  for(const k of [reference,estimate])if(k!==null&&(!Number.isInteger(k.tonic)||k.tonic<0||k.tonic>11||!['major','minor'].includes(k.mode)))throw new Error('Invalid key');
  if(reference===null)return {exact:null,weighted:null,noKeyCorrect:estimate===null};
  if(estimate===null)return {exact:false,weighted:0,noKeyCorrect:null};
  const delta=(estimate.tonic-reference.tonic+12)%12;
  const sameMode=reference.mode===estimate.mode;
  const exact=sameMode&&delta===0;
  const relative=!sameMode&&delta===(reference.mode==='major'?9:3);
  const weighted=exact?1:sameMode&&[5,7].includes(delta)?.5:relative?.3:!sameMode&&delta===0?.2:0;
  return {exact,weighted,noKeyCorrect:null};
}
export function intervalOverlap(reference:Interval,estimate:Interval):number {
  for(const i of [reference,estimate])if(!nonnegative(i.start)||!Number.isFinite(i.end)||i.end<=i.start)throw new Error('Invalid interval');
  const intersection=Math.max(0,Math.min(reference.end,estimate.end)-Math.max(reference.start,estimate.start));
  return intersection/(reference.end-reference.start+estimate.end-estimate.start-intersection);
}
export function runtimeSummary(samples:RuntimeSample[]) {
  const groups=new Map<string,RuntimeSample[]>();
  for(const sample of samples) {
    if(typeof sample.profile!=='string'||!sample.profile.trim()||typeof sample.cold!=='boolean'||!Number.isFinite(sample.durationSeconds)||sample.durationSeconds<=0||!nonnegative(sample.elapsedMs)
      ||(sample.peakMemoryBytes!==undefined&&!nonnegative(sample.peakMemoryBytes))
      ||(sample.cancellationMs!==undefined&&!nonnegative(sample.cancellationMs))||!['complete','partial','failed','cancelled'].includes(sample.status))throw new Error('Invalid runtime measurement');
    const key=JSON.stringify([sample.profile,sample.cold]);const values=groups.get(key)??[];values.push(sample);groups.set(key,values);
  }
  return [...groups.values()].map(values=>{
    const memory=values.flatMap(v=>v.peakMemoryBytes===undefined?[]:[v.peakMemoryBytes]);
    const cancel=values.flatMap(v=>v.cancellationMs===undefined?[]:[v.cancellationMs]);
    return {profile:values[0].profile,cold:values[0].cold,runs:values.length,failures:values.filter(v=>v.status==='failed').length,
      meanRealTimeFactor:values.reduce((sum,v)=>sum+v.elapsedMs/(1000*v.durationSeconds),0)/values.length,
      peakMemoryBytes:memory.length?Math.max(...memory):null,maxCancellationMs:cancel.length?Math.max(...cancel):null};
  });
}
